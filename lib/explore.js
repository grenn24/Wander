// Shared by the map, its cache and the server so categories cannot drift apart.
export const NEARBY_KINDS = [
  { id: 'food', label: 'Food & drink', category: 'food', types: ['restaurant', 'cafe', 'bakery', 'bar'] },
  { id: 'sights', label: 'Sights', category: 'sightseeing', types: ['tourist_attraction', 'museum', 'art_gallery', 'park'] },
  { id: 'hotels', label: 'Hotels', category: 'lodging', types: ['hotel'] },
  { id: 'cafes', label: 'Cafés', category: 'food', types: ['cafe', 'coffee_shop', 'bakery'] },
  { id: 'activities', label: 'Activities', category: 'activity', types: ['amusement_park', 'aquarium', 'zoo', 'bowling_alley'] },
  { id: 'parks', label: 'Parks', category: 'sightseeing', types: ['park', 'national_park', 'botanical_garden'] },
  { id: 'spas', label: 'Spas', category: 'activity', types: ['spa', 'sauna', 'wellness_center'] },
  { id: 'transit', label: 'Transit', category: 'transport', types: ['train_station', 'subway_station', 'bus_station'] },
  { id: 'shops', label: 'Shops', category: 'shopping', types: ['shopping_mall', 'department_store', 'book_store', 'clothing_store'] },
];

const wrap = (lng) => ((lng + 180) % 360 + 360) % 360 - 180;
const width = (b) => b.east >= b.west ? b.east - b.west : b.east + 360 - b.west;
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

function distance(a, b) {
  const rad = (d) => d * Math.PI / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(Math.min(1, h)));
}

export function validateBounds(b) {
  if (!b || !['north', 'south', 'east', 'west'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k]))
    || b.south < -90 || b.north > 90 || b.north <= b.south
    || Math.abs(b.west) > 180 || Math.abs(b.east) > 180 || width(b) <= 0) {
    throw invalid('Invalid map area. Move the map and try again.');
  }
  return b;
}

export function containsPoint(b, p) {
  const offset = ((p.lng - b.west) % 360 + 360) % 360;
  return p.lat >= b.south && p.lat <= b.north && offset <= width(b) + 1e-9;
}

function area(b) {
  const center = { lat: (b.north + b.south) / 2, lng: wrap(b.west + width(b) / 2) };
  const radius = Math.ceil(Math.max(...[b.south, b.north].flatMap((lat) =>
    [b.west, b.east].map((lng) => distance(center, { lat, lng })))));
  return { center, radius: Math.max(200, radius), bounds: b };
}

// One neighbourhood request, or four city quadrants. Never silently truncate
// the viewport to Google's 50 km radius, and never fan out without a budget.
export function exploreAreas(lat, lng, radius = 900, bounds = null) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw invalid('Need a valid point to search around.');
  }
  if (!bounds) return [{ center: { lat, lng }, radius: Math.min(50000, Math.max(200, Number(radius) || 900)), rank: 'DISTANCE' }];
  const b = validateBounds(bounds);
  const whole = area(b);
  if (width(b) > 180) throw invalid('Zoom in to a city or region to explore places.');
  if (whole.radius <= 2000) return [{ ...whole, rank: 'DISTANCE' }];
  const midLat = whole.center.lat;
  const midLng = whole.center.lng;
  const cells = [
    { south: b.south, north: midLat, west: b.west, east: midLng },
    { south: b.south, north: midLat, west: midLng, east: b.east },
    { south: midLat, north: b.north, west: b.west, east: midLng },
    { south: midLat, north: b.north, west: midLng, east: b.east },
  ].map((cell) => ({ ...area(cell), rank: 'POPULARITY' }));
  if (cells.some((cell) => cell.radius > 50000)) {
    throw invalid('Zoom in to a city or region to explore places.');
  }
  return cells;
}

// Round-robin keeps a dense district from consuming every result slot.
export function spreadResults(groups, limit = 24) {
  const seen = new Set();
  const result = [];
  const length = Math.max(0, ...groups.map((g) => g.length));
  for (let i = 0; i < length && result.length < limit; i += 1) {
    for (const group of groups) {
      const p = group[i];
      if (!p || seen.has(p.id)) continue;
      seen.add(p.id);
      result.push(p);
      if (result.length === limit) break;
    }
  }
  return result;
}

export function viewportChanged(before, after) {
  if (!before || !after) return false;
  const oldSpan = before.spanKm * 1000 || before.radius || 900;
  const newSpan = after.spanKm * 1000 || after.radius || 900;
  return distance(before, after) > oldSpan * 0.35
    || newSpan / oldSpan > 1.3 || newSpan / oldSpan < 1 / 1.3;
}
