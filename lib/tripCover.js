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
 * trip's id, so it is not guessable and is never listed to a visitor.
 *
 * To the trip's own members it is listed: the trip's folder in the bucket *is*
 * the trip's covers, every one it has had and not had deleted. There is no table
 * of them to drift from the files, and the trip holds only which one is showing.
 */
export const COVER_BUCKET = 'trip-covers';

/**
 * How many covers a trip keeps. Past it a new one waits for the person to delete
 * one, rather than the oldest going without being asked — and a drawing, which
 * costs money, is not made for a picture there is no room to keep.
 */
export const COVER_LIBRARY_MAX = 12;
export const COVER_LIBRARY_FULL = `A trip keeps ${COVER_LIBRARY_MAX} covers. Delete one to add another.`;

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

/**
 * Everything the photo viewer can step through for a trip, and which of it is the
 * cover showing — the default. `covers` is what the trip's folder holds, as
 * coversFrom lists it.
 *
 * A Google photograph that is standing in as the cover (the trip has no file of
 * its own) leads the list, since it is the default and not in the folder.
 */
export function coverSlides(trip, covers, origin = base()) {
  const slides = [];
  const showing = trip && trip.cover_path;
  const own = !!coverFileURL(showing, origin);
  const ref = trip && trip.cover_ref;
  if (!own && typeof ref === 'string' && /^places\//.test(ref)) {
    slides.push({ ref, path: null, kind: 'place', at: null, isDefault: true });
  }
  for (const cover of Array.isArray(covers) ? covers : []) {
    slides.push({ url: cover.url, path: cover.path, kind: cover.kind, at: cover.at, isDefault: own && cover.path === showing });
  }
  return slides;
}

/** "Cover 2 of 9 · drawn 30 Sep": which one this is, and how it came to be. `when` is already written out. */
export function coverCaption(slide, index, total, when = '') {
  const how = slide.kind === 'place' ? 'Google photo' : slide.kind === 'drawn' ? 'drawn'
    : slide.kind === 'upload' ? 'uploaded' : 'added';
  return `Cover ${index + 1} of ${total} · ${[how, slide.kind === 'place' ? '' : when].filter(Boolean).join(' ')}`;
}

/**
 * Where a new cover for this trip goes: a random name under the trip's id. The
 * kind ('upload' or 'drawn') is part of the name, so the trip's covers can say
 * which is which without a record kept anywhere else.
 */
export function coverPathFor(tripId, extension = 'webp', kind = '', id = crypto.randomUUID()) {
  return `${tripId}/${kind ? `${kind}-` : ''}${id}.${extension}`;
}

/** How a cover came to be, from its path: 'upload', 'drawn', or '' for those made before names said. */
export function coverKind(path) {
  const match = /^(upload|drawn)-/.exec(String(path || '').split('/').pop());
  return match ? match[1] : '';
}

const PICTURE = /\.(webp|png|jpe?g)$/i;

/**
 * The covers a trip has kept, newest first, from what the bucket listed in its
 * folder. Folder placeholders and anything not a picture are left out, and so is
 * anything the cover route would refuse to serve.
 *
 * The cover showing is always among them, even if the listing missed it, so the
 * picture in the trip's header is never one the person cannot see in the list.
 */
export function coversFrom(tripId, entries, current = null, origin = base()) {
  const covers = [];
  const seen = new Set();
  const add = (path, at) => {
    const url = coverFileURL(path, origin);
    if (!url || seen.has(path)) return;
    seen.add(path);
    covers.push({ path, url, kind: coverKind(path), at: at || null });
  };
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry && typeof entry.name === 'string' && PICTURE.test(entry.name)) {
      add(`${tripId}/${entry.name}`, entry.created_at);
    }
  }
  // ISO timestamps sort as text. Those without one go last, in the order given.
  covers.sort((a, b) => (b.at || '').localeCompare(a.at || ''));
  if (current && !seen.has(current) && current.startsWith(`${tripId}/`)) {
    const before = covers.length;
    add(current, null);
    if (covers.length > before) covers.unshift(covers.pop());
  }
  return covers;
}

/** What a trip's folder holds, as the person asking is allowed to see it. */
export async function coverEntries(client, tripId) {
  const { data, error } = await client.storage.from(COVER_BUCKET)
    .list(tripId, { limit: 100, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) throw error;
  return data || [];
}

/**
 * Every file a trip has kept, deleted. To be done before the trip itself: who may
 * remove a file is decided by membership of a trip that is about to stop existing.
 * The cover showing is named too, in case the listing cannot be had.
 */
export async function removeAllCovers(client, tripId, current = null) {
  let names = [];
  try { names = (await coverEntries(client, tripId)).map((entry) => `${tripId}/${entry.name}`); }
  catch { /* fall back to the one we know of */ }
  if (current && !names.includes(current)) names.push(current);
  if (names.length) await client.storage.from(COVER_BUCKET).remove(names);
}
