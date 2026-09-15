/*
 * The journal format, version 2: a journey as a run of blocks.
 *
 * Version 1 was a ladder — title, paragraph, three places, repeat — and every
 * journey read like the last one. Here the writer chooses the shape: prose,
 * a photograph, a pull quote, an hour-by-hour day, a detour for when it rains,
 * a note on what to skip, in whatever order the trip deserves.
 *
 * Places live in one list and are written into the text as tokens, {p3}, which
 * the page turns into the place's name. That keeps "make it yours" working
 * without a grid of cards: every place is tappable where it is written about.
 *
 * Shared by the pages, the writing pipeline and the tests, so nothing here
 * touches the network.
 */
import { REGIONS, foldText, regionLabel } from './journeyKit.js';

export const BLOCK_TYPES = ['heading', 'prose', 'photo', 'video', 'quote', 'tip', 'detour', 'day', 'skip'];
export const PLACE_KINDS = ['sight', 'food', 'stay', 'nature', 'walk', 'neighbourhood', 'transport', 'experience'];
const LAYOUTS = ['wide', 'inset', 'pair', 'none'];
const TOKEN = /\{(p\d+)\}/g;
const TEXT_BLOCKS = ['heading', 'prose', 'quote', 'tip', 'detour', 'skip'];
const EXTRAS = ['quote', 'tip', 'detour', 'day', 'skip'];

const str = (description) => ({ type: 'string', description });
const opt = (description) => ({ type: ['string', 'null'], description });
const monthList = (description) => ({ type: 'array', description, items: { type: 'integer' } });

const PLACE = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'q', 'note', 'kind'],
  properties: {
    id: str('p1, p2, p3… unique within the journey'),
    name: str('The place as a traveller would name it'),
    q: str('A Google Maps search that finds exactly this place: name, town, country'),
    note: str('One sentence with the practical detail that decides when or how to go'),
    kind: { type: 'string', enum: PLACE_KINDS },
  },
};

const BLOCK = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'text', 'title', 'kicker', 'label', 'caption', 'query', 'layout', 'items'],
  properties: {
    type: { type: 'string', enum: BLOCK_TYPES },
    text: opt('heading, prose, quote, tip, detour, skip: the words. May contain place tokens like {p2}. A blank line starts a new paragraph.'),
    title: opt('detour, day and skip: a short title such as "If it rains"'),
    kicker: opt('heading: how long this section lasts, shown small above it, such as "Days 3–4" or "Half a day". Null for every other block.'),
    label: opt('tip: two or three words, such as "Book ahead"'),
    caption: opt('photo or video: one line shown under it'),
    query: opt('photo: a keyword search of three to six words, subject and place, such as "Otaru Canal Hokkaido". video: a YouTube search of three to six words for this stretch of the trip, such as "Lower Calf Creek Falls hike".'),
    layout: { type: 'string', enum: LAYOUTS, description: 'photo: wide, inset, or pair for two pictures. "none" for every other block.' },
    items: {
      type: 'array',
      description: 'day: the times of the day in order. Empty for every other block.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['time', 'text'],
        properties: { time: str('"7:30" or "Late afternoon"'), text: str('What happens, may contain place tokens') },
      },
    },
  },
};

/*
 * How safe the trip is, from a source that can be named: the US State
 * Department's travel advisory level for the country, what it means for the
 * places this journey goes, and the risks that matter on this particular trip.
 */
export const SAFETY = {
  type: 'object',
  additionalProperties: false,
  required: ['level', 'advice', 'watch'],
  properties: {
    level: {
      type: ['integer', 'null'],
      enum: [1, 2, 3, 4, null],
      description: 'The US State Department travel advisory level for this country as of today: 1 exercise normal precautions, 2 exercise increased caution, 3 reconsider travel, 4 do not travel. The country\'s own advisory, never the worldwide caution alert. Null for the United States, which the State Department does not rate.',
    },
    advice: str('One or two plain sentences on what the advisory means for the places in this journey, naming any region of the country with a different level'),
    watch: {
      type: 'array',
      description: 'Two to four risks that actually matter on this trip, two to four words each, such as "Altitude sickness" or "Strong ocean currents"',
      items: { type: 'string' },
    },
  },
};

