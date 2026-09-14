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
  // Demo keys allow 50 requests an hour. Stop before the last one rather than
  // after a refusal, and leave the rest for the next run.
  if (Number.isFinite(remaining) && remaining < 3) exhausted = true;
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

/**
 * The best few photographs for a query: large originals first, in the
 * orientation the layout wants, none already used in this journey.
 */
export async function findPhotos(query, { count = 1, orientation = 'landscape', avoid = new Set() } = {}) {
  if (!unsplashReady() || !query) return [];
  const params = new URLSearchParams({ query, per_page: '12', orientation, content_filter: 'high' });
  const body = await get(`/search/photos?${params}`);
  const results = (body.results || []).filter((p) => !avoid.has(p.id));
  const large = results.filter((p) => p.width >= 2400);
  const picked = [...large, ...results.filter((p) => p.width < 2400)].slice(0, count).map(media);
  for (const m of picked) await track(m);
  return picked;
}

/**
 * Give a journey the photographs it is missing. Photographs rejected by the
 * review, and ones already used elsewhere in the same journey, are never
 * chosen again.
 */
export async function attachMedia(doc, { rejected = new Set(), log = () => {} } = {}) {
  if (!unsplashReady()) return 0;
  const used = new Set([...rejected]);
  if (doc.cover && doc.cover.photo) used.add(doc.cover.photo.id);
  doc.blocks.forEach((b) => (b.photos || []).forEach((m) => used.add(m.id)));
  let added = 0;
  try {
    if (doc.cover && !doc.cover.photo) {
      const [m] = await findPhotos(doc.cover.query, { avoid: used });
      if (m) { doc.cover.photo = m; used.add(m.id); added += 1; }
    }
    for (const b of doc.blocks) {
      if (b.type !== 'photo') continue;
      const need = b.layout === 'pair' ? 2 : 1;
      if ((b.photos || []).length >= need) continue;
      const found = await findPhotos(b.query, {
        count: need,
        orientation: b.layout === 'wide' ? 'landscape' : 'portrait',
        avoid: used,
      });
      found.forEach((m) => used.add(m.id));
      b.photos = [...(b.photos || []), ...found].slice(0, need);
      added += found.length;
    }
  } catch (e) {
    log(`photographs: ${e.message}`);
  }
  return added;
}
