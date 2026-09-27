/*
 * What this device remembers about someone's trips, so the list can say it in
 * the first paint rather than filling in when the read lands.
 *
 * Only how many there were. Nothing about any trip in particular, and never
 * taken as fact: the read replaces it the moment it returns.
 */
export const COUNT_KEY = 'wander-trip-count-v1';

export function readTripCount() {
  try {
    // Nothing held is not none: the line waits rather than claiming no trips.
    const held = localStorage.getItem(COUNT_KEY);
    const n = held === null ? NaN : Number(held);
    return Number.isInteger(n) && n >= 0 && n < 10000 ? n : null;
  } catch { return null; }
}

export function keepTripCount(count) {
  try { localStorage.setItem(COUNT_KEY, String(count)); } catch { /* this session still has it */ }
}
