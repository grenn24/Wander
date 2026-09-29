import test from 'node:test';
import assert from 'node:assert/strict';
import {
  km, centroid, cluster, townOf, tripPoints, savedPoints, ideaPoints, photoQueryOf,
  overviewCamera, focusCamera, groupCamera, flightMillis, globeCounts,
  groundOffset, nextGroundAltitude, groundNear, offsetCamera,
  groundAt, viewOf, slantOf, lieOn, laidAt, squashMatrix,
} from '../lib/globe.js';

test('a group camera frames a whole trip, a single pin gets the close view', () => {
  const pair = groupCamera([{ lat: 35.68, lng: 139.76 }, { lat: 35.01, lng: 135.77 }]);
  assert.ok(pair.range > 60000 && pair.range < 6000000);
  assert.ok(pair.center.lng > 135.77 && pair.center.lng < 139.76);
  const one = { kind: 'been', tripId: 'a', lat: 1, lng: 2 };
  assert.deepEqual(groupCamera([one]), focusCamera(one));
});

test('towns come out of Google addresses', () => {
  assert.equal(townOf('Senso-ji, 2 Chome-3-1 Asakusa, Taito City, Tokyo 111-0032, Japan'), 'Tokyo');
  assert.equal(townOf('1-chome-294 Kiyomizu, Higashiyama Ward, Kyoto, 605-0862, Japan'), 'Kyoto');
  assert.equal(townOf('Central Park, New York, NY 10024, USA'), 'New York');
  assert.equal(townOf('Rua de Belém 84, 1300-085 Lisboa, Portugal'), 'Lisboa');
  assert.equal(townOf('Kyoto, Japan'), '');
  assert.equal(townOf(''), '');
});

test('centroid survives the date line and clusters stay apart', () => {
  const c = centroid([{ lat: 0, lng: 179 }, { lat: 0, lng: -179 }]);
  assert.ok(Math.abs(Math.abs(c.lng) - 180) < 0.01);
  const groups = cluster([
    { lat: 35.68, lng: 139.76 }, { lat: 35.71, lng: 139.8 }, // Tokyo
    { lat: 35.01, lng: 135.77 }, // Kyoto
  ], 60);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].items.length, 2);
  assert.ok(km({ lat: 35.68, lng: 139.76 }, { lat: 35.01, lng: 135.77 }) > 300);
});

test('trip pins: one per place, transport ignored, completed versus upcoming', () => {
  const trips = [
    { id: 'a', name: 'Japan', destination: 'Japan', start_date: '2026-03-01', end_date: '2026-03-10' },
    { id: 'b', name: 'Lisbon', destination: 'Lisbon', start_date: '2026-12-01', end_date: '2026-12-05' },
    { id: 'c', name: 'Empty', start_date: '2026-01-01', end_date: '2026-01-02' },
  ];
  const acts = [
    { trip_id: 'a', lat: 35.68, lng: 139.76, category: 'sightseeing', location: 'A, B, Tokyo 100-0001, Japan', photo_ref: 'places/x/photos/y' },
    { trip_id: 'a', lat: 35.7, lng: 139.79, category: 'food', location: 'C, Taito City, Tokyo 111-0032, Japan' },
    { trip_id: 'a', lat: 35.01, lng: 135.77, category: 'sightseeing', location: 'D, Higashiyama Ward, Kyoto, Japan' },
    { trip_id: 'a', lat: 1.36, lng: 103.99, category: 'transport', location: 'Changi Airport, Singapore' },
    { trip_id: 'b', lat: 38.72, lng: -9.14, category: 'lodging', location: 'Hotel, Lisbon' },
    { trip_id: 'b', lat: null, lng: -9.14, category: 'food' },
  ];
  const pins = tripPoints(trips, acts, '2026-09-14');
  assert.equal(pins.length, 3);
  const tokyo = pins.find((p) => p.name === 'Tokyo');
  assert.equal(tokyo.kind, 'been');
  assert.equal(tokyo.stops, 2);
  assert.equal(tokyo.photo_ref, 'places/x/photos/y');
  assert.ok(pins.some((p) => p.name === 'Kyoto'));
  const lisbon = pins.find((p) => p.tripId === 'b');
  assert.equal(lisbon.kind, 'planned');
  assert.equal(lisbon.name, 'Lisbon'); // single cluster, no parseable town: the destination
  assert.ok(!pins.some((p) => Math.abs(p.lat - 1.36) < 0.1));

  // Counted in trips, as the panel lists them: Japan's two towns are one completed trip.
  const counts = globeCounts(pins);
  assert.deepEqual([counts.been, counts.planned, counts.favourite], [1, 1, 0]);
});

