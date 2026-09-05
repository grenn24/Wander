import test from 'node:test';
import assert from 'node:assert/strict';
import { activityDistance } from '../lib/geo.js';

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
