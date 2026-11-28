import test from 'node:test';
import assert from 'node:assert/strict';
import { settlePlace } from '../lib/places.js';

/*
 * The stops from "plan a trip to Scandinavian countries, 4–17 Dec 2027,
 * aurora the highlight": every one came back asking "this place, or none of
 * these", although only one place had been found for most of them.
 */
const place = (id, lat, lng, score, extra = {}) => ({
  place_id: id, name: id, label: `${id}, somewhere`, lat, lng, score, ...extra,
});

const lookedUp = (id, chosen, candidates, confidence = 'medium') => ({
  id, ...chosen, found: true, confidence, ambiguous: true, candidates,
});

test('one match is pinned, not put to the traveller', () => {
  const palace = place('Amalienborg Palace', 55.6840, 12.5934, 61);
  const out = settlePlace(lookedUp('0', palace, [palace]));
  assert.equal(out.ambiguous, false);
  assert.equal(out.found, true);
  assert.equal(out.place_id, 'Amalienborg Palace');
  assert.equal(out.lat, 55.6840);
  // Whatever the lookup could not be sure of, with or without the model's ranking.
  const unranked = settlePlace(lookedUp('1', palace, [palace], 'uncertain'));
  assert.equal(unranked.ambiguous, false);
  assert.equal(unranked.found, true);
});

test('several names for one spot are not a choice', () => {
  // Vigeland: the sculptures, the park they stand in, the museum by the gate.
  const vigeland = place('The Vigeland Park', 59.9271, 10.7004, 62);
  const vigelandSet = [
    place('Frogner Park', 59.9270, 10.7020, 70),
    vigeland,
    place('The Vigeland Museum', 59.9246, 10.7058, 58),
    place('Gustav Vigeland Statue', 59.9270, 10.7008, 55),
  ];
  const park = settlePlace(lookedUp('12', vigeland, vigelandSet));
  assert.equal(park.ambiguous, false);
  assert.equal(park.place_id, 'The Vigeland Park', 'the ranking’s pick stands');

  // Karl Johans gate: what sits along one street, from the station to the palace.
  const shop = place('Karl Johans', 59.9136, 10.7392, 68);
  const street = settlePlace(lookedUp('13', shop, [
    shop,
    place('Karl Johan Monument', 59.9172, 10.7300, 64),
    place('Karl Johan Hotel', 59.9134, 10.7398, 63),
    place('NIO House Oslo', 59.9134, 10.7399, 58),
    place('Shopping in Oslo', 59.9115, 10.7480, 57),
  ]));
  assert.equal(street.ambiguous, false);
});

test('the same name in different places is still asked, and only those are offered', () => {
  const oslo = place('Scandic Oslo City', 59.9122, 10.7536, 70);
  const out = settlePlace(lookedUp('2', oslo, [
    oslo,
    place('Scandic Oslo City lobby bar', 59.9123, 10.7537, 66),
    place('Scandic Bergen City', 60.3913, 5.3221, 66),
    place('Scandic Byporten', 59.9116, 10.7516, 60),
  ]));
  assert.equal(out.ambiguous, true);
  assert.deepEqual(out.candidates.map((c) => c.place_id), ['Scandic Oslo City', 'Scandic Bergen City']);
});

test('a far-off match that scored much worse is not a rival', () => {
  const icehotel = place('ICEHOTEL', 67.8506, 20.5971, 80);
  const out = settlePlace(lookedUp('6', icehotel, [
    icehotel,
    place('Ice Bar Stockholm', 59.3345, 18.0610, 52),
  ]));
  assert.equal(out.ambiguous, false);
  assert.equal(out.place_id, 'ICEHOTEL');
});

test('a lone match the ranking rejects keeps its words, unpinned, without asking', () => {
  const park = place('Abisko National Park', 68.3500, 18.8300, 48);
  const out = settlePlace(lookedUp('5', park, [park], 'low'));
  assert.equal(out.found, false);
  assert.ok(!out.ambiguous);
  assert.deepEqual(out.candidates, []);

  // With somewhere else it could be, the traveller still gets to say.
  const two = settlePlace(lookedUp('5', park, [park, place('Abisko Canyon', 68.3570, 18.7830, 46)], 'low'));
  assert.equal(two.ambiguous, true);
  assert.equal(two.candidates.length, 2);
});

test('sure and missing answers pass through untouched', () => {
  const sure = { id: '9', found: true, confidence: 'high', ambiguous: false, candidates: [] };
  assert.equal(settlePlace(sure), sure);
  const missing = { id: '10', found: false, candidates: [] };
  assert.equal(settlePlace(missing), missing);
});