test('favourited guides are favourites, the rest ideas; only places saved as been are pins', () => {
  const guides = ideaPoints([
    { slug: 'kyoto', title: 'K', place: 'Kyoto', country: 'Japan', center: { lat: 35, lng: 135 } },
    { slug: 'iceland', title: 'I', place: 'Iceland', country: 'Iceland', center: { lat: 64, lng: -19 } },
  ], new Set(['kyoto']));
  assert.deepEqual(guides.map((p) => [p.guide, p.kind]), [['kyoto', 'favourite'], ['iceland', 'idea']]);
  assert.equal(guides[1].label, 'Iceland');
  // The same id either way, so favouriting a guide does not lose it from the card it is open in.
  assert.equal(ideaPoints([{ slug: 'kyoto', title: 'K', place: 'Kyoto', country: 'Japan', center: { lat: 35, lng: 135 } }])[0].id, guides[0].id);
  const pins = savedPoints([
    { id: 1, kind: 'want', name: 'Kyoto', lat: 35, lng: 135.7 },
    { id: 2, kind: 'been', name: 'Bad', lat: 91, lng: 0 },
    { id: 3, kind: 'been', name: 'Porto', lat: 41.15, lng: -8.61 },
  ]);
  assert.deepEqual(pins.map((p) => [p.name, p.kind]), [['Porto', 'been']]);
  const counts = globeCounts([...guides, ...pins]);
  assert.deepEqual([counts.been, counts.planned, counts.favourite], [1, 0, 1]);
});

test('cameras: a globe overview, closer focus, bounded flights', () => {
  const empty = overviewCamera([]);
  assert.ok(empty.range >= 17000000);
  const one = overviewCamera([{ kind: 'been', lat: 80, lng: 10 }, { kind: 'idea', lat: -40, lng: 170 }]);
  assert.ok(one.center.lat <= 55);
  assert.equal(one.range, 17000000); // the idea does not steer, so nothing is spread out
  const wide = overviewCamera([{ kind: 'been', lat: 51, lng: 0 }, { kind: 'want', lat: -33.9, lng: 151.2 }]);
  assert.ok(wide.range > 17000000 && wide.range <= 25000000);
  assert.equal(one.tilt, 0);
  assert.ok(focusCamera({ kind: 'been', tripId: 'a', lat: 1, lng: 1 }).range < focusCamera({ kind: 'idea', lat: 1, lng: 1 }).range);
  const ms = flightMillis(empty, focusCamera({ kind: 'want', lat: 38.7, lng: -9.1 }));
  assert.ok(ms >= 1200 && ms <= 4000);
  assert.equal(flightMillis(null, empty), 0);
});

