/**
 * The trip's Ask page: what the model is told about a trip, and the two small
 * languages its answers use to point back at the app — stop links and maps.
 *
 * Pure, so the route builds the context with it, the page reads answers with
 * it, and the tests check both against the same code.
 */

/* ------------------------------------------------------------ stop links --- */

const hex = (id) => String(id || '').replace(/-/g, '').toLowerCase();

/**
 * A short token per activity, for the model to cite a stop by.
 *
 * Not the row's UUID: a model copies 36 characters less reliably than 6, and
 * the UUID is ours rather than something to show anyone. Not a position
 * either ("s3"): positions change as soon as a stop is added, and an answer
 * from yesterday would then point at the wrong one. A prefix of the id stays
 * true as long as the stop exists, and lengthens only where two stops would
 * otherwise share one.
 */
export function stopTokens(activities) {
  const ids = (activities || []).map((a) => hex(a.id)).filter(Boolean);
  const out = new Map();
  for (const id of ids) {
    let n = 6;
    while (n < id.length && ids.some((other) => other !== id && other.startsWith(id.slice(0, n)))) n += 2;
    out.set(id, id.slice(0, n));
  }
  return (a) => out.get(hex(a && a.id)) || hex(a && a.id).slice(0, 6);
}

/** The activity a token names, if it is still in the trip. */
export function stopFor(activities, token) {
  const t = String(token || '').toLowerCase().replace(/[^0-9a-f]/g, '');
  if (t.length < 6) return null;
  return (activities || []).find((a) => hex(a.id).startsWith(t)) || null;
}

/**
 * The href the model writes for a stop: a fragment, because react-markdown's
 * URL check keeps relative links and quietly empties any scheme it does not
 * know — `stop:` would arrive as an empty href.
 */
export const STOP_HREF = /^#stop-([0-9a-f]{6,32})$/i;
export const stopHref = (token) => `#stop-${token}`;

/* ------------------------------------------------------------------ maps --- */

const MAX_PLACES = 10;

/**
 * A ```map block from an answer, read defensively.
 *
 * Returns null for anything that is not a usable map — including the half of
 * a block that has streamed so far, which is how the page knows to hold a
 * placeholder rather than draw a map that will change under the reader.
 * Coordinates from the model are never read: a stop's come from the trip and
 * a place's from Google.
 */
export function parseMapSpec(raw) {
  let spec;
  try {
    spec = JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.places)) return null;
  const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const places = [];
  const seen = new Set();
  for (const p of spec.places) {
    if (places.length >= MAX_PLACES) break;
    if (!p || typeof p !== 'object') continue;
    const stop = clip(p.stop, 32).toLowerCase().replace(/^#?stop-/, '');
    if (/^[0-9a-f]{6,32}$/.test(stop)) {
      if (seen.has(`s:${stop}`)) continue;
      seen.add(`s:${stop}`);
      places.push({ stop, note: clip(p.note, 160) });
      continue;
    }
    const name = clip(p.name, 120);
    if (!name || seen.has(`n:${name.toLowerCase()}`)) continue;
    seen.add(`n:${name.toLowerCase()}`);
    places.push({ name, near: clip(p.near, 120), note: clip(p.note, 160) });
  }
  if (!places.length) return null;
  return { title: clip(spec.title, 120), places };
}

/* -------------------------------------------------------------- pictures --- */

/**
 * A ```places block: places shown with their photographs, as a row of
 * cards (a few highlights, a name and a caption each) or as a list (each
 * one described, with a thumbnail beside it).
 *
 * Read as defensively as a map. The photographs are never the model's: a
 * stop's come from the trip, a named place's from Google's own search.
 */
