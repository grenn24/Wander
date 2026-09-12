import test from 'node:test';
import assert from 'node:assert/strict';
import { planningProgress } from '../lib/planningProgress.js';

const days = [{ index: 1, activities: [{}, {}] }, { index: 2, activities: [{}] }];
test('progress reports the streamed day and actual activity count', () => {
  assert.equal(planningProgress({ phase: 'streaming', days, expected: 5 }), 'Day 2 of 5 · 3 activities drafted');
  assert.equal(planningProgress({ phase: 'streaming', days: [{ index: 1, activities: [{}] }] }), 'Day 1 · 1 activity drafted');
  assert.equal(planningProgress({ phase: 'streaming' }), 'Building your itinerary…');
});
test('animation is absent while awaiting answers, reviewing or after an error', () => {
  for (const state of [{ phase: 'clarifying', awaitingAnswers: true }, { phase: 'reviewing' }, { phase: 'error' }]) {
    assert.equal(planningProgress(state), null);
  }
});
test('status follows real reading, checking, locating and saving phases', () => {
  assert.equal(planningProgress({ phase: 'reading', pictureCount: 1 }), 'Reading your picture…');
  assert.equal(planningProgress({ phase: 'clarifying' }), 'Checking the details that shape your trip…');
  assert.equal(planningProgress({ phase: 'locating', days }), 'Finding 3 stops on the map…');
  assert.equal(planningProgress({ phase: 'saving', days }), 'Saving your trip with 3 activities…');
});
