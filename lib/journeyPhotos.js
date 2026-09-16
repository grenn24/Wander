import { placesKey, searchPlaces, placeDetails } from './places.js';

/*
 * Google photographs for journeys that have none of their own.
 *
 * Journeys written by the journey service carry library photographs chosen
 * when they were written. The ones that do not — the hand-written few before
 * they are imported, or a journey written without an Unsplash key — borrow a
 * Google place photo for the cover instead.
 *
 * Nothing here is stored. Google allows keeping a place ID, never its
 * photographs, so these are looked up when a page renders and last only as
 * long as that render is cached.
 */
async function photoFor(query) {
  if (!placesKey() || !query) return null;
  try {
    const [hit] = await searchPlaces(query, 1);
    if (!hit || !hit.photo_ref) return null;
    const shot = (hit.photos || [])[0] || {};
    return { ref: hit.photo_ref, author: shot.author || '', authorUri: shot.authorUri || '' };
  } catch (e) {
    console.error(`[journeys] photo for "${query}" failed:`, e.message);
    return null;
  }
}

/** slug -> a Google cover, for catalogue cards without a photograph. */
export async function fallbackCovers(summaries) {
  const need = summaries.filter((s) => !s.cover);
  const found = await Promise.all(need.map((s) => photoFor(s.coverQuery)));
  return Object.fromEntries(need.map((s, i) => [s.slug, found[i]]));
}

/** A Google cover for one journal, when it has no photograph of its own. */
export async function heroFallback(doc) {
  if (doc.cover && doc.cover.photo) return null;
  const place = doc.cover && doc.cover.place && (doc.places || []).find((p) => p.id === doc.cover.place);
  if (place && place.place_id && placesKey()) {
    try {
      const details = await placeDetails(place.place_id);
      if (details.photos[0]) return details.photos[0];
    } catch (e) {
      console.error(`[journeys] cover details for ${doc.slug} failed:`, e.message);
    }
  }
  return photoFor((doc.cover && doc.cover.query) || doc.title);
}
