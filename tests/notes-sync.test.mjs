import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotesSync } from '../lib/notesSync.js';

function harness() {
  let state, job, id = 0;
  const writes = [];
  const editor = createNotesSync('original', {
    publish: (s) => { state = s; },
    clock: { setTimeout: (fn) => { job = fn; return ++id; }, clearTimeout: () => { job = null; } },
    save: (value) => new Promise((resolve) => { writes.push({ value, resolve }); editor.receive(value); }),
  });
  return { editor, writes, get state() { return state; },
    tick() { const fn = job; job = null; fn?.(); },
    async finish(index, ok = true) { writes[index].resolve(ok); await Promise.resolve(); },
  };
}

test('optimistic updates and realtime echoes of our own saves are not conflicts', async () => {
  const h = harness();
  h.editor.change('first'); h.tick();
  assert.equal(h.state.incoming, null);
  h.editor.change('second');
  await h.finish(0);
  assert.equal(h.state.text, 'second');
  assert.equal(h.state.status, 'Saving…');
  h.tick(); await h.finish(1);
  h.editor.receive('first');
  assert.equal(h.state.text, 'second');
  assert.equal(h.state.incoming, null);
  assert.equal(h.state.status, 'Saved');
});
test('slow saves serialize and keep the newest draft queued', async () => {
  const h = harness();
  h.editor.change('first'); h.tick();
  h.editor.change('second'); h.tick();
  assert.equal(h.writes.length, 1);
  await h.finish(0);
  assert.equal(h.writes[1].value, 'second');
  await h.finish(1);
  assert.equal(h.state.status, 'Saved');
});
test('a real conflicting edit pauses autosave and use theirs cancels the draft', () => {
  const h = harness();
  h.editor.change('mine'); h.editor.receive('theirs'); h.tick();
  assert.equal(h.writes.length, 0);
  assert.equal(h.state.incoming, 'theirs');
  h.editor.useTheirs(); h.tick();
  assert.equal(h.state.text, 'theirs');
  assert.equal(h.state.incoming, null);
  assert.equal(h.writes.length, 0);
});
test('keep mine actually saves without requiring another keystroke', async () => {
  const h = harness();
  h.editor.change('mine'); h.editor.receive('theirs');
  h.editor.keepMine(); h.tick();
  assert.equal(h.writes[0].value, 'mine');
  await h.finish(0);
  assert.equal(h.state.status, 'Saved');
});
test('use theirs during an in-flight save preserves the explicit choice', async () => {
  const h = harness();
  h.editor.change('mine'); h.tick(); h.editor.receive('theirs');
  h.editor.useTheirs(); h.tick(); await h.finish(0);
  assert.equal(h.writes[1].value, 'theirs');
  await h.finish(1);
  assert.equal(h.state.text, 'theirs');
});
test('failed saves retain the draft and can be retried', async () => {
  const h = harness();
  h.editor.change('mine'); h.tick(); await h.finish(0, false);
  assert.equal(h.state.status, 'Could not save');
  assert.equal(h.state.text, 'mine');
  h.editor.retry(); h.tick(); await h.finish(1);
  assert.equal(h.state.status, 'Saved');
});
test('clean editors accept remote changes; disposal cancels pending saves', () => {
  const h = harness();
  h.editor.receive('theirs');
  assert.equal(h.state.text, 'theirs');
  h.editor.change('mine'); h.editor.dispose(); h.tick();
  assert.equal(h.writes.length, 0);
});
test('completion after switching trips cannot publish into the next editor', async () => {
  const h = harness();
  h.editor.change('mine'); h.tick(); h.editor.dispose();
  const previous = h.state;
  await h.finish(0);
  assert.equal(h.state, previous);
});
