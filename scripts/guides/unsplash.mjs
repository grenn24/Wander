/*
 * Photographs from Unsplash.
 *
 * Their API terms decide most of this file: images are used through the links
 * the API returns (never downloaded and rehosted), each use is reported to the
 * photo's download endpoint, and every photograph is credited to its
 * photographer and to Unsplash with a referral link.
 *
 * The links resize on request, so storing them costs nothing in quality: one
 * link serves a thumbnail and a full-screen view alike.
 */
const API = 'https://api.unsplash.com';
const UTM = 'utm_source=wander&utm_medium=referral';
let exhausted = false;

function key() {
  const k = process.env.UNSPLASH_ACCESS_KEY || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

export const unsplashReady = () => !!key() && !exhausted;

async function get(path) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Client-ID ${key()}`, 'Accept-Version': 'v1' },
    signal: AbortSignal.timeout(30000),
  });
  const remaining = Number(res.headers.get('x-ratelimit-remaining'));
  /*
   * Demo keys allow fifty requests an hour, but the count comes back from
   * several of Unsplash's servers and dips at random: one search reported two
   * left and the next nineteen. Stopping on a low reading abandoned rounds
   * that had requests to spare, so only a refusal or a true zero stops a run.
   */
  if (Number.isFinite(remaining) && remaining <= 0) exhausted = true;
  if (res.status === 403 || res.status === 429) { exhausted = true; throw new Error('Unsplash rate limit reached'); }
  if (!res.ok) throw new Error(`Unsplash returned ${res.status}`);
  return res.json();
}

function media(p) {
  return {
    provider: 'unsplash',
    id: p.id,
    raw: p.urls.raw,
    width: p.width,
    height: p.height,
    color: p.color || null,
    alt: p.alt_description || p.description || '',
    author: (p.user && p.user.name) || 'Unsplash photographer',
    authorUrl: `${p.user && p.user.links ? p.user.links.html : 'https://unsplash.com'}?${UTM}`,
    pageUrl: `${p.links.html}?${UTM}`,
    download: p.links.download_location,
  };
}

async function track(m) {
  try {
    const url = new URL(m.download);
    await get(`${url.pathname}${url.search}`);
  } catch (e) { /* reporting a use must never lose the photograph */ }
}

const MOODS = /\b(at|in|during|under)\s+(the\s+)?(early\s+|late\s+)?(sunrise|sunset|dawn|dusk|night|twilight|golden hour|blue hour|first light|last light|morning|evening|afternoon|winter|summer|spring|autumn|fall|snow|mist|fog|january|february|march|april|may|june|july|august|september|october|november|december)(\s+light)?\b/gi;

/*
 * Simpler ways to ask for the same picture.
 *
 * Unsplash search matches keywords, not descriptions. "Goblin Valley hoodoos at
 * dawn and Chesler Park sandstone spires, Utah" finds nothing; "Goblin Valley"
 * finds plenty. So a query loses its times of day and seasons, then anything
 * after an "and", then all but its first few words, until something matches.
 */
export function queryVariants(query) {
  const q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return [];
  const [head, ...rest] = q.split(',').map((s) => s.trim()).filter(Boolean);
  const region = rest.length ? rest[rest.length - 1] : '';
  const plain = head.replace(MOODS, ' ').replace(/\s+and\s+.*$/i, '').replace(/\s+/g, ' ').trim();
  const words = plain.split(' ');
  const join = (...parts) => parts.filter(Boolean).join(' ').trim();
  const out = [q, join(plain, region), join(words.slice(0, 3).join(' '), region), words.slice(0, 2).join(' ')];
  return [...new Set(out.filter((s) => s.length > 2))];
}

const GENERIC = new Set([
  'the', 'and', 'park', 'national', 'state', 'lake', 'river', 'mount', 'mountain', 'valley', 'canyon', 'canyons',
  'garden', 'gardens', 'trail', 'road', 'beach', 'bay', 'island', 'islands', 'old', 'town', 'city',
  'north', 'south', 'east', 'west', 'upper', 'lower', 'great', 'little', 'big', 'new', 'point', 'falls',
  'hot', 'springs', 'temple', 'shrine', 'market', 'street', 'bridge', 'castle', 'palace', 'museum', 'view',
]);
const fold = (s) => String(s || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();

/** The words that name the place in a query: proper names, minus generic ones. */
export function keyWords(query) {
  const head = String(query || '').split(',')[0];
  const names = head.match(/\p{Lu}[\p{L}'’-]+/gu) || [];
  return [...new Set(names.map(fold).filter((w) => w.length > 3 && !GENERIC.has(w)))];
}

/*
 * Whether a photograph is of the place asked for, as far as Unsplash says.
 *
 * Search is generous: "Muley Point" with nothing to match falls through to
 * any sunrise over any canyon, and a sunrise over the Grand Canyon in a
 * journal about Utah is a small lie. When the query names a place, a picture
 * is only used if its description, location or tags name it too — no picture
 * is better than the wrong one.
 */
export function describes(p, words) {
  if (!words.length) return true;
  const text = fold([
    p.alt_description, p.description,
    p.location && [p.location.name, p.location.city, p.location.country].join(' '),
    ...(p.tags || []).map((t) => t.title),
  ].filter(Boolean).join(' '));
  return words.some((w) => text.includes(w));
}

/*
 * Search results carry only a short machine caption ("a large crowd of people
 * in a city square"), never the photograph's location or tags, so a real
 * picture of Jemaa el-Fnaa reads like any square. When the caption cannot
 * settle it, the first few candidates are looked up in full, which is where
 * Unsplash keeps both. Each lookup is a request, so a query gets a small budget.
 */
export async function aboutPlace(candidates, words, { count = 1, budget = { left: 4 }, lookup, ready = unsplashReady }) {
  const sure = candidates.filter((p) => describes(p, words));
  for (const p of candidates) {
    if (sure.length >= count || budget.left <= 0 || !ready()) break;
    if (sure.includes(p)) continue;
    budget.left -= 1;
    try {
      const full = await lookup(p.id);
      if (describes(full, words)) sure.push(full);
    } catch (e) {
      if (!ready()) throw e;
    }
  }
  return sure;
}

/**
 * The best few photographs for a query: large originals first, in the
 * orientation the layout wants, none already used in this guide.
 */
export async function findPhotos(query, { count = 1, orientation = 'landscape', avoid = new Set() } = {}) {
  if (!unsplashReady() || !query) return [];
  const words = keyWords(query);
  const budget = { left: 4 };
  const lookup = (id) => get(`/photos/${encodeURIComponent(id)}`);
  let results = [];
  for (const q of queryVariants(query)) {
    if (!unsplashReady()) break;
    const params = new URLSearchParams({ query: q, per_page: '20', orientation, content_filter: 'high' });
    const body = await get(`/search/photos?${params}`);
    const candidates = (body.results || []).filter((p) => !avoid.has(p.id));
    results = await aboutPlace(candidates, words, { count, budget, lookup });
    if (results.length) break;
  }
  const large = results.filter((p) => p.width >= 2400);
  const picked = [...large, ...results.filter((p) => p.width < 2400)].slice(0, count).map(media);
  for (const m of picked) await track(m);
  return picked;
}
