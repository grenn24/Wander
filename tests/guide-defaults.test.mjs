import test from 'node:test';
import assert from 'node:assert/strict';
import { GUIDES } from '../lib/guides.js';
import { fromV1 } from '../lib/guideFormat.js';
import { defaultDocs, mediaOf, withMedia } from '../lib/guideDefaults.js';

const photoBlocks = (doc) => doc.blocks.filter((b) => b.type === 'photo');

test('the default guides ship with their photographs and a video', () => {
  const docs = defaultDocs();
  assert.equal(docs.length, GUIDES.length);
  for (const d of docs) {
    assert.ok(d.cover.photo && d.cover.photo.raw, `${d.slug} has a cover`);
    for (const b of photoBlocks(d)) {
      assert.ok((b.photos || []).length >= (b.layout === 'pair' ? 2 : 1), `${d.slug}: "${b.query}"`);
    }
    assert.match((d.video && d.video.id) || '', /^[\w-]{11}$/, `${d.slug} has a video`);
  }
});

test('kept media goes back only where its search is unchanged', () => {
  const photo = (id) => ({ provider: 'unsplash', id, raw: `https://images.unsplash.com/${id}` });
  const doc = fromV1(GUIDES[0]);
  doc.cover.photo = photo('c');
  photoBlocks(doc)[0].photos = [photo('a')];
  photoBlocks(doc)[1].photos = [photo('b')];
  doc.video = { provider: 'youtube', id: 'abcdefghijk', title: 'A walk' };
  doc.rejected = ['old'];
  const kept = JSON.parse(JSON.stringify(mediaOf(doc)));

  const edited = fromV1(GUIDES[0]);
  photoBlocks(edited)[1].query = 'somewhere else entirely';
  withMedia(edited, kept);
  assert.equal(edited.cover.photo.id, 'c');
  assert.deepEqual(photoBlocks(edited)[0].photos.map((p) => p.id), ['a']);
  assert.deepEqual(photoBlocks(edited)[1].photos || [], []);
  assert.equal(edited.video.id, 'abcdefghijk');
  assert.deepEqual(edited.rejected, ['old']);

  assert.equal(withMedia(fromV1(GUIDES[0]), undefined).cover.photo || null, null);
});