test('a town with no photographs is looked up by its most photogenic stop', () => {
  assert.equal(photoQueryOf([
    { title: 'Nishiki Market', category: 'food', location: 'Nakagyo Ward, Kyoto' },
    { title: 'Fushimi Inari', category: 'sightseeing', location: 'Fushimi Ward, Kyoto' },
    { title: 'Ryokan check-in', category: 'lodging', location: 'Kyoto' },
  ]), 'Fushimi Inari, Fushimi Ward, Kyoto');
  assert.equal(photoQueryOf([{ category: 'food' }]), null);
  const [town] = tripPoints(
    [{ id: 't', name: 'Hakone & Kyoto', start_date: '2020-01-01', end_date: '2020-01-02' }],
    [
      { trip_id: 't', lat: 35.23, lng: 139.02, category: 'sightseeing', title: 'Owakudani', location: 'Owakudani, Hakone' },
      { trip_id: 't', lat: 35.24, lng: 139.03, category: 'food', title: 'Kaiseki dinner', location: 'Sengokuhara, Hakone' },
    ],
    '2026-01-01',
  );
  assert.equal(town.photo_ref, null);
  assert.equal(town.photo_query, 'Owakudani, Owakudani, Hakone');
  const [withPhoto] = tripPoints(
    [{ id: 'u', name: 'Tokyo', start_date: '2020-01-01' }],
    [{ trip_id: 'u', lat: 35.7, lng: 139.7, category: 'sightseeing', title: 'Skytree', location: 'Tokyo', photo_ref: 'places/a/photos/b' }],
    '2026-01-01',
  );
  assert.equal(withPhoto.photo_query, null);
});

test('choosing a guide frames its own stops, not a region round its middle', () => {
  const kyotoNara = {
    kind: 'idea', guide: 'kyoto-nara', lat: 34.93, lng: 135.79,
    spots: [{ lat: 35.0, lng: 135.77 }, { lat: 34.97, lng: 135.78 }, { lat: 34.69, lng: 135.84 }],
  };
  const cam = focusCamera(kyotoNara);
  // Kyoto to Nara is about 35 km: framed from near, where the old fixed view stood 900 km back.
  assert.ok(cam.range >= 60000 && cam.range < 200000, `range ${cam.range}`);
  assert.ok(cam.center.lat < 35.0 && cam.center.lat > 34.69);
  assert.equal(focusCamera({ kind: 'idea', guide: 'iceland', lat: 64, lng: -19, spots: [] }).range, 900000);
  // A favourite guide is framed the same way.
  assert.equal(focusCamera({ ...kyotoNara, kind: 'favourite' }).range, cam.range);
  const [idea] = ideaPoints([{ slug: 'k', title: 'K', place: 'Kyoto', country: 'Japan', center: { lat: 35, lng: 135 }, spots: kyotoNara.spots }]);
  assert.equal(idea.spots.length, 3);
});

test('a trip is completed or upcoming by its dates, and a favourite as well if favourited', () => {
  const stops = (id) => [
    { trip_id: id, lat: 38.72, lng: -9.14, category: 'sightseeing', title: 'Alfama', location: 'Lisbon' },
    { trip_id: id, lat: 41.15, lng: -8.61, category: 'sightseeing', title: 'Ribeira', location: 'Porto' },
  ];
  const today = '2026-09-16';
  const kindOf = (trip) => tripPoints([trip], stops(trip.id), today)[0].kind;
  assert.equal(kindOf({ id: 'a', name: 'Portugal someday' }), 'planned');
  assert.equal(kindOf({ id: 'b', name: 'Portugal in May', start_date: '2026-05-01', end_date: '2026-05-05' }), 'been');
  assert.equal(kindOf({ id: 'c', name: 'Portugal now', start_date: '2026-09-14', end_date: '2026-09-20' }), 'planned');
  const towns = tripPoints([{ id: 'b', name: 'Portugal in May', start_date: '2026-05-01', end_date: '2026-05-05' }], stops('b'), today, new Set(['b']));
  assert.equal(towns.length, 2);
  assert.ok(towns.every((p) => p.favourite && p.kind === 'been'));
  // Two towns, one trip: counted once under each.
  assert.deepEqual([globeCounts(towns).been, globeCounts(towns).favourite], [1, 1]);
});

test('favourites turn on and off without touching the sets they came from', async () => {
  const { withFavourite, noFavourites, favouritesMissing } = await import('../lib/favourites.js');
  const empty = noFavourites();
  const one = withFavourite(empty, { tripId: 't1' }, true);
  const two = withFavourite(one, { guide: 'kyoto-nara' }, true);
  assert.equal(empty.trips.size, 0);
  assert.deepEqual([...two.trips, ...two.guides], ['t1', 'kyoto-nara']);
  assert.deepEqual([...withFavourite(two, { tripId: 't1' }, false).trips], []);
  assert.equal(favouritesMissing({ code: '42P01', message: 'relation "public.favourites" does not exist' }), true);
  assert.equal(favouritesMissing({ code: '23505', message: 'duplicate key' }), false);
});

