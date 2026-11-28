/**
 * Real hotels for a stay: the property itself, where it is, its own check-in
 * and check-out times, and what it costs for those dates, from Google Hotels
 * through SerpApi (serpapi.com/google-hotels-api). Server only.
 *
 * A model can name a hotel and the nights; it cannot know the rate for
 * 3–6 December or that check-in is from 3pm. Google Hotels can. The pure
 * parts — reading an answer, matching the hotel by name, turning it into the
 * stay's fields — are exported for the tests.
 */
import { serpSearch, googleCountry } from './serpApi.js';

const str = (v, n = 160) => String(v == null ? '' : v).trim().slice(0, n);
const num = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** "3:00 PM" -> "15:00", "12 PM" -> "12:00", "11:30 am" -> "11:30"; else ''. */
export function clock24(v) {
  const m = String(v || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?\s*[Mm]\.?$/);
  if (!m) return '';
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  const min = m[2] || '00';
  if (h > 23 || Number(min) > 59) return '';
  return `${String(h).padStart(2, '0')}:${min}`;
}

function readOne(p) {
  if (!p || typeof p !== 'object' || !str(p.name)) return null;
  const g = p.gps_coordinates || {};
  const prices = Array.isArray(p.prices) ? p.prices : [];
  const cheapest = prices
    .filter((o) => o && o.rate_per_night && num(o.rate_per_night.extracted_lowest))
    .sort((a, b) => a.rate_per_night.extracted_lowest - b.rate_per_night.extracted_lowest)[0];
  const cancel = prices.find((o) => o && o.free_cancellation && o.free_cancellation_until_date);
  return {
    name: str(p.name, 120),
    token: str(p.property_token, 400),
    lat: Number.isFinite(Number(g.latitude)) ? Number(g.latitude) : null,
    lng: Number.isFinite(Number(g.longitude)) ? Number(g.longitude) : null,
    address: str(p.address, 200),
    check_in_time: clock24(p.check_in_time),
    check_out_time: clock24(p.check_out_time),
    nightly: num(p.rate_per_night && p.rate_per_night.extracted_lowest),
    total: num(p.total_rate && p.total_rate.extracted_lowest),
    rating: num(p.overall_rating),
    reviews: num(p.reviews),
    stars: num(p.extracted_hotel_class) || num(String(p.hotel_class || '').match(/\d/)?.[0]),
    cheapest_at: cheapest ? str(cheapest.source, 60) : '',
    free_cancel_until: cancel ? str(cancel.free_cancellation_until_date, 30) : '',
  };
}

/**
 * Every hotel in a Google Hotels answer. A query that names one hotel can
 * come back as that hotel's own page rather than a list, so both shapes are
 * read. A property with no name is left out.
 */
export function readHotels(body) {
  if (!body || typeof body !== 'object') return [];
  if (Array.isArray(body.properties)) return body.properties.map(readOne).filter(Boolean);
  const one = readOne(body);
  return one && (one.lat != null || one.nightly != null) ? [one] : [];
}

/*
 * Words that say what a place is rather than which one: "Stay at the Hotel
 * Gracery" and "Hotel Gracery Shinjuku" are the same hotel.
 */
const FILLER = new Set([
  'the', 'a', 'an', 'at', 'in', 'of', 'and', 'by', 'stay', 'check', 'checkin', 'night', 'nights',
  'hotel', 'hotels', 'resort', 'inn', 'hostel', 'apartment', 'apartments', 'suites', 'suite',
]);
const words = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/check[- ]in/g, 'checkin').split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w));

/** How much of the name asked for a hotel's name carries, 0 to 1. */
export function nameMatch(asked, name) {
  const want = [...new Set(words(asked))];
  if (!want.length) return 0;
  const has = new Set(words(name));
  return want.filter((w) => has.has(w)).length / want.length;
}

/**
 * The hotel asked for, or null. Only the one named: a stay is a hotel someone
 * chose, and a better-rated one down the road is a different stay, so a weak
 * match keeps the stay as written rather than swapping it.
 */
export function pickHotel(hotels, asked) {
  const ranked = (Array.isArray(hotels) ? hotels : [])
    .map((h) => ({ h, score: nameMatch(asked, h.name) }))
    .filter((x) => x.score >= 0.67)
    .sort((a, b) => b.score - a.score);
  return ranked.length ? ranked[0].h : null;
}

function money(amount, currency) {
  if (!amount || !currency) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch (e) {
    return `${currency} ${Math.round(amount)}`;
  }
}

export function nightsBetween(checkIn, checkOut) {
  const n = Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400000);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * A stay with its real hotel's facts: pinned where the hotel is, its own
 * check-in and check-out times where the stay had none, and, unless it is
 * already booked, what those nights cost and where. What the traveller wrote
 * (their times, their reference, their notes) is kept.
 */
export function stayWithHotel(stay, hotel, { currency = '', nights = 0, booked = false } = {}) {
  const d = stay.details || {};
  const details = {
    ...d,
    ...(!d.check_in_time && hotel.check_in_time ? { check_in_time: hotel.check_in_time } : {}),
    ...(!d.check_out_time && hotel.check_out_time ? { check_out_time: hotel.check_out_time } : {}),
  };
  const facts = [];
  if (!booked && hotel.total) {
    const each = hotel.nightly ? `About ${money(hotel.nightly, currency)} a night, ` : 'About ';
    facts.push(`${each}${money(hotel.total, currency)} for ${nights} night${nights === 1 ? '' : 's'}`
      + ` for one guest${hotel.cheapest_at ? `, cheapest on ${hotel.cheapest_at}` : ''}, when the trip was planned.`);
    if (hotel.free_cancel_until) facts.push(`Free cancellation until ${hotel.free_cancel_until}.`);
  }
  if (hotel.rating) {
    facts.push(`Rated ${hotel.rating.toFixed(1)}${hotel.reviews ? ` from ${Math.round(hotel.reviews).toLocaleString('en')} reviews` : ''}.`);
  }
  if (!booked && hotel.total) facts.push('Not booked: check the rate before you book.');
  const had = String(stay.notes || '').trim();
  return {
    ...stay,
    details,
    ...(hotel.address ? { location: hotel.address } : {}),
    ...(hotel.lat != null && hotel.lng != null ? { lat: hotel.lat, lng: hotel.lng } : {}),
    ...(!booked && hotel.total ? { cost: hotel.total } : {}),
    notes: [facts.join(' '), had].filter(Boolean).join('\n').slice(0, 1000),
  };
}

/**
 * Hotels for a name near a place, for one guest on those dates, priced in
 * `currency` as sold where the traveller lives (`country`).
 */
export async function searchHotels({ query, checkIn, checkOut, currency = 'USD', country = '' }) {
  const cur = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  const body = await serpSearch('google_hotels', {
    q: str(query, 200),
    check_in_date: checkIn,
    check_out_date: checkOut,
    adults: '1',
    currency: cur,
    gl: googleCountry(country),
  });
  return readHotels(body);
}
