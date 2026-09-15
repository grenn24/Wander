import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRejected, rejectedOf, rewriteBrief } from '../scripts/journeys/pipeline.mjs';

test('a rewrite keeps the destination, season and length, and offers the old places', () => {
  const brief = rewriteBrief({
    title: 'The Sacred Valley and Machu Picchu', place: 'Cusco & the Sacred Valley', country: 'Peru',
    months: { best: [5, 6, 9] }, days: [7, 10], pace: 'Steady', teaser: 'Market towns in the valley.',
    places: [{ name: 'Pisac' }, { name: 'Moray' }],
  });
  assert.match(brief, /^Cusco & the Sacred Valley, Peru; at its best in May, June, September; 7 to 10 days; steady pace\. Market towns in the valley\./);
  assert.match(brief, /replaces Wander's journey "The Sacred Valley and Machu Picchu"/);
  assert.match(brief, /places, to keep, replace or add to: Pisac; Moray\.$/);
  assert.match(rewriteBrief({ title: 'Iceland', place: 'Iceland', country: 'Iceland', days: [8, 8] }), /^Iceland; 8 days\./);
});

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

test('a turned-down section video is removed without touching the others', () => {
  const doc = {
    cover: {},
    video: { id: 'main0000001' },
    blocks: [
      { type: 'video', query: 'Calf Creek hike', video: { id: 'clip0000001' } },
      { type: 'prose' },
      { type: 'video', query: 'Burr Trail drive', video: { id: 'clip0000002' } },
    ],
  };
  const rejected = new Set();
  assert.equal(dropRejected(doc, { videoRejects: [2, 1], photoRejects: [] }, rejected), 1);
  assert.equal(doc.blocks[2].video, null);
  assert.equal(doc.blocks[0].video.id, 'clip0000001');
  assert.equal(doc.video.id, 'main0000001');
  assert.equal(dropRejected(doc, { videoRejects: [-1], photoRejects: [] }, rejected), 1);
  assert.equal(doc.video, null);
  assert.deepEqual([...rejectedOf(doc)].sort(), ['clip0000002', 'main0000001']);
});

test('nothing turned down leaves the journey alone', () => {
  const doc = { cover: {}, video: null, blocks: [] };
  assert.equal(dropRejected(doc, { videoReject: false, photoRejects: [] }, new Set()), 0);
  assert.equal(doc.rejected, undefined);
});
