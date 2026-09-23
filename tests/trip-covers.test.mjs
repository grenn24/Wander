import test from 'node:test';
import assert from 'node:assert/strict';
import { COVERS_KEEP_MS, keepCovers, mergeCovers, readCovers } from '../lib/tripCovers.js';

test('a trip keeps the photo it had until a newer read says otherwise', () => {
  const kept = { a: 'places/A/photos/1', gone: 'places/G/photos/1' };
  // The read found a photo for b, and none yet for a.
  const merged = mergeCovers(kept, { b: 'places/B/photos/1' }, ['a', 'b', 'c']);
  assert.deepEqual(merged, { a: 'places/A/photos/1', b: 'places/B/photos/1' });
  // A trip no longer in the list is forgotten, and c has no photo to keep.
  assert.equal('gone' in merged, false);
});

test('only Google photo references are kept', () => {
  const merged = mergeCovers({ a: 'https://example.com/a.jpg', b: 42 }, null, ['a', 'b']);
  assert.deepEqual(merged, {});
  assert.deepEqual(mergeCovers(null, null, null), {});
});

test('what is kept is forgotten after a month, as Google asks of its content', () => {
  const store = new Map();
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
  const day = 24 * 60 * 60 * 1000;
  keepCovers({ a: 'places/A/photos/1' }, 1000 * day);
  assert.deepEqual(readCovers(1000 * day + 29 * day), { a: 'places/A/photos/1' });
  assert.deepEqual(readCovers(1000 * day + COVERS_KEEP_MS + 1), {});
  delete global.localStorage;
});