test('a trip unfolds in order: by day, then time, then place in the day, without transport', async () => {
  const { tripRoute, routeLegs, stopsNear } = await import('../lib/globe.js');
  const acts = [
    { title: 'Gion at dusk', category: 'sightseeing', day: '2026-08-24', start_time: '18:00:00', sort_order: 0, lat: 35.0, lng: 135.78 },
    { title: 'Senso-ji', category: 'sightseeing', day: '2026-08-22', start_time: '11:30:00', sort_order: 0, lat: 35.71, lng: 139.8 },
    { title: 'Shinkansen to Kyoto', category: 'transport', day: '2026-08-24', start_time: '13:20:00', lat: 34.98, lng: 135.76 },
    { title: 'Breakfast at Tsukiji', category: 'food', day: '2026-08-22', start_time: '09:00:00', sort_order: 0, lat: 35.66, lng: 139.77 },
    { title: 'Owakudani', category: 'sightseeing', day: '2026-08-24', start_time: '09:00:00', sort_order: 0, lat: 35.24, lng: 139.02 },
    { title: 'Someday', category: 'food', lat: 35.1, lng: 135.7 },
  ];
  const route = tripRoute(acts);
  assert.deepEqual(route.map((s) => [s.n, s.name, s.section]), [
    [1, 'Breakfast at Tsukiji', 0], [2, 'Senso-ji', 0],
    [3, 'Owakudani', 1], [4, 'Gion at dusk', 1],
    [5, 'Someday', 2],
  ]);
  // One unbroken line: day two's leg starts at day one's last stop.
  const legs = routeLegs(route);
  assert.deepEqual(legs.map((l) => [l.section, l.points.map((p) => p.n)]), [[0, [1, 2]], [1, [2, 3, 4]], [2, [4, 5]]]);
  assert.deepEqual(stopsNear(route, { lat: 35.68, lng: 139.77 }).map((s) => s.n), [1, 2]);
});

test('stop numbers are dark on light day colours and white on dark ones', async () => {
  const { inkOn, rgbOf } = await import('../components/mapPin.js');
  // The day colours arrive as hsl() from the trip map's palette.
  assert.deepEqual(rgbOf('hsl(61 70% 52%)'), [215, 218, 47]);
  assert.deepEqual(rgbOf('#a34f35'), [163, 79, 53]);
  assert.equal(inkOn('hsl(0 70% 52%)'), '#ffffff');
  assert.equal(inkOn([218, 47, 47]), '#ffffff'); // red
  assert.equal(inkOn([61, 47, 218]), '#ffffff'); // blue
  assert.equal(inkOn([215, 218, 47]), '#1d1b18'); // yellow
  assert.equal(inkOn([47, 218, 53]), '#1d1b18'); // green
  assert.equal(inkOn([47, 207, 218]), '#1d1b18'); // cyan
});

