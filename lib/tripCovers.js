/*
 * The photo at the head of each trip in the list, remembered on this device.
 *
 * A trip that has no cover of its own borrows one from its first located stop,
 * which takes a second read after the trips themselves arrive. Until it lands
 * every row draws its placeholder, on every refresh, even though the picture
 * itself is sitting in the browser's cache. Keeping which photo belongs to
 * which trip means the row can ask for it in the first paint.
 *
 * Only Google photo references — no names, dates or anything else about a
 * trip — and only for trips still in the list, so leaving one forgets it.
 * Dropped after a month, which is as long as Google's terms allow its content
 * to be held, and about as long as a reference goes on working anyway.
 */
export const COVERS_KEY = 'wander-trip-covers-v1';
export const COVERS_KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** What to keep: the fresh answer, filled in from what was kept, for these trips only. */
export function mergeCovers(kept, fresh, tripIds) {
  const ids = new Set(tripIds || []);
  const out = {};
  ids.forEach((id) => {
    const ref = (fresh && fresh[id]) || (kept && kept[id]) || null;
    if (typeof ref === 'string' && ref.startsWith('places/')) out[id] = ref;
  });
  return out;
}

export function readCovers(now = Date.now()) {
  try {
    const held = JSON.parse(localStorage.getItem(COVERS_KEY));
    if (!held || typeof held !== 'object' || now - held.at > COVERS_KEEP_MS) return {};
    return held.refs && typeof held.refs === 'object' ? held.refs : {};
  } catch { return {}; }
}

export function keepCovers(covers, now = Date.now()) {
  try {
    localStorage.setItem(COVERS_KEY, JSON.stringify({ at: now, refs: covers }));
  } catch { /* this session still has it */ }
}
