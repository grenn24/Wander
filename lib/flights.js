/**
 * Real flights for a trip: which airline, which flight, when it leaves and
 * when it lands, from Google Flights through SerpApi (serpapi.com/google-flights-api).
 *
 * Server only — SERPAPI_API_KEY is a real secret. The routes in app/api/flights
 * call this; the browser calls them.
 *
 * The planner used to be told "never guess a missing booking time", which was
 * right, and so a flight arrived as "Flight to Tokyo" with no airline, no
 * number and no times: honest, and useless to plan a first day around. A model
 * cannot know the schedule; Google Flights can. So the flights come from a
 * search and the model is given them as facts, the same way a calendar entry
 * is (app/api/plan/route.js).
 *
 * Why SerpApi: Amadeus closed its self-service APIs on 17 July 2026, Duffel
 * needs an activated merchant account before it returns anything but its
 * made-up test airline, and Google has had no flight API of its own since QPX.
 * SerpApi returns exactly what a traveller sees on Google Flights, including
 * connections and fares, from a key anyone can have (250 searches a month
 * free; a cached search, which repeats within the hour, costs nothing).
 *
 * What it does not give: terminals, gates and time zones. Gates are known on
 * the day and are left for the traveller; time zones come from the airport
 * table (lib/airports.js), never from a guess, because every clock in the app
 * reads them (public/trip-time.js).
 *
 * The pure parts — reading an answer, choosing a flight, turning it into
 * activities — are exported for the tests.
 */
import { airportOf } from './airports.js';

const ENDPOINT = 'https://serpapi.com/search.json';
// A search usually answers in two to five seconds. A plan waits on it, so a
// search that hangs is abandoned and the trip is planned without times.
const TIMEOUT_MS = 20000;

export function flightsKey() {
  const k = process.env.SERPAPI_API_KEY || '';
  return k && !k.startsWith('REPLACE_WITH') ? k : '';
}

export function flightsConfigured() {
  return !!flightsKey();
}

const str = (v, n = 120) => String(v == null ? '' : v).trim().slice(0, n);
const iata = (v) => (/^[A-Z]{3}$/.test(String(v || '').trim().toUpperCase())
  ? String(v).trim().toUpperCase() : '');

/** "SQ 638", "sq638", "SQ 0638" -> "SQ638"; anything else -> ''. */
export function normaliseCode(v) {
  const m = String(v || '').toUpperCase().replace(/\s+/g, '')
    .match(/^([A-Z0-9]{2}[A-Z]?)0*(\d{1,4}[A-Z]?)$/);
  if (!m) return '';
  // Two characters and a number is the usual shape; three letters is ICAO
  // (SIA638), which Google never shows but a traveller might type.
  return `${m[1]}${m[2]}`;
}

/** "2026-12-03 9:05" -> { day: '2026-12-03', time: '09:05' } */
function splitTime(v) {
  const m = String(v || '').trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}):(\d{2})/);
  if (!m || Number(m[2]) > 23 || Number(m[3]) > 59) return null;
  return { day: m[1], time: `${m[2].padStart(2, '0')}:${m[3]}` };
}