test('a close view aimed at sea level is moved in onto the ground', () => {
  // Owakudani, seen from the south at 55°: aimed at sea level, the view met the
  // hillside 1.8 km short at 1,270 m; aimed at 1,270 m, 0.5 km past at 917 m.
  const stop = { lat: 35.2444, lng: 139.0198 };
  const short = groundOffset(stop, { lat: 35.22809, lng: 139.0198 }, 0);
  const past = groundOffset(stop, { lat: 35.24893, lng: 139.0198 }, 0);
  assert.ok(Math.abs(short + 1816) < 5 && Math.abs(past - 504) < 5);
  // Facing east, a miss to the north is off to the side, not short or past.
  assert.ok(Math.abs(groundOffset(stop, { lat: 35.25, lng: 139.0198 }, 90)) < 1);
  // One try assumes level ground; two follow the slope between them.
  const first = nextGroundAltitude([{ alt: 0, off: short }], 55);
  assert.ok(Math.abs(first - 1271) < 5);
  const second = nextGroundAltitude([{ alt: 0, off: short }, { alt: 1270, off: past }], 55);
  assert.ok(second > 960 && second < 1020);
  // Two landings on the same side are not a slope to follow: a reading a few
  // metres different while terrain loads once sent the aim 1,300 m underground.
  const same = nextGroundAltitude([{ alt: 0, off: -1200 }, { alt: 840, off: -1250 }], 55);
  assert.ok(same > 840 && same < 1800);
  const sameOther = nextGroundAltitude([{ alt: 0, off: -1200 }, { alt: 840, off: -1150 }], 55);
  assert.ok(sameOther > 840 && sameOther < 1700);
  // No step further than a slope could need, whatever the map reports.
  assert.equal(nextGroundAltitude([{ alt: 0, off: -900000 }], 55), 1500);
  assert.equal(nextGroundAltitude([{ alt: 8000, off: -900000 }], 55), 8900);
  // The nearest height known, and sea level where none is near.
  const samples = [{ lat: 35.49, lng: 138.78, alt: 820 }, { lat: 35.25, lng: 139.02, alt: 1000 }];
  assert.equal(groundNear(samples, { lat: 35.4869, lng: 138.7805 }), 820);
  assert.equal(groundNear(samples, { lat: 35.68, lng: 139.77 }), 0);
});

test('a card across the foot of a phone moves the aim, not the place behind it', () => {
  const camera = { center: { lat: 35.68, lng: 139.76 }, range: 45000, tilt: 45, heading: 0 };
  // A sheet over the lower half: the camera aims short of the trip, so the trip sits above it.
  const lifted = offsetCamera(camera, { bottom: 400 }, 800);
  assert.ok(lifted.center.lat < camera.center.lat);
  assert.ok(Math.abs(lifted.center.lng - camera.center.lng) < 1e-9);
  // Turned to face east, the same room is made to the side instead.
  const east = offsetCamera({ ...camera, heading: 90 }, { bottom: 400 }, 800);
  assert.ok(east.center.lng < camera.center.lng);
  assert.ok(Math.abs(east.center.lat - camera.center.lat) < 1e-9);
  // Nothing covering it, nothing to move; and never so much of it that no globe is left.
  assert.deepEqual(offsetCamera(camera, null, 800), camera);
  assert.deepEqual(offsetCamera(camera, { bottom: 760 }, 800), camera);
});

/*
 * Laying markers on the globe (lib/globe). The camera is rebuilt from what the
 * map reports, so the first test holds it to where Google's own map put its
 * own markers: numbers read off the live 3D map, in its 1024 × 708 box.
 */
const SEEN = [
  {
    // The whole-globe view: straight down, the centre a little below sea level.
    camera: { center: { lat: 35.71667456618547, lng: 139.79627693661763, altitude: -7480.395292193254 }, range: 17007478.746507168, tilt: 0, heading: 0, roll: 0 },
    markers: [
      [42.95, 141.18, 519.409, 301.169], [37.575, 127.003, 438.673, 335.652], [18.25, 107.05, 308.611, 437.951],
      [-8.42, 115.43, 360.483, 593.434], [23.9, 120.87, 390.08, 426.331], [68.156, 13.931, 409.54, 54.6787],
    ],
  },
  {
    // Tilted, turned and rolled all at once.
    camera: { center: { lat: 10, lng: 110, altitude: 0 }, range: 15000000, tilt: 45, heading: 300, roll: -30 },
    markers: [
      [42.95, 141.18, 724.586, 590.885], [37.575, 127.003, 697.963, 503.642], [18.25, 107.05, 568.547, 348.015],
      [-8.42, 115.43, 360.675, 388.013], [-41.74, 147.8, 83.6473, 656.34], [23.9, 120.87, 621.518, 445.693],
    ],
  },
];