export function parsePlacesSpec(raw) {
  let spec;
  try {
    spec = JSON.parse(String(raw || '').trim());
  } catch {
    return null;
  }
  if (!spec || typeof spec !== 'object' || !Array.isArray(spec.places)) return null;
  const style = spec.style === 'list' ? 'list' : 'cards';
  const most = style === 'list' ? 8 : 4;
  const clip = (v, n) => String(v || '').replace(/[ \t]+/g, ' ').trim().slice(0, n);
  const places = [];
  const seen = new Set();
  for (const p of spec.places) {
    if (places.length >= most) break;
    if (!p || typeof p !== 'object') continue;
    const words = { caption: clip(p.caption, 80), meta: clip(p.meta, 120), text: clip(p.text, 900) };
    const stop = clip(p.stop, 32).toLowerCase().replace(/^#?stop-/, '');
    if (/^[0-9a-f]{6,32}$/.test(stop)) {
      if (seen.has(`s:${stop}`)) continue;
      seen.add(`s:${stop}`);
      places.push({ stop, ...words });
      continue;
    }
    const name = clip(p.name, 120);
    if (!name || seen.has(`n:${name.toLowerCase()}`)) continue;
    seen.add(`n:${name.toLowerCase()}`);
    places.push({ name, near: clip(p.near, 120), ...words });
  }
  if (!places.length) return null;
  return { style, title: clip(spec.title, 120), places };
}

/* ----------------------------------------------------------- attachments --- */

export const MAX_PHOTOS = 4;
export const MAX_FILES = 3;
/* Base64 a third bigger than the file, the whole request under Vercel's
   4.5 MB, and room left for the conversation: about 2.5 MB of PDF. */
export const MAX_PDF_BYTES = 2.5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 40000;
/** What one question may carry, encoded, before it is refused on the device. */
export const MAX_ATTACHED_CHARS = 3.6 * 1024 * 1024;

const IMAGE_URL = /^data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const PDF_URL = /^data:application\/pdf;base64,([A-Za-z0-9+/=]+)$/;

/**
 * What came with a question, as the route will pass it on: photos as data
 * URLs, PDFs as data URLs that really are PDFs, text files as text. Anything
 * else is dropped without a word — what the browser said a file was is not
 * evidence of what it is.
 */
export function cleanAttachments(list) {
  const out = [];
  let photos = 0;
  let files = 0;
  let room = MAX_TEXT_CHARS;
  const name = (v, fallback) => String(v || '').replace(/[\r\n"]+/g, ' ').trim().slice(0, 120) || fallback;
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a !== 'object') continue;
    if (a.kind === 'image' && photos < MAX_PHOTOS && IMAGE_URL.test(String(a.url || ''))) {
      photos += 1;
      out.push({ kind: 'image', name: name(a.name, 'photo'), url: a.url });
    } else if (a.kind === 'pdf' && files < MAX_FILES) {
      const m = String(a.data || '').match(PDF_URL);
      // Decoded, a PDF starts "%PDF", which is "JVBERi" in base64.
      if (!m || !m[1].startsWith('JVBERi') || (m[1].length * 3) / 4 > MAX_PDF_BYTES * 1.02) continue;
      files += 1;
      out.push({ kind: 'pdf', name: name(a.name, 'document.pdf'), data: a.data });
    } else if (a.kind === 'text' && files < MAX_FILES && room > 0) {
      const text = String(a.text || '').slice(0, room);
      if (!text.trim()) continue;
      room -= text.length;
      files += 1;
      out.push({ kind: 'text', name: name(a.name, 'notes.txt'), text });
    }
  }
  return out;
}

/** How an earlier question's attachments read in the history: named, not sent again. */
export function attachmentNote(list) {
  const names = (list || []).map((a) => (a.kind === 'image' ? 'a photo' : a.name)).filter(Boolean);
  return names.length ? `[Attached: ${names.join(', ')}]` : '';
}

/* --------------------------------------------------------------- sources --- */

/** A cited page's address without the tracking parameter search adds to it. */
export function cleanSourceUrl(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return '';
    u.searchParams.delete('utm_source');
    return u.toString();
  } catch {
    return '';
  }
}

