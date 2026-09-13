import test from 'node:test';
import assert from 'node:assert/strict';
import { deskAnchor, deskPosition } from '../lib/planningDesk.js';

test('notes remain inside their margin when the screen narrows', () => {
  const item = { width: 240, x: 1, y: 60, day: 'friday' };
  assert.deepEqual(deskPosition(item, 400, { friday: 500 }), { width: 240, left: 160, top: 560 });
  assert.deepEqual(deskPosition(item, 180, { friday: 500 }), { width: 180, left: 0, top: 560 });
});

test('moving a note attaches it to the closest preceding day', () => {
  const anchors = { friday: 500, thursday: 120, saturday: 900 };
  assert.deepEqual(deskAnchor(570, anchors), { day: 'friday', y: 70 });
  assert.deepEqual(deskAnchor(30, anchors), { day: null, y: 30 });
  assert.deepEqual(deskAnchor(900, anchors), { day: 'saturday', y: 0 });
});

test('changing earlier activities moves the note with its day', () => {
  const item = { width: 220, x: .5, day: 'friday', y: 70 };
  assert.equal(deskPosition(item, 300, { friday: 800 }).top, 870);
  assert.equal(deskPosition(item, 300, {}).top, 70);
});
