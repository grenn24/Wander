import { aiConfigured, notConfigured, askJson } from '@/lib/ai';
import { userFromRequest, notSignedIn } from '@/lib/supabaseServer';
import { placesKey, searchPlaces } from '@/lib/places';
import {
  airports, airportOf, knownCodes, nearestAirports, airportsNamed,
} from '@/lib/airports';
import { matchFlights } from '@/lib/flightMatch';
import { flightsConfigured, placeholderActivity, cityName } from '@/lib/flights';
import { homeOf, homeName } from '@/lib/home';
import { hasExclusiveScope } from '@/lib/planScope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/*
 * Flights for a trip being planned. Two modes:
 *
 *   trip — before the plan is written: when the trip is, where it starts and
 *          ends, and the real flights there and home, so the first and last
 *          days are planned around when they actually land and leave.
 *   legs — new entries from any page, with their flights made real: the
 *          shared service (matchFlights, lib/flightMatch.js) the trip editor
 *          calls in the server, for the pages that make entries in the
 *          browser (settleDrafts, lib/pinPlaces.js).
 *
 * Every search is a SerpApi search, and those are counted, so the route is
 * signed in and each person's searches share one budget an hour
 * (flightBudget). Without SERPAPI_API_KEY the trip still gets its flights —
 * the airports, the days and the clocks, with the times left for the
 * traveller — and nothing here fails a plan.
 */

const TRIP = {
  type: 'object',
  additionalProperties: false,
  required: [
    'start_date', 'duration_days', 'currency', 'origin', 'first_city', 'last_city',
    'arrive_airports', 'leave_airports', 'fly', 'own_flights', 'outbound_flight', 'return_flight',
  ],
  properties: {
    start_date: {
      type: ['string', 'null'],
      description: 'YYYY-MM-DD of day 1, the day they set off. Null only if the request gives nothing to go on.',
    },
    duration_days: {
      type: 'integer',
      description: 'Whole days as the traveller put it, day 1 being the day they set off: "5 days in Tokyo" is 5. 1 to 30.',
    },
    currency: { type: 'string', description: 'ISO 4217 code sensible for the destination' },
    origin: {
      type: ['string', 'null'],
      description: 'Where the traveller says they are travelling from, in their words ("from London", '
        + 'an answer to "Where are you travelling from?"). Null when the request does not say.',
    },
    first_city: { type: 'string', description: 'The first place they stay, e.g. "Tokyo"' },
    last_city: { type: 'string', description: 'The last place they stay; the same as first_city for a one-place trip' },
    arrive_airports: {
      type: 'array',
      items: { type: 'string' },
      description: 'IATA codes of the airports travellers fly into for first_city, the main one first, at most 3',
    },
    leave_airports: {
      type: 'array',
      items: { type: 'string' },
      description: 'IATA codes of the airports travellers fly home from for last_city, the main one first, at most 3',
    },
    fly: {
      type: 'boolean',
      description: 'True when flying is how this traveller would get from where they start to first_city and '
        + 'home from last_city. False when it is near enough that people go by land or sea (Tokyo to Kyoto, '
        + 'London to Paris), when they say they are driving, taking a train or a cruise, or when they are '
        + 'already there.',
    },
    own_flights: {
      type: 'boolean',
      description: 'True when they say their flights are booked or that they will sort them out, without giving flight numbers.',
    },
    outbound_flight: { type: ['string', 'null'], description: 'The flight number they say they take there, e.g. SQ638. Null if they do not give one.' },
    return_flight: { type: ['string', 'null'], description: 'The flight number they say they take home. Null if they do not give one.' },
  },
};

function addDays(day, n) {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}

/**
 * A place in words as a home: Google's answer for it, or failing that the
 * airports of a city of that name, and the airports someone there flies from.
 */
async function resolvePlace(index, text) {
  const words = String(text || '').trim().slice(0, 160);
  if (!words) return null;
  if (placesKey()) {
    try {
      const [p] = await searchPlaces(words, 1);
      if (p && Number.isFinite(p.lat)) {
        const near = nearestAirports(index, p.lat, p.lng);
        if (near.length) {
          return { label: p.label || p.name || words, lat: p.lat, lng: p.lng, airports: near.map((a) => a.code) };
        }
      }
    } catch (e) {
      console.warn('[flights] place lookup failed:', e.message);
    }
  }
  const named = airportsNamed(index, words);
  if (!named.length) return null;
  return { label: words, lat: named[0].lat, lng: named[0].lng, airports: named.map((a) => a.code) };
}

/** A city's airports: the planner's codes where they are real, else a lookup. */
async function cityAirports(index, codes, city) {
  const known = knownCodes(index, codes, 3);
  if (known.length) return known;
  const place = await resolvePlace(index, city);
  return place ? place.airports : [];
}

// A name for an airport fit for a title: the city the traveller is going to.
function namesFor(index, codes, city) {
  const name = String(city || '').split(',')[0].trim().slice(0, 60);
  return Object.fromEntries(codes.map((c) => [c, name || cityName(airportOf(index, c))]));
}

/**
 * The way there or home as a draft for the shared matcher: the airports, the
 * day and the clocks, which is also what is kept if no flight is found.
 */
