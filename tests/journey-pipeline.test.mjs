import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRejected, rejectedOf } from '../scripts/journeys/pipeline.mjs';

test('turned-down media is removed and remembered with the journey', () => {
  const doc = {
    cover: { query: 'x', photo: { id: 'cover1' } },
    video: { id: 'vid00000001' },
    blocks: [{ type: 'prose' }, { type: 'photo', photos: [{ id: 'ph1' }] }],
    rejected: ['old'],
  };
  const rejected = rejectedOf(doc);
  const dropped = dropRejected(doc, { videoReject: true, photoRejects: [-1, 1, 0] }, rejected);
  assert.equal(dropped, 3);
  assert.equal(doc.video, null);
  assert.equal(doc.cover.photo, null);
  assert.deepEqual(doc.blocks[1].photos, []);
  assert.deepEqual([...rejectedOf(doc)].sort(), ['cover1', 'old', 'ph1', 'vid00000001']);
});

test('nothing turned down leaves the journey alone', () => {
  const doc = { cover: {}, video: null, blocks: [] };
  assert.equal(dropRejected(doc, { videoReject: false, photoRejects: [] }, new Set()), 0);
  assert.equal(doc.rejected, undefined);
});