test('the camera is rebuilt where Google puts its own markers, tilted, turned and rolled', () => {
  const W = 1024;
  const H = 708;
  const f = (H / 2) / Math.tan((35 / 2) * (Math.PI / 180));
  SEEN.forEach(({ camera, markers }) => {
    const view = viewOf(camera);
    markers.forEach(([lat, lng, x, y]) => {
      const to = groundAt(lat, lng).at.map((v, i) => v - view.eye[i]);
      const along = (axis) => to[0] * axis[0] + to[1] * axis[1] + to[2] * axis[2];
      const at = [W / 2 + (f * along(view.right)) / along(view.look), H / 2 - (f * along(view.up)) / along(view.look)];
      assert.ok(Math.abs(at[0] - x) < 2.5 && Math.abs(at[1] - y) < 2.5, `${lat},${lng}: ${at.map(Math.round)} vs ${x},${y}`);
    });
  });
});

const overhead = (lat, lng, more = {}) => ({ center: { lat, lng, altitude: 0 }, range: 17000000, tilt: 0, heading: 0, roll: 0, ...more });

test('the camera looks at its centre from its range, from behind it when tilted, or is the centre held in the air', () => {
  const camera = { center: { lat: 35, lng: 139, altitude: 40 }, range: 3000, tilt: 60, heading: 0, roll: 0 };
  const centre = groundAt(35, 139, 40);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const from = (view) => centre.at.map((v, i) => v - view.eye[i]);
  const view = viewOf(camera);
  assert.ok(Math.abs(Math.hypot(...from(view)) - 3000) < 1e-6);
  assert.ok(dot(from(view), view.look) > 3000 - 1e-6);
  // Facing north it stands south of the centre; turned round, north of it.
  assert.ok(dot(from(view), centre.north) > 0);
  assert.ok(dot(from(viewOf({ ...camera, heading: 180 })), centre.north) < 0);
  // A point in the air (no range, the height in the centre) is the same camera as the ground seen from that far.
  const ground = viewOf(overhead(10, 20));
  const air = viewOf({ center: { lat: 10, lng: 20, altitude: 17000000 }, range: 0, tilt: 0, heading: 0, roll: 0 });
  assert.ok(Math.hypot(...ground.eye.map((v, i) => v - air.eye[i])) < 1e-3);
  assert.ok(Math.abs(air.height - 17000000) < 30000);
  assert.equal(viewOf(null), null);
  assert.equal(viewOf({ center: { lat: NaN, lng: 0 } }), null);
});

test('the ground under a camera looking down faces it, and the edge of the globe is edge-on', () => {
  const view = viewOf(overhead(0, 0));
  assert.ok(Math.abs(slantOf(view, groundAt(0, 0)).facing - 1) < 1e-9);
  // The horizon from 17,000 km up is 74° round; just inside it the ground is turned all but edge-on.
  const rim = slantOf(view, groundAt(0, 73.7));
  assert.ok(rim.facing > 0 && rim.facing < 0.05);
  assert.ok(slantOf(view, groundAt(0, 78)).facing < 0);
  // Halfway to it: leaning away, but plainly seen.
  const half = slantOf(view, groundAt(0, 45)).facing;
  assert.ok(half > 0.3 && half < 0.8);
  // Behind the camera is no place to be laid.
  assert.equal(slantOf(view, groundAt(0, 0, 3 * 17000000)), null);
});

test('a pin is squashed the way the ground leans on the screen: outwards from the middle of the globe', () => {
  const view = viewOf(overhead(0, 0));
  const east = slantOf(view, groundAt(0, 50));
  assert.ok(east.dx > 0.99 && Math.abs(east.dy) < 0.01);
  const north = slantOf(view, groundAt(50, 0));
  assert.ok(north.dy < -0.99 && Math.abs(north.dx) < 0.01);
  const southWest = slantOf(view, groundAt(-40, -40));
  assert.ok(southWest.dx < 0 && southWest.dy > 0);
  assert.ok(Math.abs(Math.hypot(southWest.dx, southWest.dy) - 1) < 1e-9);
});

