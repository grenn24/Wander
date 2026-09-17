/*
 * Favourites: the trips and journeys someone wants to keep close.
 *
 * A trip is known by its id, a journey by its slug. Both live in one table
 * (supabase/schema.sql, favourites) that only the person who made them can
 * read, so this is the whole of it: read them, and set one on or off.
 */

// The table arrives with a migration; a database without it should still work.
export const favouritesMissing = (e) => /42P01|PGRST205|favourites/.test(`${e && e.code} ${e && e.message}`);

export const noFavourites = () => ({ trips: new Set(), journeys: new Set() });

/** Everything favourited, as two sets. Throws what the database threw. */
export async function readFavourites(supabase) {
  const { data, error } = await supabase.from('favourites').select('trip_id, journey');
  if (error) throw error;
  const out = noFavourites();
  (data || []).forEach((r) => {
    if (r.trip_id) out.trips.add(r.trip_id);
    if (r.journey) out.journeys.add(r.journey);
  });
  return out;
}

/** The same sets with one thing turned on or off, leaving the originals alone. */
export function withFavourite(favs, { tripId, journey }, on) {
  const next = { trips: new Set(favs.trips), journeys: new Set(favs.journeys) };
  const set = tripId ? next.trips : next.journeys;
  const key = tripId || journey;
  if (on) set.add(key); else set.delete(key);
  return next;
}

/**
 * Turn a favourite on or off. Favouriting twice is not an error — the row is
 * already there, which is what was asked for.
 */
export async function setFavourite(supabase, userId, { tripId, journey }, on) {
  if (on) {
    const { error } = await supabase.from('favourites')
      .insert({ user_id: userId, trip_id: tripId || null, journey: tripId ? null : journey });
    if (error && error.code !== '23505') throw error;
    return;
  }
  const q = supabase.from('favourites').delete().eq('user_id', userId);
  const { error } = tripId ? await q.eq('trip_id', tripId) : await q.eq('journey', journey);
  if (error) throw error;
}
