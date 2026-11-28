/**
 * SerpApi, the one door to Google's travel searches: Google Flights for the
 * flight check (lib/realFlights.js) and Google Hotels for the stay check
 * (lib/realStays.js). Server only — SERPAPI_API_KEY is a real secret.
 *
 * One key, one way to call it, and one budget per person: a planned trip that
 * looks up two flights and two hotels spends four searches from the same 40
 * an hour, whichever check asks. A search repeated within the hour is
 * SerpApi's cache and free.
 */

const ENDPOINT = 'https://serpapi.com/search.json';
// A search usually answers in two to five seconds. A plan waits on it, so a
// search that hangs is abandoned and the entry is kept as it was written.
const TIMEOUT_MS = 20000;

export function serpKey() {
  const k = process.env.SERPAPI_API_KEY || '';
  return k && !k.startsWith('REPLACE_WITH') ? k : '';
}

export function serpConfigured() {
  return !!serpKey();
}

// Google's country codes for gl, where they are not ISO's.
const GL = { GB: 'uk' };
export function googleCountry(country) {
  const c = String(country || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? (GL[c] || c.toLowerCase()) : '';
}

/**
 * One search: `engine` and its parameters in, the answer out, or null when
 * Google simply has nothing (an answer, not a failure). Throws when there is
 * no key or SerpApi refuses.
 */
export async function serpSearch(engine, params) {
  const key = serpKey();
  if (!key) throw Object.assign(new Error('SERPAPI_API_KEY is not set.'), { code: 'no_key' });
  const query = new URLSearchParams({
    engine,
    hl: 'en',
    ...Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v != null && v !== '')),
    api_key: key,
  });
  const res = await fetch(`${ENDPOINT}?${query}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => ({}));
  if (body && body.error) {
    if (/no results|hasn't returned any results/i.test(body.error)) return null;
    throw new Error(`SerpApi: ${body.error}`);
  }
  if (!res.ok) throw new Error(`SerpApi returned ${res.status}.`);
  return body;
}

/*
 * Searches are counted (250 a month on the free plan), so each person gets a
 * budget an hour, shared by every check and every caller.
 */
const WINDOW = 3600 * 1000;
export const SEARCHES_PER_HOUR = 40;
const searched = new Map();
export function spendSearches(id, n) {
  if (!id) return true;
  const now = Date.now();
  if (searched.size > 1000) {
    searched.forEach((times, who) => {
      if (!times.length || now - times[times.length - 1] >= WINDOW) searched.delete(who);
    });
  }
  const recent = (searched.get(id) || []).filter((t) => now - t < WINDOW);
  const ok = recent.length + n <= SEARCHES_PER_HOUR;
  if (ok) for (let i = 0; i < n; i += 1) recent.push(now);
  searched.set(id, recent);
  return ok;
}
