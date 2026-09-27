import test from 'node:test';
import assert from 'node:assert/strict';
import { dropRejected, rejectedOf, rewriteBrief, carry } from '../scripts/guides/pipeline.mjs';

test('a revision keeps the guide’s address and what was already found for it', () => {
  const prev = {
    slug: 'kyoto-blossom', videoQuery: 'Kyoto travel', video: { id: 'main0000001' }, cover: { query: 'Kyoto', photo: { id: 'c' } },
    places: [{ id: 'p1', q: 'Nanzen-ji, Kyoto', place_id: 'ChIJ1', lat: 35, lng: 135 }],
    blocks: [{ type: 'video', query: 'Philosophers Path walk', video: { id: 'clip0000001' } }],
  };
  const next = carry(prev, {
    slug: 'kyoto-nara-first-light', videoQuery: 'Kyoto travel', cover: { query: 'Kyoto' },
    places: [{ id: 'p1', q: 'Nanzen-ji, Kyoto' }],
    blocks: [{ type: 'video', query: 'Philosophers Path walk' }],
  });
  assert.equal(next.slug, 'kyoto-blossom');
  assert.equal(next.places[0].place_id, 'ChIJ1');
  assert.equal(next.video.id, 'main0000001');
  assert.equal(next.cover.photo.id, 'c');
  assert.equal(next.blocks[0].video.id, 'clip0000001');
});

test('a rewrite keeps the destination, season and length, and offers the old places', () => {
  const brief = rewriteBrief({
    title: 'The Sacred Valley and Machu Picchu', place: 'Cusco & the Sacred Valley', country: 'Peru',
    months: { best: [5, 6, 9] }, days: [7, 10], pace: 'Steady', teaser: 'Market towns in the valley.',
    places: [{ name: 'Pisac' }, { name: 'Moray' }],
  });
  assert.match(brief, /^Cusco & the Sacred Valley, Peru; at its best in May, June, September; 7 to 10 days; steady pace\. Market towns in the valley\./);
  assert.match(brief, /replaces Wander's guide "The Sacred Valley and Machu Picchu"/);
  assert.match(brief, /places, to keep, replace or add to: Pisac; Moray\.$/);
  assert.match(rewriteBrief({ title: 'Iceland', place: 'Iceland', country: 'Iceland', days: [8, 8] }), /^Iceland; 8 days\./);
});

test('turned-down media is removed and remembered with the guide', () => {
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

test('nothing turned down leaves the guide alone', () => {
  const doc = { cover: {}, video: null, blocks: [] };
  assert.equal(dropRejected(doc, { videoReject: false, photoRejects: [] }, new Set()), 0);
  assert.equal(doc.rejected, undefined);
});