/** The name a source goes by in a pill: its site, without the "www.". */
export function sourceSite(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/*
 * Web search writes its citations inline as a link whose text is the site,
 * in brackets: "([tnm.jp](https://…))". Those read as pills, not as prose
 * links, so the page needs to tell them apart.
 */
export function isCitation(text, href) {
  const t = String(text || '').trim().toLowerCase().replace(/^www\./, '');
  const site = sourceSite(href);
  return !!t && !!site && !/\s/.test(t) && (site === t || site.endsWith(`.${t}`) || t.endsWith(site));
}

const hastText = (node) => (!node ? '' : node.type === 'text' ? node.value
  : (node.children || []).map(hastText).join(''));

/**
 * A rehype step: "claim ([site](url))" becomes "claim [site]", the brackets
 * gone from around a citation that already reads as a pill.
 */
export function tidyCitations() {
  const walk = (node) => {
    const kids = node && node.children;
    if (!kids) return;
    kids.forEach((k, i) => {
      if (k.type === 'element' && k.tagName === 'a' && isCitation(hastText(k), k.properties && k.properties.href)) {
        const prev = kids[i - 1];
        const next = kids[i + 1];
        if (prev && prev.type === 'text' && /\(\s*$/.test(prev.value) && next && next.type === 'text' && /^\s*\)/.test(next.value)) {
          prev.value = prev.value.replace(/\s*\(\s*$/, ' ');
          next.value = next.value.replace(/^\s*\)/, '');
        }
      }
      walk(k);
    });
  };
  return walk;
}

/* --------------------------------------------------------------- context --- */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dayName(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return `${DOW[d.getUTCDay()]} ${+m[3]} ${MON[+m[2] - 1]} ${m[1]}`;
}

function daysBetween(a, b) {
  const t = (iso) => Date.parse(`${iso}T00:00:00Z`);
  return Math.round((t(b) - t(a)) / 86400000);
}

// Postgres sends `time` as "09:00:00"; nobody reads the seconds.
const hm = (t) => (String(t || '').match(/^(\d{2}:\d{2})/) || [])[1] || '';

// The code rather than a symbol: "¥" is two currencies and "$" is a dozen,
// and the model should not have to guess which one a trip means.
function moneyOf(n, currency) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `${currency || 'SGD'} ${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function zoned(timeZone, at) {
  let zone = timeZone || 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); } catch { zone = 'UTC'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at).map((x) => [x.type, x.value]));
  return { zone, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/*
 * The plain fields of an activity's `details` (a flight's terminal, a
 * hotel's check-in), one line, capped. Nested values are the app's own
 * machinery — a chosen train route, a cached photo set — and only cost tokens.
 */
function detailLine(details) {
  if (!details || typeof details !== 'object') return '';
  const bits = Object.entries(details)
    .filter(([k, v]) => !k.startsWith('_') && v !== '' && v !== null && ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${String(v).slice(0, 80)}`);
  return bits.join(', ').slice(0, 400);
}

const one = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * Everything the assistant knows about the trip, as one block of text.
 *
 * Built on the server from rows read with the asker's own session, so it is
 * exactly what they could open themselves, and a request cannot bring a trip
 * of its own. Emails are left out: names are enough to answer "who".
 */
