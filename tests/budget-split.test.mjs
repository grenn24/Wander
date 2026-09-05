import test from 'node:test';
import assert from 'node:assert/strict';
import { splitBudget } from '../lib/budgetSplit.js';

test('member shares add up exactly, with deterministic rounding independent of list order', () => {
  const shares = splitBudget(100, ['c', 'a', 'b']);
  assert.deepEqual(shares.map((s) => s.amount), [33.34, 33.33, 33.33]);
  assert.deepEqual(shares, splitBudget(100, ['b', 'c', 'a', 'a']));
  assert.equal(shares.reduce((n, s) => n + Math.round(s.amount * 100), 0), 10000);
});
test('split respects zero-decimal and three-decimal currencies and empty selections', () => {
  assert.deepEqual(splitBudget(100, ['a', 'b', 'c'], 'JPY').map((s) => s.amount), [34, 33, 33]);
  assert.deepEqual(splitBudget(1, ['a', 'b', 'c'], 'KWD').map((s) => s.amount), [0.334, 0.333, 0.333]);
  assert.deepEqual(splitBudget(20, []), []);
  assert.deepEqual(splitBudget(0, ['a']).map((s) => s.amount), [0]);
});
