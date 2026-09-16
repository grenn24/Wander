import { keyWords } from './unsplash.mjs';
import { rested } from './photos.mjs';

/*
 * A video for a journey, from YouTube.
 *
 * A model cannot be trusted with video IDs — it invents plausible ones — so
 * videos are found by searching YouTube itself, or given as leads from a web
 * search, and either way kept only if what the API says about them holds up: public and embeddable, between three minutes and
 * an hour, watched enough to be worth watching, recent enough to show the place
 * as it is now, and about the places the journey names. The review agent sees
 * the choice and can turn it down.
 *
 * Quota: a search costs 100 units and the details call 1, of 10,000 a day —
 * about a hundred searches a day. Searches also have a daily cap of their own,
 * and once it is reached the details call still answers, so the two are
 * tracked apart: a run out of searches can still check videos found elsewhere.
 */
const API = 'https://www.googleapis.com/youtube/v3';
let exhausted = false;
let searchesSpent = false;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function key() {
  const k = process.env.YOUTUBE_DATA_API_KEY || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

export const youtubeReady = () => !!key() && !exhausted;
const searchReady = () => youtubeReady() && !searchesSpent;

async function get(path, params) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: key() })}`, {
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = (body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
    const message = (body.error && body.error.message) || `YouTube returned ${res.status}`;
    // The reason code is not always there; the message always says "quota".
    if ((res.status === 403 || res.status === 429) && /quota|rateLimit/i.test(`${reason} ${message}`)) {
      if (path === 'search') searchesSpent = true; else exhausted = true;
    }
    throw new Error(message);
  }
  return body;
}

/** "PT12M3S" -> 723 seconds. */
export function parseDuration(iso) {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso || '');
  if (!m) return 0;
  return (Number(m[1]) || 0) * 86400 + (Number(m[2]) || 0) * 3600 + (Number(m[3]) || 0) * 60 + (Number(m[4]) || 0);
}

const fold = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/*
 * How many views a video needs. A whole destination has a crowded shelf of
 * videos, and ten thousand views keeps the choice to ones people found worth
 * watching. A single stop does not: the best English guide to Valle de la
 * Luna, fourteen minutes and three years old, has about three thousand. So a
 * section's video needs fewer, and the review still watches for the rest.
 */
export const MAIN_VIEWS = 10000;
export const SECTION_VIEWS = 2000;

/*
 * English videos, or ones whose language YouTube does not state. Most uploads
 * never state it, so an unstated one is kept; one stated as Portuguese or
 * Spanish is not, since the journal around it is in English.
 */
const english = (snippet) => {
  const lang = snippet.defaultAudioLanguage || snippet.defaultLanguage || '';
  return !lang || /^en/i.test(lang);
};

/**
 * The best video among YouTube's details for a set of candidates, or null.
 * Popular beats obscure, recent beats old, and nothing is chosen that fails
 * the rules above.
 */
export function chooseVideo(items, { words = [], now = Date.now(), avoid = new Set(), minViews = MAIN_VIEWS } = {}) {
  const ranked = (items || []).map((v) => {
    const snippet = v.snippet || {};
    const seconds = parseDuration(v.contentDetails && v.contentDetails.duration);
    const views = Number((v.statistics && v.statistics.viewCount) || 0);
    const years = (now - (Date.parse(snippet.publishedAt || '') || 0)) / (365.25 * 86400 * 1000);
    const text = fold([snippet.title, snippet.description, ...(snippet.tags || [])].join(' '));
    return { v, snippet, seconds, views, years, text };
  }).filter((x) => !avoid.has(x.v.id)
    && x.v.status && x.v.status.embeddable !== false && x.v.status.privacyStatus === 'public'
    && x.seconds >= 180 && x.seconds <= 3600
    && x.views >= minViews
    && english(x.snippet)
    && x.years <= 6
    && !/#shorts/i.test(x.snippet.title || '')
    && (!words.length || words.some((w) => x.text.includes(w))))
    .sort((a, b) => (Math.log10(b.views + 1) - b.years * 0.35) - (Math.log10(a.views + 1) - a.years * 0.35));
  const best = ranked[0];
  if (!best) return null;
  return {
    provider: 'youtube',
    id: best.v.id,
    title: best.snippet.title || '',
    channel: best.snippet.channelTitle || '',
    channelId: best.snippet.channelId || '',
    publishedAt: best.snippet.publishedAt || '',
    seconds: best.seconds,
    views: best.views,
  };
}

export function videoQueryFor(doc) {
  return (doc.videoQuery || `${doc.place} travel`).trim();
}

/*
 * The searches to try, in order. Journeys written before videoQuery existed
 * search on their whole place line ("Escalante, Cedar Mesa & Utah's quiet
 * canyon country travel"), which YouTube matches poorly, so the first name in
 * it is tried next.
 */
export function videoQueries(doc) {
  const head = String(doc.place || '').split(/[,&;]| and /)[0].trim();
  return [...new Set([videoQueryFor(doc), head && `${head} travel`].filter(Boolean))];
}

/*
 * What a video has to mention to be about this journey: the names in its
 * search, except the country — every video about Japan says Japan — and the
 * names of the journey's own places.
 */
export function videoWords(doc) {
  const country = new Set(fold(doc.country).split(/\s+/).filter(Boolean));
  const fromQuery = keyWords(videoQueryFor(doc)).filter((w) => !country.has(w));
  const fromPlaces = (doc.places || []).flatMap((p) => keyWords(p.name)).filter((w) => !country.has(w));
  return [...new Set([...fromQuery, ...fromPlaces])];
}

/** The best video YouTube has for one search, or null. */
async function findVideo(q, { words, avoid, log, minViews = MAIN_VIEWS }) {
  try {
    const found = await get('search', {
      part: 'snippet', type: 'video', maxResults: '15', q,
      videoEmbeddable: 'true', safeSearch: 'strict', relevanceLanguage: 'en',
    });
    const ids = (found.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) { log(`video: nothing found for "${q}"`); return null; }
    const details = await get('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.join(',') });
    const pick = chooseVideo(details.items, { words, avoid, minViews });
    if (!pick) log(`video: nothing suitable for "${q}"`);
    return pick;
  } catch (e) {
    log(`video: ${e.message}`);
    return null;
  }
}

/** Give a journey its main video if it has none, avoiding any the review turned down. */
/** A video's ID from any of the links YouTube uses for it. */
export function videoIdOf(link) {
  const s = String(link || '').trim();
  if (VIDEO_ID.test(s)) return s;
  const m = /(?:[?&]v=|youtu\.be\/|\/shorts\/|\/embed\/|\/live\/)([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/.exec(s);
  return m ? m[1] : null;
}

/*
 * Videos found some other way — a web search, say — for a search that YouTube
 * could not answer, or could not be asked today. They are looked up in full,
 * one unit for up to fifty, and held to every rule a searched video meets, so
 * a lead is trusted no more than a search result: it is only somewhere to look.
 */
async function fromLeads(links, { words, avoid, log, minViews = MAIN_VIEWS }) {
  const ids = [...new Set((links || []).map(videoIdOf).filter(Boolean))].filter((id) => !avoid.has(id)).slice(0, 50);
  if (!ids.length || !youtubeReady()) return null;
  try {
    const details = await get('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.join(',') });
    return chooseVideo(details.items, { words, avoid, minViews });
  } catch (e) {
    log(`video: ${e.message}`);
    return null;
  }
}

const leadsFor = (doc, query) => (doc.videoLeads && doc.videoLeads[query]) || null;

/*
 * Leads are working notes. Once the spot they were for has its video they are
 * done with, and a journey should not carry them on to its readers.
 */
export function pruneLeads(doc) {
  if (!doc.videoLeads) return;
  const open = new Set(doc.blocks.filter((b) => b.type === 'video' && !b.video).map((b) => b.query));
  if (!doc.video) open.add(videoQueryFor(doc));
  const kept = Object.fromEntries(Object.entries(doc.videoLeads).filter(([q]) => open.has(q)));
  if (Object.keys(kept).length) doc.videoLeads = kept; else delete doc.videoLeads;
}

export async function attachVideo(doc, { rejected = new Set(), log = () => {} } = {}) {
  if (!youtubeReady() || doc.video) return 0;
  const words = videoWords(doc);
  const leads = leadsFor(doc, videoQueryFor(doc));
  const led = leads && await fromLeads(leads, { words, avoid: rejected, log });
  if (led) { doc.video = led; return 1; }
  for (const q of videoQueries(doc)) {
    if (!searchReady()) break;
    const pick = await findVideo(q, { words, avoid: rejected, log });
    if (pick) { doc.video = pick; return 1; }
  }
  return 0;
}

/*
 * Searches that found nothing suitable are rested for a week, as photograph
 * searches are. Without it every round asked again for the same eighteen
 * stops YouTube had nothing for, a hundred units each, and spent a fifth of
 * the day's quota learning nothing. A search cut short by the quota is not a
 * miss, and a rewritten search is tried straight away.
 */
function noteMiss(doc, query, today) {
  if (searchReady()) doc.videoMisses = { ...(doc.videoMisses || {}), [query]: today };
}

/*
 * The main video, then one for each video block still without one. A block's
 * video has to name what its own search names, and no video appears twice in
 * a journey. One search each: a block costs a hundred units of the day's quota.
 */
export async function attachVideos(doc, { rejected = new Set(), log = () => {}, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!youtubeReady()) return 0;
  const used = () => new Set([
    ...rejected,
    ...(doc.video ? [doc.video.id] : []),
    ...doc.blocks.filter((b) => b.type === 'video' && b.video).map((b) => b.video.id),
  ]);
  let added = await attachVideo(doc, { rejected: used(), log });
  const country = new Set(fold(doc.country).split(/\s+/).filter(Boolean));
  for (const b of doc.blocks) {
    if (b.type !== 'video' || b.video || !String(b.query || '').trim() || !youtubeReady()) continue;
    const own = keyWords(b.query).filter((w) => !country.has(w));
    const rules = { words: own.length ? own : videoWords(doc), avoid: used(), log, minViews: SECTION_VIEWS };
    const leads = leadsFor(doc, b.query);
    let pick = leads ? await fromLeads(leads, rules) : null;
    // A rested search is skipped, but leads for it are always looked at: they are news.
    if (!pick && searchReady() && !rested(doc.videoMisses, b.query, today)) {
      pick = await findVideo(b.query, rules);
      if (!pick) noteMiss(doc, b.query, today);
    }
    if (pick) { b.video = pick; added += 1; }
  }
  return added;
}
