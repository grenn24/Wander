/*
 * The picture at the head of a trip.
 *
 * Two kinds, and a trip has at most one of them. A cover of its own is a file
 * in the trip-covers bucket — uploaded, or drawn for the trip — and the trip
 * holds its path. Otherwise a reference to a Google photograph of a place,
 * which is a string and no file at all, served through the photo route.
 *
 * The bucket is public, so a cover of its own is simply a URL: no signing, no
 * request per row in a list of trips. The path carries a random name under the
 * trip's id, so it is not guessable and is never listed.
 */
export const COVER_BUCKET = 'trip-covers';

const base = () => (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');

/** The Google photograph a trip was given, if that is what its reference is. */
function placeRef(trip) {
  const ref = trip && trip.cover_ref;
  return typeof ref === 'string' && /^places\//.test(ref) ? ref : null;
}

/** Where a cover's file is served from, or null if that is not a path. */
export function coverFileURL(path, origin = base()) {
  if (typeof path !== 'string' || !path || !origin) return null;
  // Only ever a path inside the bucket: never an arbitrary URL.
  if (!/^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,120}$/i.test(path)) return null;
  return `${origin}/storage/v1/object/public/${COVER_BUCKET}/${path}`;
}

/**
 * What to draw for a trip: its own picture, else the place photograph it was
 * given, else nothing at all and the list draws its placeholder.
 */
export function coverURL(trip, width = 400, origin = base()) {
  const own = coverFileURL(trip && trip.cover_path, origin);
  if (own) return own;
  const ref = placeRef(trip);
  return ref ? `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${Math.round(width)}` : null;
}

/**
 * The cover as the image viewer takes a picture: a file of our own is a URL,
 * a Google photograph a reference the viewer fetches at the size it needs.
 */
export function coverPhoto(trip, origin = base()) {
  const own = coverFileURL(trip && trip.cover_path, origin);
  if (own) return { url: own };
  const ref = placeRef(trip);
  return ref ? { ref } : null;
}

/**
 * The cover for the head of the trip's own page, or null to draw the plain
 * heading. A picture that has already failed to load is not offered again: an
 * offline reader, or a file that has gone, would otherwise be left with a dark
 * empty box where the title should be.
 */
export function heroCoverURL(trip, broken = '', width = 1920, origin = base()) {
  const url = coverURL(trip, width, origin);
  return url && url !== broken ? url : null;
}

/** Where a new cover for this trip goes: a random name under the trip's id. */
export function coverPathFor(tripId, extension = 'webp', id = crypto.randomUUID()) {
  return `${tripId}/${id}.${extension}`;
}