/** What the writer returns. Resolved places and photographs are added afterwards. */
export const WRITER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slug', 'title', 'place', 'country', 'region', 'center', 'months', 'when', 'days',
    'pace', 'cost', 'mood', 'teaser', 'lede', 'cover', 'videoQuery', 'places', 'blocks', 'know', 'safety', 'sources'],
  properties: {
    safety: SAFETY,
    slug: str('Lowercase words joined by hyphens, three to six words'),
    title: str('The journey’s name, short and specific'),
    place: str('Where, as a reader would say it: "Utah’s national parks", "Kyoto & Nara"'),
    country: str('The country, or the main one'),
    region: { type: 'string', enum: REGIONS.map((r) => r.id) },
    center: {
      type: 'object',
      additionalProperties: false,
      required: ['lat', 'lng'],
      properties: { lat: { type: 'number' }, lng: { type: 'number' } },
    },
    months: {
      type: 'object',
      additionalProperties: false,
      required: ['best', 'good', 'avoid'],
      properties: {
        best: monthList('Months (1–12) when this journey is at its best'),
        good: monthList('Months that work well'),
        avoid: monthList('Months when this journey is a poor idea'),
      },
    },
    when: str('One or two sentences on timing'),
    days: { type: 'array', description: '[shortest, longest] sensible length in days', items: { type: 'integer' } },
    pace: { type: 'string', enum: ['Slow', 'Steady', 'Full'] },
    cost: { type: 'integer', enum: [1, 2, 3] },
    mood: { type: 'array', description: 'Two to four one- or two-word themes', items: { type: 'string' } },
    teaser: str('One sentence for the catalogue card'),
    lede: str('The opening paragraph'),
    videoQuery: str('A YouTube search of three to six words for a travel video about the main places'),
    cover: {
      type: 'object',
      additionalProperties: false,
      required: ['query', 'place'],
      properties: {
        query: str('Keyword search of three to six words for the opening photograph, subject and place'),
        place: opt('The id of the place the cover shows, if it shows one'),
      },
    },
    places: { type: 'array', items: PLACE },
    blocks: { type: 'array', items: BLOCK },
    know: {
      type: 'array',
      description: 'Two to four practical notes: getting around, booking, money, safety',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'text'],
        properties: { label: str('Two or three words'), text: str('One or two sentences') },
      },
    },
    sources: {
      type: 'array',
      description: 'Pages you relied on for facts that change',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'url'],
        properties: { title: str('Page title'), url: str('Full URL') },
      },
    },
  },
};

const BLANK = { text: null, title: null, kicker: null, label: null, caption: null, query: null, layout: 'none', items: [] };

