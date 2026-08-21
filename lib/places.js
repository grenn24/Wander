/**
 * Server-side place resolution.
 *
 * Two providers behind one interface. Google, when a server key is configured:
 * accurate, no per-second cap, and it returns a photo handle alongside the
 * coordinates. Nominatim otherwise, which keeps the app fully working with no
 * keys at all — but at one request per second, which is exactly why a freshly
 * planned trip used to appear on the map one stop at a time.
 */

const GOOGLE_SEARCH = 'https://places.googleapis.com/v1/places:searchText';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const UA = 'Wander/1.0 (travel itinerary planner; https://github.com/grenn24/Wander)';

export function googleKey() {
  const k = process.env.GOOGLE_MAPS_SERVER_KEY || '';
  return !k || k.startsWith('REPLACE_WITH') ? '' : k;
}

export function placesProvider() {
  return googleKey() ? 'google' : 'osm';
}

/* --------------------------------------------------------------- google --- */

async function googleResolve(query, bias) {
  const res = await fetch(GOOGLE_SEARCH, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleKey(),
      // Ask for the minimum: field masks are what the call is billed on.
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.photos.name',
    },
    body: JSON.stringify({
      textQuery: bias ? `${query}, ${bias}` : query,
      maxResultCount: 1,
    }),
  });

  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = (body.error && body.error.message) || '';
    } catch (e) { /* non-JSON */ }
    throw new Error(detail || `Places returned ${res.status}.`);
  }

  const body = await res.json();
  const p = body.places && body.places[0];
  if (!p || !p.location) return null;

  return {
    lat: p.location.latitude,
    lng: p.location.longitude,
    label: p.formattedAddress || (p.displayName && p.displayName.text) || query,
    place_id: p.id || '',
    photo_ref: (p.photos && p.photos[0] && p.photos[0].name) || '',
  };
}

/* ------------------------------------------------------------ nominatim --- */

let osmLast = 0;

async function osmResolve(query, bias) {
  // Nominatim asks for at most one request per second, and means it.
  const wait = Math.max(0, 1100 - (Date.now() - osmLast));
  if (wait) await new Promise((r) => { setTimeout(r, wait); });
  osmLast = Date.now();

  const attempt = async (q) => {
    const res = await fetch(`${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(q)}`, {
      // Nominatim's policy requires an identifying User-Agent and answers 403
      // without one. A browser sends its own; a server request has to say who
      // it is, which is why this works in the client and not here.
      headers: { Accept: 'application/json', 'User-Agent': UA },
    });
    if (!res.ok) return null;
    const json = await res.json();
    const h = Array.isArray(json) && json[0];
    if (!h) return null;
    return {
      lat: Number(h.lat),
      lng: Number(h.lon),
      label: h.display_name,
      place_id: '',
      photo_ref: '',
    };
  };

  const direct = await attempt(query);
  if (direct) return direct;

  // The bias is free text; only its first place name is safe to append.
  const hint = String(bias || '').split(/[,&/]|\band\b/i)[0].trim();
  if (!hint || query.toLowerCase().includes(hint.toLowerCase())) return null;
  return attempt(`${query}, ${hint}`);
}

/**
 * Turns a raw fetch failure into something actionable. TLS interception is the
 * one that looks like a code bug and is not: a proxy or antivirus re-signs
 * HTTPS with a root that lives in the OS trust store, which Node does not read
 * unless asked. The same machine condition breaks git without `schannel`.
 */
function explain(e) {
  const code = (e.cause && e.cause.code) || '';
  if (code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'Node could not verify the TLS certificate — something on this machine '
      + 'is intercepting HTTPS. Run the dev server with --use-system-ca (npm run dev '
      + 'already does) so Node trusts the OS certificate store.';
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'DNS lookup failed for the place service.';
  if (code === 'ECONNREFUSED') return 'The place service refused the connection.';
  return `${e.message}${code ? ` [${code}]` : ''}`;
}

/* ----------------------------------------------------------------- api ---- */

/**
 * Resolve many places at once.
 *
 * Google has no per-second cap, so those go out together and land in about the
 * time of a single request. Nominatim cannot, so it stays sequential — the
 * difference between a map that is ready when you open it and one that fills
 * in over fifteen seconds.
 */
export async function resolveMany(items, bias) {
  const list = items.slice(0, 60);

  if (placesProvider() === 'google') {
    const out = await Promise.all(list.map(async (it) => {
      try {
        const hit = await googleResolve(it.query, bias);
        return { id: it.id, ...(hit || {}), found: !!hit };
      } catch (e) {
        return { id: it.id, found: false, error: explain(e) };
      }
    }));
    return out;
  }

  const out = [];
  for (const it of list) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const hit = await osmResolve(it.query, bias);
      out.push({ id: it.id, ...(hit || {}), found: !!hit });
    } catch (e) {
      out.push({ id: it.id, found: false, error: explain(e) });
    }
  }
  return out;
}
