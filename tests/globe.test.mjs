import test from 'node:test';
import assert from 'node:assert/strict';
import {
  km, centroid, cluster, townOf, tripPoints, savedPoints, ideaPoints, photoQueryOf,
  overviewCamera, focusCamera, groupCamera, flightMillis, globeCounts,
  groundOffset, nextGroundAltitude, groundNear, offsetCamera,
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
