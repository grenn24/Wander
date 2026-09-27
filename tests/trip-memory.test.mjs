import test from 'node:test';
import assert from 'node:assert/strict';
import { keepTripCount, readTripCount } from '../lib/tripMemory.js';

test('how many trips there were is remembered, and nonsense is not', () => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  assert.equal(readTripCount(), null); // nothing known yet: the line waits
  keepTripCount(3);
  assert.equal(readTripCount(), 3);
  keepTripCount(0);
  assert.equal(readTripCount(), 0);
  store.set('wander-trip-count-v1', 'lots');
  assert.equal(readTripCount(), null);
  delete global.localStorage;
});
