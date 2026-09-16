import test from 'node:test';
import assert from 'node:assert/strict';
import {
  km, centroid, cluster, townOf, tripPoints, savedPoints, ideaPoints, photoQueryOf,
  overviewCamera, focusCamera, groupCamera, flightMillis, globeCounts,
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

  const counts = globeCounts(pins);
  assert.deepEqual([counts.been, counts.planned, counts.beenTrips, counts.plannedTrips], [2, 1, 1, 1]);
});

test('ideas skip journeys already saved; saved rows become pins', () => {
  const saved = [{ id: 1, kind: 'want', name: 'Kyoto', lat: 35, lng: 135.7, journey: 'kyoto' }];
  const ideas = ideaPoints([
    { slug: 'kyoto', title: 'K', place: 'Kyoto', country: 'Japan', center: { lat: 35, lng: 135 } },
    { slug: 'iceland', title: 'I', place: 'Iceland', country: 'Iceland', center: { lat: 64, lng: -19 } },
  ], saved);
  assert.deepEqual(ideas.map((p) => p.journey), ['iceland']);
  assert.equal(ideas[0].label, 'Iceland');
  const pins = savedPoints([...saved, { id: 2, kind: 'been', name: 'Bad', lat: 91, lng: 0 }]);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].kind, 'want');
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

test('choosing a journey frames its own stops, not a region round its middle', () => {
  const kyotoNara = {
    kind: 'idea', lat: 34.93, lng: 135.79,
    spots: [{ lat: 35.0, lng: 135.77 }, { lat: 34.97, lng: 135.78 }, { lat: 34.69, lng: 135.84 }],
  };
  const cam = focusCamera(kyotoNara);
  // Kyoto to Nara is about 35 km: framed from near, where the old fixed view stood 900 km back.
  assert.ok(cam.range >= 60000 && cam.range < 200000, `range ${cam.range}`);
  assert.ok(cam.center.lat < 35.0 && cam.center.lat > 34.69);
  assert.equal(focusCamera({ kind: 'idea', lat: 64, lng: -19, spots: [] }).range, 900000);
  const [idea] = ideaPoints([{ slug: 'k', title: 'K', place: 'Kyoto', country: 'Japan', center: { lat: 35, lng: 135 }, spots: kyotoNara.spots }], []);
  assert.equal(idea.spots.length, 3);
});

test('a trip with no dates is somewhere you want to go, not an upcoming trip', () => {
  const stop = (id) => [{ trip_id: id, lat: 38.72, lng: -9.14, category: 'sightseeing', title: 'Alfama', location: 'Lisbon' }];
  const today = '2026-09-16';
  const kindOf = (trip) => tripPoints([trip], stop(trip.id), today)[0].kind;
  assert.equal(kindOf({ id: 'a', name: 'Lisbon someday' }), 'want');
  assert.equal(kindOf({ id: 'b', name: 'Lisbon in May', start_date: '2026-05-01', end_date: '2026-05-05' }), 'been');
  assert.equal(kindOf({ id: 'c', name: 'Lisbon now', start_date: '2026-09-14', end_date: '2026-09-20' }), 'planned');
  assert.equal(kindOf({ id: 'd', name: 'Lisbon next year', start_date: '2027-05-01' }), 'planned');
  const counts = globeCounts(tripPoints([{ id: 'a', name: 'Lisbon someday' }], stop('a'), today));
  assert.equal(counts.want, 1);
});