const toMinutes = (hhmm) => {
  const m = String(hhmm || '').match(/^(\d{2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/**
 * Every flight in a Google Flights answer, as
 * { best, rank, price, currency, minutes, stops, legs, layovers }, where each
 * leg is { carrier, code, from, to, from_name, to_name, depart_day,
 * depart_time, arrive_day, arrive_time, minutes, aircraft, cabin, delayed }.
 * Google's own "best" flights come first, in its order. A flight with a leg
 * that cannot be read is left out whole: half a journey is not a journey.
 */
export function readOffers(body, currency = '') {
  const groups = [
    ...((body && Array.isArray(body.best_flights)) ? body.best_flights : []).map((o) => [o, true]),
    ...((body && Array.isArray(body.other_flights)) ? body.other_flights : []).map((o) => [o, false]),
  ];
  return groups.map(([o, best], rank) => {
    const legs = (Array.isArray(o && o.flights) ? o.flights : []).map((f) => {
      const dep = splitTime(f && f.departure_airport && f.departure_airport.time);
      const arr = splitTime(f && f.arrival_airport && f.arrival_airport.time);
      const from = iata(f && f.departure_airport && f.departure_airport.id);
      const to = iata(f && f.arrival_airport && f.arrival_airport.id);
      if (!dep || !arr || !from || !to) return null;
      return {
        carrier: str(f.airline, 80),
        code: normaliseCode(f.flight_number),
        from,
        to,
        from_name: str(f.departure_airport.name, 120),
        to_name: str(f.arrival_airport.name, 120),
        depart_day: dep.day,
        depart_time: dep.time,
        arrive_day: arr.day,
        arrive_time: arr.time,
        minutes: Number.isFinite(Number(f.duration)) ? Number(f.duration) : null,
        aircraft: str(f.airplane, 60),
        cabin: str(f.travel_class, 40),
        delayed: f.often_delayed_by_over_30_min === true,
      };
    });
    if (!legs.length || legs.some((l) => !l)) return null;
    const total = Number(o.total_duration);
    const price = Number(o.price);
    return {
      best,
      rank,
      price: Number.isFinite(price) && price > 0 ? price : null,
      currency: str(currency, 3).toUpperCase(),
      minutes: Number.isFinite(total) && total > 0 ? total
        : legs.reduce((n, l) => n + (l.minutes || 0), 0),
      stops: legs.length - 1,
      legs,
      layovers: (Array.isArray(o.layovers) ? o.layovers : []).map((l) => ({
        code: iata(l && l.id),
        name: str(l && l.name, 120),
        minutes: Number.isFinite(Number(l && l.duration)) ? Number(l.duration) : null,
        overnight: !!(l && l.overnight),
      })),
    };
  }).filter(Boolean);
}

/**
 * How bad a flight is for this part of the trip, in rough minutes; lower is
 * better.
 *
 * Google's own "best" ranking already weighs fare against hassle, so it is
 * the starting point rather than something to be second-guessed, and a stop
 * costs three hours on top of the time it adds. What Google does not know is
 * where the flight sits in the trip:
 *   outbound — the trip's first day starts at home, so a flight that leaves
 *     in the morning and lands the same day beats a red-eye that throws the
 *     day away, and nobody wants to be at the airport for a 2am departure;
 *   return  — the last day is a day too, so an afternoon flight beats an
 *     early-morning one;
 *   hop     — a flight inside the trip that the planner already placed: as
 *     close as possible to the time it planned around.
 */
export function offerScore(o, { kind = 'hop', near = null, cheapest = null } = {}) {
  const first = o.legs[0];
  const last = o.legs[o.legs.length - 1];
  const dep = toMinutes(first.depart_time);
  const arr = toMinutes(last.arrive_time);
  let score = o.minutes + 180 * o.stops + (o.best ? 0 : 45);
  if (o.price && cheapest) score += Math.min(600, (o.price / cheapest - 1) * 300);
  if (o.layovers.some((l) => l.overnight)) score += 240;
  if (dep != null && dep < 6 * 60) score += 300;
  if (kind === 'outbound') {
    if (dep != null && dep > 15 * 60) score += ((dep - 15 * 60) / 60) * 45;
    if (arr != null && (arr >= 23 * 60 || last.arrive_day > first.depart_day)) score += 90;
  } else if (kind === 'return') {
    if (dep != null && dep < 10 * 60) score += ((10 * 60 - dep) / 60) * 45;
  } else if (near != null && dep != null) {
    score += Math.abs(dep - near) * 1.2;
    if (last.arrive_day > first.depart_day) score += 240;
  }
  return score;
}

/**
 * The flight to use, or null.
 *
 * With `code` — a flight the traveller named, such as "we're on SQ638" — only
 * that flight will do: their booking is a fact, and a better flight is not
 * theirs. Null then means it does not fly that day, and the caller keeps
 * what the traveller wrote rather than swapping in another.
 */
export function pickOffer(offers, { kind = 'hop', near = null, code = '' } = {}) {
  const list = Array.isArray(offers) ? offers : [];
  const want = normaliseCode(code);
  if (want) return list.find((o) => o.legs.some((l) => l.code === want)) || null;
  if (!list.length) return null;
  const prices = list.map((o) => o.price).filter(Boolean);
  const cheapest = prices.length ? Math.min(...prices) : null;
  const at = typeof near === 'string' ? toMinutes(near) : near;
  return list.slice().sort((a, b) => offerScore(a, { kind, near: at, cheapest })
    - offerScore(b, { kind, near: at, cheapest }) || a.rank - b.rank)[0];
}

export function duration(minutes) {
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? ` ${String(m).padStart(2, '0')}m` : ''}` : `${m}m`;
}

function fare(price, currency) {
  if (!price || !currency) return '';
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency, maximumFractionDigits: 0 })
      .format(price);
  } catch (e) {
    return `${currency} ${Math.round(price)}`;
  }
}

/** "Paris (Roissy-en-France, Val-d'Oise)" -> "Paris" */
export function cityName(a) {
  return a ? String(a.city || a.name || a.code).split(/[(,]/)[0].trim() : '';
}

const NOT_BOOKED = 'Not booked: chosen from Google Flights for this day when the trip was planned, '
  + 'so check the times and fare before you book.';

/**
 * A flight as itinerary activities, one per leg, each with its own number,
 * times and airports — the way they appear on a boarding pass, and the way
 * Traveller mode and the calendar need them. The fare is stored once, on the
 * first leg (as a stay is, lib/lodging.js).
 *
 * `names` gives the city a leg's arrival should be called by — the trip's
 * "Tokyo" rather than the airport's "Narita" — and `homeward` marks the
 * flight back, whose last leg is "Flight home".
 *
 * Each row is pinned at the airport it leaves from, with its arrival pin
 * already found (details._arrive, lib/geo.js), so the map needs no lookup.
 */
export function offerActivities(offer, index, { names = {}, homeward = false, booked = false } = {}) {
  if (!offer || !Array.isArray(offer.legs)) return [];
  const legs = offer.legs;
  return legs.map((l, i) => {
    const from = airportOf(index, l.from);
    const to = airportOf(index, l.to);
    const lastLeg = i === legs.length - 1;
    const city = names[l.to] || cityName(to) || l.to_name || l.to;
    const title = lastLeg && homeward
      ? (names[l.to] ? `Flight home to ${names[l.to]}` : 'Flight home')
      : `Flight to ${city}`;
    const bits = [];
    if (i === 0) {
      if (legs.length === 1) bits.push('Nonstop');
      else {
        const via = offer.layovers.map((v) => {
          const where = cityName(airportOf(index, v.code)) || v.name || v.code;
          const wait = duration(v.minutes);
          return `${where}${wait ? ` (${wait}${v.overnight ? ', overnight' : ''})` : ''}`;
        }).join(' and ');
        bits.push(`${legs.length - 1} stop${legs.length > 2 ? 's' : ''}${via ? `, changing in ${via}` : ''}`);
      }
    } else {
      const before = legs[i - 1];
      bits.push(`Connects from ${before.code || before.carrier || 'the flight before'}`);
    }
    if (l.minutes) bits.push(duration(l.minutes));
    if (l.aircraft) bits.push(l.aircraft);
    const lines = [`${bits.join(', ')}.`];
    if (i === 0 && legs.length > 1 && offer.minutes) {
      lines.push(`${duration(offer.minutes)} door to door${offer.price ? '; the fare covers every flight' : ''}.`);
    }
    if (l.delayed) lines.push('Often delayed by more than half an hour.');
    if (i === 0 && offer.price && !booked) {
      lines.push(`About ${fare(offer.price, offer.currency)} one way${l.cabin ? ` in ${l.cabin.toLowerCase()}` : ''}.`);
    }
    if (!booked) lines.push(NOT_BOOKED);

    const details = {
      ...(l.carrier ? { carrier: l.carrier } : {}),
      ...(l.code ? { code: l.code } : {}),
      from: l.from,
      to: l.to,
      ...(from && from.tz ? { departure_timezone: from.tz } : {}),
      ...(to && to.tz ? { arrival_timezone: to.tz } : {}),
      arrival_date: l.arrive_day,
      ...(to ? { _arrive: { q: l.to, lat: to.lat, lng: to.lng } } : {}),
    };
    return {
      day: l.depart_day,
      title,
      start_time: l.depart_time,
      end_time: l.arrive_time,
      category: 'transport',
      subtype: 'flight',
      details,
      location: from ? from.name : (l.from_name || l.from),
      ...(from ? { lat: from.lat, lng: from.lng } : {}),
      cost: i === 0 && offer.price && !booked ? offer.price : 0,
      booking_ref: '',
      notes: lines.join(' ').slice(0, 1000),
    };
  });
}

/**
 * A flight there is no schedule for: the airports, the day and the clocks,
 * and room for the traveller to add the rest. Still worth having: it is the
 * day's first fact, and the zones are right when the times are filled in.
 */
export function placeholderActivity(index, { from, to, day, names = {}, homeward = false }) {
  const a = airportOf(index, from);
  const b = airportOf(index, to);
  if (!a || !b || !/^\d{4}-\d{2}-\d{2}$/.test(day || '')) return null;
  return {
    day,
    title: homeward
      ? (names[b.code] ? `Flight home to ${names[b.code]}` : 'Flight home')
      : `Flight to ${names[b.code] || cityName(b)}`,
    start_time: null,
    end_time: null,
    category: 'transport',
    subtype: 'flight',
    details: {
      from: a.code,
      to: b.code,
      departure_timezone: a.tz,
      arrival_timezone: b.tz,
      _arrive: { q: b.code, lat: b.lat, lng: b.lng },
    },
    location: a.name,
    lat: a.lat,
    lng: a.lng,
    cost: 0,
    booking_ref: '',
    notes: 'No flight found for this day yet. Add the airline, flight number and times once it is booked.',
  };
}

// Google's country codes for gl, where they are not ISO's.
const GL = { GB: 'uk' };

/**
 * One-way flights between two sets of airports on a day, cheapest fare for one
 * adult in economy, in `currency`. SerpApi takes several airports at once
 * ("LHR,LGW") and Google picks from all of them.
 *
 * One-way rather than return: the way home is often from another city
 * (into Tokyo, out of Osaka), and a return search needs a second request
 * anyway. The fare each shows is a one-way fare, and the notes say so.
 */
export async function searchOffers({ from, to, date, currency = 'USD', country = '' }) {
  const key = flightsKey();
  if (!key) throw Object.assign(new Error('SERPAPI_API_KEY is not set.'), { code: 'no_key' });
  const dep = (Array.isArray(from) ? from : [from]).map(iata).filter(Boolean);
  const arr = (Array.isArray(to) ? to : [to]).map(iata).filter(Boolean);
  if (!dep.length || !arr.length || !/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return [];
  const cur = /^[A-Z]{3}$/.test(currency || '') ? currency : 'USD';
  const params = new URLSearchParams({
    engine: 'google_flights',
    type: '2',
    departure_id: dep.join(','),
    arrival_id: arr.join(','),
    outbound_date: date,
    currency: cur,
    hl: 'en',
    adults: '1',
    ...(country ? { gl: GL[country] || country.toLowerCase() } : {}),
    api_key: key,
  });
  const res = await fetch(`${ENDPOINT}?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await res.json().catch(() => ({}));
  if (body && body.error) {
    // Google simply has nothing that day: an answer, not a failure.
    if (/no results|hasn't returned any results/i.test(body.error)) return [];
    throw new Error(`SerpApi: ${body.error}`);
  }
  if (!res.ok) throw new Error(`SerpApi returned ${res.status}.`);
  return readOffers(body, cur);
}
