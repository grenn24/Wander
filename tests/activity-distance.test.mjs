import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDistance, activityEnd, arrivalQueries, arrivalPins } from '../lib/geo.js';

const start = { day: '2026-11-27', lat: 0, lng: 0 };
const end = { ...start, lng: 1 };

test('estimates a same-day transfer even without times, including zero coordinates', () => {
  assert.ok(Math.abs(activityDistance(start, end) - 111.195) < .01);
  assert.equal(activityDistance(start, start), 0);
});

test('does not invent transfers across dates or missing and invalid locations', () => {
  assert.equal(activityDistance(undefined, end), null);
  assert.equal(activityDistance(start, { ...end, day: '2026-11-28' }), null);
  for (const coords of [{lat:null}, {lng:undefined}, {lat:NaN}, {lng:Infinity}, {lat:91}, {lng:181}]) {
    assert.equal(activityDistance(start, { ...end, ...coords }), null);
    assert.equal(activityDistance({ ...start, ...coords }, end), null);
  }
});

/* ------------------------------------------------- journeys and arrivals --- */

const day = '2026-12-12';
const changi = { lat: 1.3644, lng: 103.9915 };
const narita = { lat: 35.772, lng: 140.3929 };
const ginza = { id: 'g', day, category: 'shopping', lat: 35.6717, lng: 139.765 };
const flight = {
  id: 'f', day, category: 'transport', subtype: 'flight', ...changi,
  details: { code: 'NH804', from: 'Singapore Changi Airport (SIN)', to: 'Narita International Airport (NRT)' },
};
const landed = { ...flight, details: { ...flight.details, _arrive: { q: flight.details.to, ...narita } } };

test('the way on from a journey starts where it arrives, not where it departed', () => {
  const km = activityDistance(landed, ginza);
  assert.ok(km > 50 && km < 70, `Narita to Ginza, not Changi to Ginza (${km})`);
  assert.deepEqual(activityEnd(landed), narita);
});

test('an arrival not yet found, or found for other words, is unknown rather than the departure', () => {
  assert.equal(activityEnd(flight), null);
  assert.equal(activityDistance(flight, ginza), null);
  const moved = { ...landed, details: { ...landed.details, to: 'Haneda Airport (HND)' } };
  assert.equal(activityDistance(moved, ginza), null, 'a pin for Narita says nothing about Haneda');
  const broken = { ...landed, details: { ...landed.details, _arrive: { q: flight.details.to, lat: 95, lng: 0 } } };
  assert.equal(activityDistance(broken, ginza), null);
});

test('a journey with no far end written down, and everything else, ends at its own pin', () => {
  const taxi = { ...flight, subtype: 'car', details: { from: 'Hotel' } };
  assert.deepEqual(activityEnd(taxi), changi);
  assert.deepEqual(activityEnd({ ...ginza, details: { to: 'ignored off transport' } }), { lat: ginza.lat, lng: ginza.lng });
  // The way to a journey is still to where it departs.
  assert.ok(Math.abs(activityDistance(ginza, landed) - activityDistance(ginza, { ...ginza, ...changi })) < 1e-9);
});

test('asks once for each arrival without a pin, for the airport or station it means', () => {
  const train = { id: 't', day, category: 'transport', subtype: 'train', details: { to: 'Kyoto' } };
  const station = { ...train, id: 's', details: { to: 'Tokyo Station' } };
  const bus = { id: 'b', day, category: 'transport', subtype: 'bus', details: { to: 'Osaka' } };
  const queries = arrivalQueries([flight, landed, ginza, train, station, bus, null, { ...flight, id: null }]);
  assert.deepEqual(queries.map((q) => [q.id, q.query]), [
    ['f', 'Narita International Airport (NRT)'],
    ['t', 'Kyoto station'],
    ['s', 'Tokyo Station'],
    ['b', 'Osaka'],
  ]);
  assert.deepEqual(queries[0], {
    id: 'f', to: flight.details.to, query: flight.details.to,
    title: flight.details.to, category: 'transport', day,
  });
  const code = arrivalQueries([{ ...flight, details: { to: ' NRT ' } }])[0];
  assert.equal(code.query, 'NRT airport');
  assert.equal(code.to, 'NRT');
});

test('keeps each answer as a pin for the words it was asked about, and drops doubtful ones', () => {
  const queries = arrivalQueries([flight, { ...flight, id: 'f2' }, { ...flight, id: 'f3' }, { ...flight, id: 'f4' }]);
  const pins = arrivalPins(queries, [
    { id: 'f', found: true, confidence: 'high', ...narita },
    { id: 'f2', found: true, confidence: 'low', ...narita },
    { id: 'f3', found: false },
    { id: 'f4', found: true, confidence: 'medium', lat: null, lng: null },
    { id: 'stranger', found: true, confidence: 'high', ...narita },
  ]);
  assert.deepEqual(pins, [{ id: 'f', pin: { q: flight.details.to, ...narita } }]);
  assert.deepEqual(activityEnd({ ...flight, details: { ...flight.details, _arrive: pins[0].pin } }), narita);
  assert.deepEqual(arrivalPins(null, null), []);
});
