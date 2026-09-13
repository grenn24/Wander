import test from 'node:test';
import assert from 'node:assert/strict';
import { deskChanges, sharedDesk } from '../lib/sharedPlanningDesk.js';

test('only changed fields are sent, preserving other members edits', () => {
  const before = [{ id: 'a', text: 'old', x: .2 }, { id: 'b', text: 'other note' }];
  assert.deepEqual(deskChanges(before, [{ ...before[0], x: .8 }, before[1]]),
    [{ id: 'a', patch: { x: .8 }, create: false, blob: null }]);
  assert.deepEqual(deskChanges(before, [before[1]]), [{ id: 'a', patch: {}, remove: true }]);
});

test('migration ignores duplicate IDs, so stale local copies cannot overwrite shared notes', async () => {
  const rows = [];
  const remote = sharedDesk({ from: table => ({ upsert: async (row, options) => {
    rows.push({ table, row, options }); return {};
  } }) }, 'trip');
  await remote.importLocal([{ id: 'a', kind: 'note', text: 'local' }]);
  assert.equal(rows[0].table, 'trip_desk_items');
  assert.equal(rows[0].row.trip_id, 'trip');
  assert.deepEqual(rows[0].options, { onConflict: 'trip_id,id', ignoreDuplicates: true });
});

test('photo upload failures prevent publishing a broken shared picture', async () => {
  let saved = false;
  const remote = sharedDesk({
    storage: { from: () => ({ upload: async () => ({ error: new Error('offline') }) }) },
    rpc: async () => { saved = true; return {}; },
  }, 'trip');
  await assert.rejects(remote.save({ id: 'a', create: true, patch: {}, blob: new Blob(['photo'], { type: 'image/png' }) }), /offline/);
  assert.equal(saved, false);
});

test('retrying an uploaded picture uses the existing private object', async () => {
  let args;
  const remote = sharedDesk({
    storage: { from: bucket => ({ upload: async (path) => {
      assert.equal(bucket, 'planning-desk'); assert.equal(path, 'trip/a');
      return { error: { statusCode: '409' } };
    } }) },
    rpc: async (name, values) => { args = { name, values }; return {}; },
  }, 'trip');
  await remote.save({ id: 'a', create: true, patch: { kind: 'photo' }, blob: new Blob(['photo'], { type: 'image/png' }) });
  assert.equal(args.name, 'save_desk_item');
  assert.equal(args.values.p_patch.picture, 'trip/a');
});