test('turning the camera turns the lean and leaves how flat the ground lies alone', () => {
  const spot = groundAt(0, 50);
  const straight = slantOf(viewOf(overhead(0, 0)), spot);
  // Facing east, the spot is up the screen.
  const east = slantOf(viewOf(overhead(0, 0, { heading: 90 })), spot);
  assert.ok(Math.abs(east.facing - straight.facing) < 1e-9);
  assert.ok(east.dy < -0.99 && Math.abs(east.dx) < 0.01);
  // Rolled a quarter turn, it is up or down instead of across.
  const rolled = slantOf(viewOf(overhead(0, 0, { roll: 90 })), spot);
  assert.ok(Math.abs(rolled.facing - straight.facing) < 1e-9);
  assert.ok(Math.abs(rolled.dx) < 0.01 && Math.abs(rolled.dy) > 0.99);
  // Tilted, the ground under the middle of the view lies at a slant even though it is not near an edge.
  const tilted = slantOf(viewOf(overhead(0, 0, { tilt: 60, range: 2000000 })), groundAt(0, 0));
  assert.ok(Math.abs(tilted.facing - 0.5) < 0.02);
  assert.ok(Math.abs(tilted.dx) < 0.01 && Math.abs(tilted.dy) > 0.99);
});

test('pins lie flat from far out and stand up close in, smoothly between', () => {
  assert.equal(laidAt(17000000), 1);
  assert.equal(laidAt(4000000), 1);
  assert.equal(laidAt(500000), 0);
  assert.equal(laidAt(1000000), 0);
  assert.equal(laidAt(2500000), 0.5);
  let last = -1;
  for (let h = 900000; h <= 4200000; h += 100000) {
    assert.ok(laidAt(h) >= last);
    last = laidAt(h);
  }
});

test('a laid pin is as thin as the ground under it, never a sliver, and stands where the camera is close', () => {
  const far = viewOf(overhead(0, 0));
  // Facing the camera it needs no laying at all.
  assert.equal(lieOn(far, groundAt(0, 0)), null);
  const half = lieOn(far, groundAt(0, 45));
  assert.ok(half.squash > 0.3 && half.squash < 0.8);
  assert.ok(half.dx > 0.99);
  // By the rim it is as thin as a pin is allowed to be.
  const rim = lieOn(far, groundAt(0, 73.7));
  assert.ok(Math.abs(rim.squash - 0.3) < 1e-9);
  // From 900 km the map's pins stand, tilted or not, wherever they are.
  const near = viewOf({ center: { lat: 35, lng: 135, altitude: 0 }, range: 900000, tilt: 20, heading: 0, roll: 0 });
  assert.equal(lieOn(near, groundAt(35.2, 135.3)), null);
  assert.equal(lieOn(null, groundAt(0, 0)), null);
  // Half way in between, half laid.
  const between = lieOn(viewOf(overhead(0, 0, { range: 2500000 })), groundAt(0, 25));
  const full = lieOn(viewOf(overhead(0, 0, { range: 4500000 })), groundAt(0, 25));
  assert.ok(between.squash > full.squash);
});

test('the squash matrix shrinks what runs along the lean and leaves what runs across it', () => {
  const apply = ([a, b, c, d], [x, y]) => [a * x + c * y, b * x + d * y];
  const near = (got, want) => got.forEach((v, i) => assert.ok(Math.abs(v - want[i]) < 1e-9, `${got} vs ${want}`));
  near(squashMatrix({ squash: 0.5, dx: 1, dy: 0 }), [0.5, 0, 0, 1]);
  near(squashMatrix({ squash: 0.5, dx: 0, dy: 1 }), [1, 0, 0, 0.5]);
  near(squashMatrix({ squash: 1, dx: 0.6, dy: 0.8 }), [1, 0, 0, 1]);
  const m = squashMatrix({ squash: 0.25, dx: 0.6, dy: 0.8 });
  near(apply(m, [0.6, 0.8]), [0.15, 0.2]);
  near(apply(m, [-0.8, 0.6]), [-0.8, 0.6]);
});
