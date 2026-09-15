import { aiConfigured, notConfigured, aiFailure, aiModel, aiEffort } from '@/lib/ai';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { journeyDoc } from '@/lib/journeyStore';
import { journalContext } from '@/lib/journeyAsk';
import { sectionsOf } from '@/lib/journeyMap';
import { plainText } from '@/lib/journeyFormat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/*
 * A soft ceiling per person. Journeys are public pages and every answer is a
 * paid model call. Kept in memory, so it holds per server instance rather
 * than across all of them: enough to stop a runaway loop, not a determined
 * abuser, which is what the sign-in is for.
 */
const WINDOW = 3600 * 1000;
const LIMIT = 40;
const asked = new Map();
function allow(id) {
  const now = Date.now();
  const recent = (asked.get(id) || []).filter((t) => now - t < WINDOW);
  const ok = recent.length < LIMIT;
  if (ok) recent.push(now);
  asked.set(id, recent);
  return ok;
}

const SYSTEM = (today) => `You answer a traveller's questions while they read a Wander journey: a researched travel journal about one trip, given below. Today is ${today}.

- Answer from the journal first. When you add something it does not say, say that it is general knowledge. For anything that changes, such as opening hours, prices, closures, tickets, timetables or safety advice, tell them to check the official source before relying on it.
- Keep it short: two to five sentences, or a few short lines starting with "- " for a list. Plain text, no headings, bold or links.
- Refer to the journey's places by their token, like {p3}; the page shows the name. Never write a token for a place that is not in the list.
- "Here", "this" or "this part" means the section they are reading or the passage they highlighted.
- If neither the journal nor what you reliably know answers it, say so plainly and suggest where to look.
- Never invent first-hand experience, bookings, prices or opening hours.
- Stay on travel: this trip, its destination and planning it. Politely decline anything else.`;

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const slug = String(body.slug || '').slice(0, 120);
  const question = String(body.question || '').trim().slice(0, 600);
  if (!slug || !question) return Response.json({ error: 'Ask a question first.' }, { status: 400 });
  if (!allow(user.id)) {
    return Response.json({ error: 'That is a lot of questions for one hour. Try again a little later.' }, { status: 429 });
  }

  // The journey comes from the catalogue, never from the request, so a
  // question cannot bring its own "journal" along.
  const doc = await journeyDoc(slug);
  if (!doc) return Response.json({ error: 'That journey is not available.' }, { status: 404 });

  const quote = String(body.quote || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  const sec = Number.isInteger(body.section) ? sectionsOf(doc.blocks)[body.section] : null;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8).map((m) => ({
    role: m && m.role === 'assistant' ? 'assistant' : 'user',
    content: String((m && m.content) || '').slice(0, 1500),
  })).filter((m) => m.content);
  const where = [
    sec ? `They are reading section ${body.section + 1}: ${[sec.kicker, plainText(sec.title, doc.places)].filter(Boolean).join(' — ')}.` : '',
    quote ? `They highlighted this passage: "${quote}"` : '',
  ].filter(Boolean).join('\n');

  let upstream;
  try {
    upstream = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: aiModel('ask'),
        stream: true,
        max_completion_tokens: 4000,
        ...(aiEffort('ask') ? { reasoning_effort: aiEffort('ask') } : {}),
        messages: [
          { role: 'system', content: `${SYSTEM(new Date().toISOString().slice(0, 10))}\n\n${journalContext(doc)}` },
          ...history,
          { role: 'user', content: `${where ? `${where}\n\n` : ''}${question}` },
        ],
      }),
    });
  } catch (e) {
    return aiFailure(e, 'ask');
  }
  if (!upstream.ok) {
    let detail = '';
    try { detail = ((await upstream.json()).error || {}).message || ''; } catch (e) { /* non-JSON body */ }
    return aiFailure(new Error(`${upstream.status} ${detail || 'no detail'} (model ${aiModel('ask')})`), 'ask');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        for (;;) {
          // eslint-disable-next-line no-await-in-loop
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for (const line of lines) {
            const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
            if (!payload || payload === '[DONE]') continue;
            try {
              const delta = JSON.parse(payload).choices?.[0]?.delta;
              if (delta && typeof delta.content === 'string') controller.enqueue(encoder.encode(delta.content));
            } catch (e) { /* one bad frame is not fatal */ }
          }
        }
      } catch (e) {
        console.error('[ai] ask stream failed:', (e && e.message) || e);
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
  });
}
