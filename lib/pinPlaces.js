'use client';
import { authHeader } from '@/lib/supabase';
import { pinQueries, applyPins } from '@/lib/geo';

/**
 * Put each new entry on its exact spot before it is written.
 *
 * The words a model chooses ("Ralph Lauren Ginza, Ginza, Tokyo") are a search,
 * not an address. Google's answer is the address: the entry leaves here with
 * its street address in `location`, its pin and its photo, so it is right the
 * first time it is drawn.
 *
 * Each place goes with its name, kind and day, so a chain resolves to the
 * branch that fits, and an uncertain match gets the same second opinion the
 * planner and the command bar use.
 *
 * Never throws. Whatever cannot be found is returned as it came.
 */
export async function pinPlaces(drafts, bias = '') {
  const list = Array.isArray(drafts) ? drafts : [];
  const items = pinQueries(list);
  if (!items.length) return list;
  try {
    const res = await fetch('/api/places/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify({ items, bias, reviewAmbiguous: true }),
    });
    if (!res.ok) return list;
    const { results } = await res.json();
    return applyPins(list, results);
  } catch {
    return list;
  }
}
