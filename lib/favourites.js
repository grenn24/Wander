/*
 * Favourites: the trips and guides someone wants to keep close.
 *
 * A trip is known by its id, a guide by its slug. Both live in one table
 * (supabase/schema.sql, favourites) that only the person who made them can
 * read, so this is the whole of it: read them, and set one on or off.
 */

// The table arrives with a migration; a database without it should still work.
export const favouritesMissing = (e) => /42P01|PGRST205|favourites/.test(`${e && e.code} ${e && e.message}`);

export const noFavourites = () => ({ trips: new Set(), guides: new Set() });

/** Everything favourited, as two sets. Throws what the database threw. */
export async function readFavourites(supabase) {
  const { data, error } = await supabase.from('favourites').select('trip_id, guide');
  if (error) throw error;
  const out = noFavourites();
  (data || []).forEach((r) => {
    if (r.trip_id) out.trips.add(r.trip_id);
    if (r.guide) out.guides.add(r.guide);
  });
  return out;
}

/** The same sets with one thing turned on or off, leaving the originals alone. */
export function withFavourite(favs, { tripId, guide }, on) {
  const next = { trips: new Set(favs.trips), guides: new Set(favs.guides) };
  const set = tripId ? next.trips : next.guides;
  const key = tripId || guide;
  if (on) set.add(key); else set.delete(key);
  return next;
}

/**
 * Turn a favourite on or off. Favouriting twice is not an error — the row is
 * already there, which is what was asked for.
 */
export async function setFavourite(supabase, userId, { tripId, guide }, on) {
  if (on) {
    const { error } = await supabase.from('favourites')
      .insert({ user_id: userId, trip_id: tripId || null, guide: tripId ? null : guide });
    if (error && error.code !== '23505') throw error;
    return;
  }
  const q = supabase.from('favourites').delete().eq('user_id', userId);
  const { error } = tripId ? await q.eq('trip_id', tripId) : await q.eq('guide', guide);
  if (error) throw error;
}
