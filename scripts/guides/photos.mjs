/*
 * Filling a guide's photographs, from whichever library has the picture.
 *
 * Unsplash is asked first: it is a photographers' library, and its pictures
 * carry the light and composition a journal wants. Where it has nothing — a
 * named terrace, a particular harbour, a street that is famous locally and
 * nowhere else — Wikimedia Commons is asked instead, because that is exactly
 * what its volunteers photograph.
 */
import { findPhotos, unsplashReady } from './unsplash.mjs';
import { findCommonsPhotos, placeFor } from './commons.mjs';

/*
 * Searches Unsplash recently had nothing for. They are skipped for a week, so
 * each hour's fifty requests go to searches that might still succeed rather
 * than to the same misses every round. A rewritten search is a new query and
 * is tried straight away. Commons has no such limit and is always asked.
 */
const MISS_DAYS = 7;

/** Whether a search in a set of misses came up empty within the last week. */
export function rested(misses, query, today) {
  const at = misses && misses[query];
  return !!at && (Date.parse(today) - Date.parse(at)) / 86400000 < MISS_DAYS;
}

export function recentlyMissed(doc, query, today) {
  return rested(doc.photoMisses, query, today);
}

function noteMiss(doc, query, today) {
  doc.photoMisses = { ...(doc.photoMisses || {}), [query]: today };
}

/**
 * Photographs for one spot: Unsplash unless it is resting or already spent,
 * then Commons for whatever is still missing.
 */
async function forSpot(doc, query, { need, orientation, used, today, log }) {
  const resting = recentlyMissed(doc, query, today);
  let found = resting ? [] : await findPhotos(query, { count: need, orientation, avoid: used });
  // Only a real miss counts: a search cut short by the hourly limit is tried again next hour.
  if (!found.length && !resting && unsplashReady()) noteMiss(doc, query, today);
  if (found.length < need) {
    const more = await findCommonsPhotos(query, {
      count: need - found.length, orientation, avoid: used, place: placeFor(doc, query), log,
    });
    found = [...found, ...more];
  }
  found.forEach((m) => used.add(m.id));
  return found;
}

/**
 * Give a guide the photographs it is missing. Photographs rejected by the
 * review, and ones already used elsewhere in the same guide, are never
 * chosen again.
 */
export async function attachMedia(doc, { rejected = new Set(), log = () => {} } = {}) {
  const used = new Set([...rejected]);
  if (doc.cover && doc.cover.photo) used.add(doc.cover.photo.id);
  doc.blocks.forEach((b) => (b.photos || []).forEach((m) => used.add(m.id)));
  const today = new Date().toISOString().slice(0, 10);
  let added = 0;
  try {
    if (doc.cover && !doc.cover.photo) {
      const [m] = await forSpot(doc, doc.cover.query, { need: 1, orientation: 'landscape', used, today, log });
      if (m) { doc.cover.photo = m; added += 1; }
    }
    for (const b of doc.blocks) {
      if (b.type !== 'photo') continue;
      const need = b.layout === 'pair' ? 2 : 1;
      if ((b.photos || []).length >= need) continue;
      const found = await forSpot(doc, b.query, {
        need: need - (b.photos || []).length,
        orientation: b.layout === 'wide' ? 'landscape' : 'portrait',
        used, today, log,
      });
      b.photos = [...(b.photos || []), ...found].slice(0, need);
      added += found.length;
    }
  } catch (e) {
    log(`photographs: ${e.message}`);
  }
  return added;
}
