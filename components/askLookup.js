'use client';
import { useEffect, useState } from 'react';
import { searchPlaces } from '@/lib/geo';

/*
 * What the Assistant's maps and pictures share: finding a place an answer
 * named, and not doing it until the reader gets there.
 */

export const located = (a) => a && a.lat != null && a.lng != null
  && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

/** Google's types, read as the app's own categories, for a glyph. */
export function categoryOf(type) {
  const t = String(type || '');
  if (/restaurant|cafe|bakery|bar|food|meal|coffee|tea|dessert|ramen|sushi/.test(t)) return 'food';
  if (/lodging|hotel|hostel|inn|resort|ryokan/.test(t)) return 'lodging';
  if (/store|shop|mall|market|supermarket/.test(t)) return 'shopping';
  if (/station|airport|transit|bus|subway|train|ferry/.test(t)) return 'transport';
  if (/amusement|zoo|aquarium|spa|stadium|gym|bowling|theater|cinema|casino|park$/.test(t)) return 'activity';
  return 'sightseeing';
}

/*
 * A name, looked up once per browser session. Each search is billed, and the
 * thread itself survives a reload; without this every reload of a long
 * conversation paid for all of its maps and pictures again.
 */
const SEEN = 'wander:askplace:';
export function lookup(q, near) {
  try {
    const kept = sessionStorage.getItem(SEEN + q);
    if (kept) return Promise.resolve(JSON.parse(kept));
  } catch { /* storage blocked: search */ }
  return searchPlaces(q, near).then((list) => {
    const first = (list || [])[0] || null;
    if (first) {
      try {
        const { name, label, lat, lng, place_id: id, primary_type: type, photo_ref: ref, photos } = first;
        sessionStorage.setItem(SEEN + q, JSON.stringify({ name, label, lat, lng, place_id: id, primary_type: type, photo_ref: ref, photos }));
      } catch { /* full or blocked */ }
    }
    return first;
  });
}

/** The middle of what the trip has located, to keep a name search near it. */
export function centreOf(activities) {
  const pts = (activities || []).filter(located);
  if (!pts.length) return null;
  return {
    lat: pts.reduce((n, a) => n + Number(a.lat), 0) / pts.length,
    lng: pts.reduce((n, a) => n + Number(a.lng), 0) / pts.length,
    radius: 30000,
  };
}

/**
 * True once the element has come within a screen of the window, and from
 * then on. Maps and photos are billed by the load, and a long conversation
 * holds plenty the reader never scrolls back to.
 */
export function useSeen(ref) {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return undefined; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); }
    }, { rootMargin: '200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, seen]);
  return seen;
}

/** A Google Maps page for a place, for a name to link to. */
export const mapsLink = (name, placeId) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}${placeId ? `&query_place_id=${encodeURIComponent(placeId)}` : ''}`;
