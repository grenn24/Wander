import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tickAnswer, isAnswered, answerText } from '../lib/briefAnswers.js';

test('several countries can be ticked for one trip', () => {
  let picked = tickAnswer(undefined, 'Norway');
  picked = tickAnswer(picked, 'Sweden');
  assert.deepEqual(picked, ['Norway', 'Sweden']);
  assert.equal(answerText(picked), 'Norway, Sweden');
  // Ticking again takes it off.
  assert.deepEqual(tickAnswer(picked, 'Norway'), ['Sweden']);
});

test('"No preference" stands alone', () => {
  const open = tickAnswer(['Norway', 'Sweden'], 'No preference');
  assert.deepEqual(open, ['No preference']);
  assert.deepEqual(tickAnswer(open, 'Denmark'), ['Denmark']);
});

test('a question counts as answered once anything is picked or typed', () => {
  assert.equal(isAnswered([]), false);
  assert.equal(isAnswered(['Denmark']), true);
  assert.equal(isAnswered('  '), false);
  assert.equal(isAnswered('Two adults'), true);
  assert.equal(isAnswered(undefined), false);
  assert.equal(answerText('  Relaxed '), 'Relaxed');
});

test('the brief check can ask a question with several answers', () => {
  const route = fs.readFileSync(new URL('../app/api/plan/route.js', import.meta.url), 'utf8');
  assert.match(route, /enum: \['choice', 'multi', 'text'\]/);
  assert.match(route, /never "Norway only"/);
  const page = fs.readFileSync(new URL('../app/plan/page.js', import.meta.url), 'utf8');
  assert.match(page, /q\.kind === 'multi'/);
  assert.match(page, /tickBrief\(q\.id, option\)/);
});
