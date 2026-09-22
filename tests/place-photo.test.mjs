import test from 'node:test';
import assert from 'node:assert/strict';
import { placeOfPhoto } from '../lib/places.js';

test('a stale photo reference still names its place, to ask for its photos again', () => {
  assert.equal(placeOfPhoto('places/ChIJ45IxpAtkGGAR3_hG0anDMg0/photos/AVoNoX-1_ab'), 'ChIJ45IxpAtkGGAR3_hG0anDMg0');
  // Only ever a Google photo resource name.
  assert.equal(placeOfPhoto('https://example.com/a.jpg'), null);
  assert.equal(placeOfPhoto('places/ChIJ/photos/a/../../secret'), null);
  assert.equal(placeOfPhoto(''), null);
  assert.equal(placeOfPhoto(undefined), null);
});
