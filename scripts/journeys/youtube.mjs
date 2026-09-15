import { keyWords } from './unsplash.mjs';

/*
 * A video for a journey, from YouTube.
 *
 * A model cannot be trusted with video IDs — it invents plausible ones — so
 * videos are found by searching YouTube itself, then kept only if what the API
 * says about them holds up: public and embeddable, between three minutes and
 * an hour, watched enough to be worth watching, recent enough to show the place
 * as it is now, and about the places the journey names. The review agent sees
 * the choice and can turn it down.
 *
 * Quota: a search costs 100 units and the details call 1, of 10,000 a day —
 * about a hundred journeys a day.
 */
const API = 'https://www.googleapis.com/youtube/v3';
let exhausted = false;

function key() {
  const k = process.env.YOUTUBE_DATA_API_KEY || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

export const youtubeReady = () => !!key() && !exhausted;

async function get(path, params) {
  const res = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key: key() })}`, {
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = (body.error && body.error.errors && body.error.errors[0] && body.error.errors[0].reason) || '';
    if (res.status === 403 && /quota|rateLimit/i.test(reason)) exhausted = true;
    throw new Error((body.error && body.error.message) || `YouTube returned ${res.status}`);
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

/**
 * The best video among YouTube's details for a set of candidates, or null.
 * Popular beats obscure, recent beats old, and nothing is chosen that fails
 * the rules above.
 */
export function chooseVideo(items, { words = [], now = Date.now(), avoid = new Set() } = {}) {
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
    && x.views >= 10000
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

/** Give a journey a video if it has none, avoiding any the review turned down. */
export async function attachVideo(doc, { rejected = new Set(), log = () => {} } = {}) {
  if (!youtubeReady() || doc.video) return 0;
  const words = videoWords(doc);
  try {
    for (const q of videoQueries(doc)) {
      if (!youtubeReady()) break;
      const found = await get('search', {
        part: 'snippet', type: 'video', maxResults: '15', q,
        videoEmbeddable: 'true', safeSearch: 'strict', relevanceLanguage: 'en',
      });
      const ids = (found.items || []).map((i) => i.id && i.id.videoId).filter(Boolean);
      if (!ids.length) { log(`video: nothing found for "${q}"`); continue; }
      const details = await get('videos', { part: 'snippet,contentDetails,statistics,status', id: ids.join(',') });
      const pick = chooseVideo(details.items, { words, avoid: rejected });
      if (!pick) { log(`video: nothing suitable for "${q}"`); continue; }
      doc.video = pick;
      return 1;
    }
  } catch (e) {
    log(`video: ${e.message}`);
  }
  return 0;
}
