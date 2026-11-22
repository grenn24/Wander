import { aiConfigured, notConfigured, aiFailure } from '@/lib/ai';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Speech to text, for the Assistant's microphone.
 *
 * The small transcription model: dictating a question is short and plain,
 * and given a second of silence it returned nothing at all, where the larger
 * one wrote a word of German. A question that was never said is worse than
 * one that has to be repeated.
 */
const MODEL = 'gpt-4o-mini-transcribe';
// Two minutes of Opus is well under a megabyte; this is room, not a target.
const MAX_BYTES = 4 * 1024 * 1024;
const TYPES = /^audio\/(webm|ogg|mp4|mpeg|mpga|m4a|x-m4a|wav|x-wav|aac)(;.*)?$/;
// The decoder is chosen by the file's name, so the name must match what it is.
const EXT = { webm: 'webm', ogg: 'ogg', mp4: 'mp4', m4a: 'm4a', 'x-m4a': 'm4a', aac: 'm4a', mpeg: 'mp3', mpga: 'mp3', wav: 'wav', 'x-wav': 'wav' };

const WINDOW = 3600 * 1000;
const LIMIT = 60;
const heard = new Map();
function allow(id) {
  const now = Date.now();
  if (heard.size > 1000) {
    heard.forEach((times, who) => {
      if (!times.length || now - times[times.length - 1] >= WINDOW) heard.delete(who);
    });
  }
  const recent = (heard.get(id) || []).filter((t) => now - t < WINDOW);
  const ok = recent.length < LIMIT;
  if (ok) recent.push(now);
  heard.set(id, recent);
  return ok;
}

export async function POST(req) {
  if (!aiConfigured()) return notConfigured();
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();
  if (!allow(user.id)) {
    return Response.json({ error: 'That is a lot of talking for one hour. Try typing for a while.' }, { status: 429 });
  }

  let form;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string' || !audio.size) {
    return Response.json({ error: 'Nothing was recorded.' }, { status: 400 });
  }
  const type = String(audio.type || '').toLowerCase();
  if (!TYPES.test(type)) return Response.json({ error: 'That recording is in a format Wander cannot read.' }, { status: 415 });
  if (audio.size > MAX_BYTES) return Response.json({ error: 'That recording is too long. Try a shorter one.' }, { status: 413 });

  const sub = type.split(';')[0].split('/')[1];
  const upstream = new FormData();
  upstream.append('model', MODEL);
  upstream.append('file', new Blob([await audio.arrayBuffer()], { type: type.split(';')[0] }), `speech.${EXT[sub] || 'webm'}`);
  // The trip's names, so "Ameyoko" is not heard as "Amy Yoko".
  const hint = String(form.get('hint') || '').replace(/\s+/g, ' ').trim().slice(0, 400);
  if (hint) upstream.append('prompt', hint);

  let res;
  try {
    res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      signal: req.signal,
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: upstream,
    });
  } catch (e) {
    return aiFailure(e, 'transcribe');
  }
  if (!res.ok) {
    let detail = '';
    try { detail = ((await res.json()).error || {}).message || ''; } catch { /* non-JSON body */ }
    return aiFailure(new Error(`${res.status} ${detail || 'no detail'} (model ${MODEL})`), 'transcribe');
  }
  const body = await res.json().catch(() => ({}));
  return Response.json({ text: String(body.text || '').trim() });
}
