import test from 'node:test';
import assert from 'node:assert/strict';
import { aiModel, aiEffort, effortFor } from '../lib/ai.js';

test('the least effort is spelled the way the called model wants it', () => {
  // gpt-5, gpt-5-mini and gpt-5-nano refuse "none"; later models refuse "minimal".
  for (const old of ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5-mini-2025-08-07']) {
    assert.equal(effortFor(old, 'none'), 'minimal', old);
    assert.equal(effortFor(old, 'minimal'), 'minimal', old);
  }
  for (const later of ['gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-5.5', 'gpt-5.1']) {
    assert.equal(effortFor(later, 'minimal'), 'none', later);
    assert.equal(effortFor(later, 'none'), 'none', later);
  }
  assert.equal(effortFor('gpt-5.5', 'low'), 'low');
  assert.equal(effortFor('gpt-5.5', 'extreme'), '', 'anything unknown is left out');
});

test('each task runs where the measurements put it', () => {
  const was = process.env.OPENAI_MODEL;
  delete process.env.OPENAI_MODEL;
  try {
    assert.equal(aiModel('plan'), 'gpt-5.5');
    assert.equal(aiModel('command'), 'gpt-5.5');
    assert.equal(aiModel('brief'), 'gpt-5.4-mini');
    assert.equal(aiEffort('brief'), 'none');
    assert.equal(aiModel('packing'), 'gpt-5.4-nano');
    assert.equal(aiEffort('vision'), 'low');
    // An account pinned to the old model still gets a request it accepts.
    process.env.OPENAI_MODEL = 'gpt-5-mini';
    assert.equal(aiModel('parse'), 'gpt-5-mini');
    assert.equal(aiEffort('parse'), 'minimal');
  } finally {
    if (was === undefined) delete process.env.OPENAI_MODEL; else process.env.OPENAI_MODEL = was;
  }
});