export function tripContext({ trip, activities = [], packing = [], members = [], now = new Date() }) {
  const t = trip || {};
  const token = stopTokens(activities);
  const here = zoned(t.timezone, now);
  const start = t.start_date || '';
  const end = t.end_date || start;
  const length = start && end ? daysBetween(start, end) + 1 : 0;
  const lines = [];

  lines.push(`Trip: ${one(t.name, 120) || 'Untitled trip'}`);
  if (t.destination) lines.push(`Destination: ${one(t.destination, 160)}`);
  if (start) lines.push(`Dates: ${dayName(start)} to ${dayName(end)} (${length} day${length === 1 ? '' : 's'})`);
  let when = '';
  if (start && here.date < start) {
    const n = daysBetween(here.date, start);
    when = `${n} day${n === 1 ? '' : 's'} before the trip starts`;
  } else if (start && here.date <= end) when = `day ${daysBetween(start, here.date) + 1} of the trip`;
  else if (start) when = 'the trip is over';
  lines.push(`Now at the destination (${here.zone}): ${dayName(here.date)}, ${here.time}${when ? `, ${when}` : ''}.`);

  const spent = activities.reduce((sum, a) => sum + (Number(a.cost) || 0), 0);
  lines.push(`Currency: ${t.currency || 'SGD'}.${t.budget ? ` Budget: ${moneyOf(t.budget, t.currency)}.` : ' No budget set.'} Planned costs so far: ${moneyOf(spent, t.currency) || 'none'}.`);
  const names = members.map((m) => one(m.display_name, 40)).filter(Boolean);
  lines.push(`Travellers: ${members.length || 1}${names.length ? ` (${names.join(', ')})` : ''}.`);

  const sorted = [...activities].sort((a, b) => String(a.day).localeCompare(String(b.day))
    || (a.start_time ? 0 : 1) - (b.start_time ? 0 : 1)
    || String(a.start_time || '').localeCompare(String(b.start_time || ''))
    || (a.sort_order || 0) - (b.sort_order || 0));
  const byDay = new Map();
  sorted.forEach((a) => {
    if (!byDay.has(a.day)) byDay.set(a.day, []);
    byDay.get(a.day).push(a);
  });
  const dayList = [];
  if (start && length > 0 && length <= 120) {
    for (let i = 0; i < length; i += 1) {
      const d = new Date(Date.parse(`${start}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
      dayList.push(d);
    }
  }
  [...byDay.keys()].forEach((d) => { if (!dayList.includes(d)) dayList.push(d); });
  dayList.sort();

  lines.push('', 'Itinerary. Each stop: [token] time, title (type), place, cost, notes. "located" means the app has its position.');
  dayList.slice(0, 160).forEach((d) => {
    const n = start ? daysBetween(start, d) + 1 : 0;
    const label = n >= 1 && n <= length ? `Day ${n}, ${dayName(d)}` : `${dayName(d)} (outside the trip's dates)`;
    const acts = byDay.get(d) || [];
    lines.push(`${label}${acts.length ? '' : ': nothing planned'}`);
    acts.slice(0, 60).forEach((a) => {
      const time = a.start_time ? `${hm(a.start_time)}${a.end_time ? `–${hm(a.end_time)}` : ''}` : 'no time';
      const kind = [a.category, a.subtype].filter(Boolean).join('/');
      const bits = [
        `- [${token(a)}] ${time}, ${one(a.title, 140)}${kind ? ` (${kind})` : ''}`,
        a.location ? one(a.location, 140) : '',
        moneyOf(a.cost, t.currency),
        Number.isFinite(Number(a.lat)) && a.lat !== null && Number.isFinite(Number(a.lng)) && a.lng !== null ? 'located' : '',
        a.booking_ref ? `booking ref on file` : '',
        detailLine(a.details),
        a.notes ? `notes: ${one(a.notes, 300)}` : '',
      ].filter(Boolean);
      lines.push(bits.join(' · '));
    });
  });

  if (packing.length) {
    const packed = packing.filter((p) => p.packed).length;
    lines.push('', `Packing list: ${packing.length} items, ${packed} packed.`);
    lines.push(packing.slice(0, 150).map((p) => `${one(p.label, 60)}${p.qty > 1 ? ` ×${p.qty}` : ''}${p.packed ? ' (packed)' : ''}`).join('; '));
  } else {
    lines.push('', 'Packing list: empty.');
  }

  const notes = String(t.notes || '').replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').trim();
  if (notes) lines.push('', 'Trip notes:', notes.slice(0, 4000));

  return lines.join('\n').slice(0, 60000);
}

// "Tokyo, Japan" reads as "Tokyo" in a sentence.
const placeOf = (t) => one(String((t && t.destination) || '').split(',')[0], 30);

const phase = (t, today) => {
  if (!t.start_date || !today || today < t.start_date) return 'before';
  return t.end_date && today > t.end_date ? 'after' : 'during';
};

/** A handful of short questions that fit this trip, for the blank page. */
export function askSuggestions(trip, activities = [], today = '') {
  const t = trip || {};
  const where = placeOf(t);
  const month = t.start_date ? MON[Number(t.start_date.slice(5, 7)) - 1] : '';
  const when = phase(t, today);
  const busiest = (() => {
    const count = new Map();
    activities.forEach((a) => count.set(a.day, (count.get(a.day) || 0) + 1));
    let best = null;
    count.forEach((n, d) => { if (!best || n > best.n) best = { d, n }; });
    return best && t.start_date ? daysBetween(t.start_date, best.d) + 1 : 0;
  })();
  return [
    busiest > 0 ? `Map out day ${busiest}` : where ? `What to see in ${where}` : 'What to see there',
    where && month ? `Weather in ${where} in ${month}` : 'What the weather will be like',
    when === 'before' ? 'What to book ahead' : when === 'after' ? 'Sum up the trip' : 'Open late near us',
    'Any gaps or clashes?',
  ];
}

/**
 * The blank page's heading, one picked per visit. The same words every time
 * stop being read; a few that say the same thing keep it a question.
 */
export function askGreetings(trip, today = '') {
  const t = trip || {};
  const where = placeOf(t);
  const lines = ['Ask anything about the trip', 'What would you like to know?'];
  if (where) lines.push(`Ask anything about ${where}`, `What do you want to know about ${where}?`);
  const when = phase(t, today);
  if (where && when === 'before') lines.push(`Anything to check before ${where}?`);
  if (when === 'during') lines.push('What do you need today?');
  return lines;
}