function wayDraft(index, {
  from, to, day, code, kind, names,
}) {
  const homeward = kind === 'return';
  const draft = placeholderActivity(index, {
    from: from[0], to: to[0], day, names, homeward,
  });
  if (!draft) return null;
  return {
    ...draft,
    ...(code ? { details: { ...draft.details, code }, _trusted: true } : {}),
    _from: from,
    _to: to,
    _kind: kind,
  };
}

async function tripFlights(user, body) {
  const prompt = String(body.prompt || '').trim().slice(0, 6000);
  const today = /^\d{4}-\d{2}-\d{2}$/.test(body.today || '') ? body.today : new Date().toISOString().slice(0, 10);
  if (!prompt) return Response.json({ error: 'Describe the trip you want.' }, { status: 400 });
  const none = (why, extra = {}) => Response.json({ flights: [], why, ...extra });
  if (hasExclusiveScope(prompt)) return none('only');

  const index = await airports();
  const home = homeOf(user);
  const trip = await askJson({
    schemaName: 'trip_flights',
    schema: TRIP,
    task: 'flights',
    maxTokens: 1200,
    system: `You read a travel request for the facts that decide its flights. Today is ${today}.`
      + (home ? ` The traveller lives in ${home.label} and flies from ${home.airports.join(', ')}.`
        : ' Where the traveller lives is not known.')
      + ' Airports are IATA codes of airports with scheduled flights. Answer only from the request'
      + ' and what is generally known about the places in it.',
    user: prompt,
  });

  const days = Math.min(30, Math.max(1, Number(trip.duration_days) || 1));
  const start = /^\d{4}-\d{2}-\d{2}$/.test(trip.start_date || '') ? trip.start_date : addDays(today, 21);
  const dates = { start_date: start, duration_days: days };
  const currency = /^[A-Z]{3}$/.test(trip.currency || '') ? trip.currency : null;

  // Where they set off from: what this request says, or the home they keep.
  const stated = trip.origin ? await resolvePlace(index, trip.origin) : null;
  const origin = stated || home;
  // Kept for next time when there was none: the planner asked, or they said.
  const remember = !home && !!stated;
  const extra = { dates, currency, origin, remember };

  if (!origin) return none('no_origin', extra);
  if (!trip.fly) return none('not_flying', extra);
  const outCode = trip.outbound_flight || '';
  const backCode = trip.return_flight || '';
  if (trip.own_flights && !outCode && !backCode) return none('own_flights', extra);
  // Google has no flights in the past, and a trip being written up afterwards needs none.
  if (start < today) return none('past', extra);

  const [arrive, leave] = await Promise.all([
    cityAirports(index, trip.arrive_airports, trip.first_city),
    cityAirports(index, trip.leave_airports, trip.last_city || trip.first_city),
  ]);
  const from = origin.airports.filter((c) => airportOf(index, c));
  // Already there: home is one of the destination's own airports.
  if (!from.length || !arrive.length || arrive.some((c) => from.includes(c))) return none('not_flying', extra);

  const homeWord = homeName(origin);
  const homeNames = /\d/.test(origin.label) ? {} : Object.fromEntries(from.map((c) => [c, homeWord]));
  const ways = [
    outCode || !trip.own_flights ? wayDraft(index, {
      from, to: arrive, day: start, code: outCode, kind: 'outbound',
      names: namesFor(index, arrive, trip.first_city),
    }) : null,
    (backCode || !trip.own_flights) && days > 1 ? wayDraft(index, {
      from: leave.length ? leave : arrive, to: from, day: addDays(start, days - 1), code: backCode,
      kind: 'return', names: homeNames,
    }) : null,
  ].filter(Boolean);

  // Made real by the service every way of making entries shares.
  const { groups, found, why } = await matchFlights(ways, {
    said: prompt,
    currency: currency || 'USD',
    userId: user.id,
    // Fares as they are sold where the traveller lives, both ways.
    country: (airportOf(index, from[0]) || {}).country || '',
  });
  const flights = ways.map((way, i) => {
    /*
     * A flight they named that does not fly that day is theirs to sort out,
     * and the planner writes it from their words, as it always has. Any
     * other way not found is still added, with its airports and clocks.
     */
    if (!found[i] && way._trusted) return null;
    return { kind: way._kind, found: found[i], legs: groups[i] };
  }).filter(Boolean);
  return Response.json({
    ...extra,
    flights,
    why: why === 'busy' ? 'busy' : null,
    searched: flightsConfigured(),
  });
}

async function legFlights(user, body) {
  const rows = (Array.isArray(body.rows) ? body.rows : []).slice(0, 300)
    .map((r) => (r && typeof r === 'object' ? r : {}));
  const { groups, matched, why } = await matchFlights(rows, {
    said: String(body.said || '').slice(0, 6000),
    currency: String(body.currency || ''),
    userId: user.id,
  });
  return Response.json({ groups, matched, why });
}

export async function POST(req) {
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();
  let body;
  try { body = (await req.json()) || {}; } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }
  try {
    if (body.mode === 'legs') return await legFlights(user, body);
    // Reading the request for its dates and places is a model's job.
    if (!aiConfigured()) return notConfigured();
    return await tripFlights(user, body);
  } catch (e) {
    // A plan without flights is still a plan; the page carries on without them.
    console.error('[flights] failed:', (e && e.message) || e);
    return Response.json({ error: 'Could not look up flights.' }, { status: 502 });
  }
}