/** Remove links and citation marks a model leaves in prose after searching the web. */
export function cleanText(s) {
  if (s == null) return s;
  return String(s)
    .replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, '')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '$1')
    .replace(/【[^】]*】/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function textsOf(b) {
  return [b.text, b.title, ...(b.items || []).map((it) => it.text)].filter(Boolean);
}

const words = (s) => String(s || '').replace(TOKEN, 'place').split(/\s+/).filter(Boolean).length;
const validVideo = (v) => (v && v.provider === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(v.id || '') ? v : null);

/**
 * A safety note the page can show, or null. The level may be null — the State
 * Department rates other countries, not the United States — but the advice
 * never is.
 */
export function cleanSafety(v) {
  if (!v || typeof v !== 'object') return null;
  const advice = cleanText(v.advice || '');
  if (!advice) return null;
  const watch = (Array.isArray(v.watch) ? v.watch : []).map(cleanText).filter(Boolean).slice(0, 4);
  return { level: [1, 2, 3, 4].includes(v.level) ? v.level : null, advice, watch };
}
const validPoint = (p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
  && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/**
 * Tidy what came back, without changing what it says: trim and de-link text,
 * put months in one list each, drop tokens that point nowhere, and make every
 * block carry every field so the page never has to ask.
 */
export function normaliseDoc(raw) {
  const doc = { ...raw, v: 2 };
  for (const k of ['title', 'place', 'country', 'when', 'teaser', 'lede']) doc[k] = cleanText(doc[k] || '');
  doc.slug = String(doc.slug || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  const best = [...new Set((doc.months && doc.months.best) || [])];
  const good = [...new Set((doc.months && doc.months.good) || [])].filter((m) => !best.includes(m));
  const avoid = [...new Set((doc.months && doc.months.avoid) || [])].filter((m) => !best.includes(m) && !good.includes(m));
  doc.months = { best, good, avoid };
  const d = (doc.days || []).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  doc.days = d.length ? [d[0], d[d.length - 1]] : [];
  doc.mood = (doc.mood || []).map(cleanText).filter(Boolean).slice(0, 5);
  const seen = new Set();
  doc.places = (doc.places || []).filter((p) => p && !seen.has(p.id) && seen.add(p.id))
    .map((p) => ({ ...p, name: cleanText(p.name), note: cleanText(p.note), q: cleanText(p.q) }));
  const ids = new Set(doc.places.map((p) => p.id));
  const keepTokens = (t) => (t == null ? t : t.replace(TOKEN, (m, id) => (ids.has(id) ? m : '')));
  doc.blocks = (doc.blocks || []).filter((b) => b && BLOCK_TYPES.includes(b.type)).map((b) => ({
    ...BLANK,
    ...b,
    text: keepTokens(cleanText(b.text)),
    title: cleanText(b.title),
    caption: cleanText(b.caption),
    layout: b.type === 'photo' ? (LAYOUTS.includes(b.layout) && b.layout !== 'none' ? b.layout : 'wide') : 'none',
    items: b.type === 'day'
      ? (b.items || []).map((it) => ({ time: cleanText(it.time), text: keepTokens(cleanText(it.text)) }))
      : [],
    video: b.type === 'video' ? validVideo(b.video) : undefined,
  }));
  doc.know = (doc.know || []).map((k) => ({ label: cleanText(k.label), text: cleanText(k.text) })).filter((k) => k.label && k.text);
  doc.cover = { query: cleanText((doc.cover && doc.cover.query) || doc.title), place: (doc.cover && ids.has(doc.cover.place)) ? doc.cover.place : null, ...(doc.cover && doc.cover.photo ? { photo: doc.cover.photo } : {}) };
  doc.sources = (doc.sources || []).filter((s) => s && /^https?:\/\//.test(s.url || '')).slice(0, 12);
  doc.videoQuery = cleanText(doc.videoQuery || `${doc.place} travel`);
  doc.video = validVideo(doc.video);
  doc.safety = cleanSafety(doc.safety);
  return doc;
}

/**
 * Whether a journey is fit to show. Strict is for anything a model wrote;
 * the hand-written journeys converted from version 1 are held to the rules
 * that keep the page working, not to the rules about variety.
 */
export function validateDoc(doc, { strict = true } = {}) {
  const errors = [];
  const warnings = [];
  if (!doc || typeof doc !== 'object') return { ok: false, errors: ['No journey.'], warnings };
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(doc.slug || '')) errors.push('slug must be lowercase words joined by hyphens');
  for (const k of ['title', 'place', 'country', 'teaser', 'lede', 'when']) {
    if (!String(doc[k] || '').trim()) errors.push(`${k} is empty`);
  }
  if (!REGIONS.some((r) => r.id === doc.region)) errors.push('region is not one of the known regions');
  if (!validPoint(doc.center)) errors.push('center is not a real coordinate');
  const m = doc.months || {};
  const all = [...(m.best || []), ...(m.good || []), ...(m.avoid || [])];
  if (!(m.best || []).length) errors.push('months.best is empty');
  if (!all.every((x) => Number.isInteger(x) && x >= 1 && x <= 12)) errors.push('months must be whole numbers from 1 to 12');
  const d = doc.days || [];
  if (d.length !== 2 || !(d[0] >= 1 && d[0] <= d[1] && d[1] <= 30)) errors.push('days must be [shortest, longest] between 1 and 30');
  if (!['Slow', 'Steady', 'Full'].includes(doc.pace)) errors.push('pace must be Slow, Steady or Full');
  if (![1, 2, 3].includes(doc.cost)) errors.push('cost must be 1, 2 or 3');

  const places = Array.isArray(doc.places) ? doc.places : [];
  const ids = new Set();
  places.forEach((p) => {
    if (!/^p\d+$/.test(p.id || '')) errors.push(`place id "${p.id}" should look like p1`);
    else if (ids.has(p.id)) errors.push(`place id ${p.id} is used twice`);
    ids.add(p.id);
    if (!p.name || !p.q || !p.note) errors.push(`place ${p.id} needs a name, a query and a note`);
  });
  if (strict && (places.length < 5 || places.length > 20)) errors.push(`needs 5 to 20 places, has ${places.length}`);

  const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
  const used = new Set();
  const kinds = new Set();
  let prose = 0;
  blocks.forEach((b, i) => {
    if (!BLOCK_TYPES.includes(b.type)) { errors.push(`block ${i} has an unknown type`); return; }
    kinds.add(b.type);
    if (TEXT_BLOCKS.includes(b.type) && !String(b.text || '').trim()) errors.push(`block ${i} (${b.type}) has no text`);
    if (b.type === 'photo' && !String(b.query || '').trim() && !(b.photos || []).length) errors.push(`block ${i} (photo) has no query`);
    if (b.type === 'video' && !String(b.query || '').trim() && !b.video) errors.push(`block ${i} (video) has no query`);
    if (b.type === 'day' && (b.items || []).length < 2) errors.push(`block ${i} (day) needs at least two times`);
    textsOf(b).forEach((t) => {
      for (const [, id] of t.matchAll(TOKEN)) {
        if (!ids.has(id)) errors.push(`block ${i} mentions {${id}}, which is not in places`);
        used.add(id);
      }
    });
    if (b.type === 'prose') prose += words(b.text);
  });
  places.forEach((p) => {
    if (!used.has(p.id)) (strict ? errors : warnings).push(`place ${p.id} (${p.name}) is never mentioned in the text`);
  });

  if (strict) {
    if (!kinds.has('photo')) errors.push('needs at least one photo block');
    if (blocks.filter((b) => b.type === 'photo').length > 6) errors.push('no more than six photo blocks');
    if (blocks.filter((b) => b.type === 'video').length > 4) errors.push('no more than four video blocks');
    if (!cleanSafety(doc.safety)) errors.push('safety needs the current advisory level, what it means for these places, and what to watch for');
    if (EXTRAS.filter((k) => kinds.has(k)).length < 2) errors.push('use at least two kinds of block besides prose, headings and photos');
    if (prose < 450) errors.push(`the prose is too short (${prose} words)`);
    if (prose > 2800) errors.push(`the prose is too long (${prose} words)`);
    // Readers lost their place in journeys without sections.
    const firstText = blocks.find((b) => b.type !== 'photo');
    if (firstText && firstText.type !== 'heading') errors.push('the first section needs a heading saying where and for how long');
    if (blocks.filter((b) => b.type === 'heading').length < 2) errors.push('divide the journey into sections, each starting with a heading');
    const shape = blocks.filter((b) => b.type !== 'photo').map((b) => b.type).join(',');
    if (/^(heading,prose(,prose)?,?)+$/.test(`${shape},`.replace(/,$/, '')) && kinds.has('heading')) {
      warnings.push('the shape is a heading–paragraph ladder, which reads like a template');
    }
  }
  return { ok: !errors.length, errors, warnings };
}

/** Text with tokens, as parts to render: [{ text }] and [{ place: 'p3' }]. */
export function tokenize(text) {
  const parts = [];
  let at = 0;
  for (const m of String(text || '').matchAll(TOKEN)) {
    if (m.index > at) parts.push({ text: text.slice(at, m.index) });
    parts.push({ place: m[1] });
    at = m.index + m[0].length;
  }
  if (at < String(text || '').length) parts.push({ text: text.slice(at) });
  return parts;
}

/** Tokens replaced by names, for anywhere that is not the page. */
export function plainText(text, places) {
  const names = new Map((places || []).map((p) => [p.id, p.name]));
  return String(text || '').replace(TOKEN, (m, id) => names.get(id) || '');
}

export function paragraphs(text) {
  return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

/*
 * Where a journey's video goes in its blocks: at the end of the first
 * section, once the reader knows what the trip is and before the detail,
 * rather than below everything, where few readers ever scroll. A section
 * starts at a heading, or at a paragraph carrying a section label.
 */
export function videoSpot(blocks) {
  const list = blocks || [];
  const second = list.findIndex((b, i) => i > 0 && (b.type === 'heading' || (b.type === 'prose' && b.kicker)));
  if (second !== -1) return second;
  const prose = list.findIndex((b) => b.type === 'prose');
  return prose === -1 ? list.length : prose + 1;
}

/** Only what the writer produces, for handing a journey back to a model. */
export function modelFields(doc) {
  const out = {};
  for (const k of WRITER_SCHEMA.required) out[k] = doc[k];
  out.cover = { query: doc.cover.query, place: doc.cover.place };
  out.places = doc.places.map(({ id, name, q, note, kind }) => ({ id, name, q, note, kind: kind || 'sight' }));
  out.blocks = doc.blocks.map((b) => {
    const o = {};
    for (const k of BLOCK.required) o[k] = b[k];
    return o;
  });
  return out;
}

/** The card for the catalogue: no prose, but enough to search on. */
export function summaryOf(doc) {
  return {
    slug: doc.slug,
    title: doc.title,
    place: doc.place,
    country: doc.country,
    region: doc.region,
    center: doc.center,
    months: doc.months,
    days: doc.days,
    pace: doc.pace,
    mood: doc.mood,
    teaser: doc.teaser,
    cover: (doc.cover && doc.cover.photo) || null,
    coverQuery: (doc.cover && doc.cover.query) || doc.title,
    search: foldText([
      doc.title, doc.place, doc.country, regionLabel(doc.region), ...(doc.mood || []),
      ...(doc.places || []).map((p) => p.name),
    ].join(' ')),
  };
}

/**
 * An Unsplash picture at a width. Their links are resized on request, so one
 * photograph serves a phone and a 5K screen without ever being stored here —
 * which their terms require anyway.
 */
export function imageURL(media, width, quality = 80) {
  if (!media || !media.raw) return '';
  const w = Math.round(Math.min(width, media.width || width));
  return `${media.raw}${media.raw.includes('?') ? '&' : '?'}w=${w}&q=${quality}&auto=format&fit=max`;
}

export function srcSet(media, widths) {
  if (!media || !media.raw) return undefined;
  const max = media.width || Infinity;
  const list = widths.filter((w) => w <= max);
  if (!list.length) list.push(Math.min(widths[0], max));
  return list.map((w) => `${imageURL(media, w)} ${w}w`).join(', ');
}

/*
 * Where a paragraph names a place: the full name, or failing that its first
 * two or more words — "Fushimi Inari" for Fushimi Inari Taisha. Never a single
 * word, or "Nara Park" would claim the sentence about the city of Nara.
 */
function findName(text, name) {
  const lower = text.toLowerCase();
  const parts = name.split(/\s+/);
  for (let n = parts.length; n >= Math.min(2, parts.length); n -= 1) {
    const candidate = parts.slice(0, n).join(' ');
    const at = lower.indexOf(candidate.toLowerCase());
    if (at >= 0) return { at, length: candidate.length };
  }
  return null;
}

function joinList(items) {
  if (items.length < 2) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * A version 1 journey in the version 2 shape.
 *
 * Each chapter becomes a heading and a paragraph, and each moment becomes a
 * place written into that paragraph where the paragraph already names it.
 * The ones it never names are gathered into a closing line, so every place
 * stays tappable.
 */
export function fromV1(j) {
  const places = [];
  const blocks = [];
  j.chapters.forEach((c, ci) => {
    let text = c.body;
    const missed = [];
    c.moments.forEach((m) => {
      const id = `p${places.length + 1}`;
      places.push({ id, name: m.name, q: m.q || `${m.name}, ${c.where}, ${j.country}`, note: m.note, kind: 'sight' });
      const found = findName(text, m.name);
      if (found) text = `${text.slice(0, found.at)}{${id}}${text.slice(found.at + found.length)}`;
      else missed.push(`{${id}}`);
    });
    if (missed.length) text += `\n\nWorth the stop: ${joinList(missed)}.`;
    blocks.push({ ...BLANK, type: 'heading', text: c.title, kicker: `${c.span} · ${c.where}` });
    blocks.push({ ...BLANK, type: 'prose', text });
    if (ci === 0 || ci === 2) {
      blocks.push({ ...BLANK, type: 'photo', query: `${c.where} ${j.country}`, caption: c.where, layout: 'wide' });
    }
  });
  return normaliseDoc({
    slug: j.slug,
    title: j.title,
    place: j.place,
    country: j.country,
    region: j.region,
    center: j.center,
    months: j.months,
    when: j.when,
    days: j.days,
    pace: j.pace,
    cost: j.cost,
    mood: j.mood,
    teaser: j.teaser,
    lede: j.lede,
    cover: { query: j.cover, place: null },
    places,
    blocks,
    know: j.know,
    sources: [],
    videoQuery: `${j.place} travel`,
  });
}
