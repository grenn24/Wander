import { unstable_cache } from 'next/cache';
import { placesKey, searchPlaces } from './places.js';
import { momentQuery } from './journeys.js';

/*
 * Photographs for journeys, found by name on the server.
 *
 * Journeys are the same for every reader, so each lookup is shared and kept for
 * a week rather than repeated per visit. A failure throws inside the cache and
 * is caught outside it, so a bad minute at Google is never remembered for seven
 * days — the page simply goes without that photo until the next render.
 */
const WEEK = 60 * 60 * 24 * 7;

const lookup = unstable_cache(async (query) => {
  const [hit] = await searchPlaces(query, 1);
  if (!hit || !hit.photo_ref) return null;
  const shot = (hit.photos || [])[0] || {};
  return { ref: hit.photo_ref, author: shot.author || '', authorUri: shot.authorUri || '' };
}, ['journey-photo-v1'], { revalidate: WEEK });

async function photoFor(query) {
  if (!placesKey()) return null;
  try {
    return await lookup(query);
  } catch (e) {
    console.error(`[journeys] photo for "${query}" failed:`, e.message);
    return null;
  }
}

/** slug -> cover photo, for the catalogue. */
export async function coverPhotos(journeys) {
  const found = await Promise.all(journeys.map((j) => photoFor(j.cover)));
  return Object.fromEntries(journeys.map((j, i) => [j.slug, found[i]]));
}

/** The cover and one photograph per moment, for a journal. */
export async function journeyPhotos(j) {
  const moments = j.chapters.flatMap((c) => c.moments);
  const [cover, ...shots] = await Promise.all([
    photoFor(j.cover),
    ...moments.map((m) => photoFor(momentQuery(j, m))),
  ]);
  return {
    cover,
    moments: Object.fromEntries(moments.map((m, i) => [m.id, shots[i]])),
  };
}
