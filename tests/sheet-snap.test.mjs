import test from 'node:test';
import assert from 'node:assert/strict';
import { letGo, settleOn, stiffen } from '../lib/sheetSnap.js';

// The globe's trip sheet: its name alone, its days, or the whole screen.
const SIZES = [145, 325, 715];

test('a slow drag settles at whichever size it is nearest', () => {
  assert.equal(settleOn(SIZES, { from: 325, height: 220, speed: 0.1 }), 0);
  // Barely shifted, and slowly: it goes back where it was.
  assert.equal(settleOn(SIZES, { from: 325, height: 300, speed: 0.1 }), 1);
  assert.equal(settleOn(SIZES, { from: 145, height: 300, speed: 0.1 }), 1);
  assert.equal(settleOn(SIZES, { from: 325, height: 600, speed: 0.1 }), 2);
  // Let go without moving and nothing changes.
  assert.equal(settleOn(SIZES, { from: 325, height: 325, speed: 0, moved: false }), 1);
});

test('a flick carries it one size further the way it was going', () => {
  // Barely moved, but quickly: up from the name is the days, not the name again.
  assert.equal(settleOn(SIZES, { from: 145, height: 215, speed: 2.5 }), 1);
  assert.equal(settleOn(SIZES, { from: 715, height: 650, speed: -2.5 }), 1);
  // Flicked at the end of its travel, there is nowhere further to go.
  assert.equal(settleOn(SIZES, { from: 715, height: 760, speed: 2.5 }), 2);
  assert.equal(settleOn(SIZES, { from: 145, height: 120, speed: -2.5 }), 0);
  // A drag that already carried it somewhere else is not carried again.
  assert.equal(settleOn(SIZES, { from: 145, height: 700, speed: 2.5 }), 2);
  // A press that never became a drag is not a flick, whatever the numbers say.
  assert.equal(settleOn(SIZES, { from: 145, height: 145, speed: 2.5, moved: false }), 0);
});

test('sizes that measure the same go the way the hand was going', () => {
  // A sheet with one thing in it is as tall as that thing at every size.
  const short = [61, 74, 74];
  assert.equal(settleOn(short, { from: 61, height: 300, speed: 0.1 }), 2);
  assert.equal(settleOn(short, { from: 74, height: 20, speed: 0.1 }), 0);
  assert.equal(settleOn([80, 80, 80], { from: 80, height: 90, speed: 0.1 }), 2);
});

test('the ends hold rather than break', () => {
  assert.equal(stiffen(300, 145, 715), 300);
  assert.equal(stiffen(145, 145, 715), 145);
  // Beyond either end it still moves, at a third of the pace.
  assert.equal(stiffen(775, 145, 715), 735);
  assert.equal(stiffen(115, 145, 715), 135);
});

test('a dialog on a phone closes when it is pulled far enough, or quickly', () => {
  const tall = { height: 700 };
  // A nudge is not a dismissal; a good pull is.
  assert.equal(letGo({ dy: 40, ...tall }), false);
  assert.equal(letGo({ dy: 200, ...tall }), true);
  // Short sheets go by their own height, tall ones by a sensible distance.
  assert.equal(letGo({ dy: 60, height: 180 }), true);
  assert.equal(letGo({ dy: 40, height: 180 }), false);
  // A flick decides on its own, in either direction.
  assert.equal(letGo({ dy: 20, down: 1.4, ...tall }), true);
  assert.equal(letGo({ dy: 300, down: -1.4, ...tall }), false);
  // Pulled upwards, where there is nothing to open.
  assert.equal(letGo({ dy: -120, ...tall }), false);
  assert.equal(letGo({ dy: 10, height: 0 }), false);
});

test('a sheet with no sizes to settle at does not throw', () => {
  assert.equal(settleOn([], { from: 0, height: 0 }), 0);
  assert.equal(settleOn(null, { from: 0, height: 0 }), 0);
});
