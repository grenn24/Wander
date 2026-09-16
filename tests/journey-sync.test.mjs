import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPayload } from '../scripts/journeys/db.mjs';

test('a journey travels to production by slug, without local ids or errors', () => {
  const row = {
    id: 'a-local-uuid',
    slug: 'kyoto-blossom',
    status: 'published',
    source: 'generated',
    brief: 'Kyoto in blossom season',
    doc: { slug: 'kyoto-blossom', title: 'Kyoto and Nara at First Light' },
    summary: { slug: 'kyoto-blossom', title: 'Kyoto and Nara at First Light' },
    review: { verdict: 'publish', score: 8 },
    version: 11,
    attempts: 3,
    checked_at: '2026-09-15T03:54:06.463Z',
    published_at: '2026-08-01T00:00:00.000Z',
    last_error: 'a failure from a local run',
  };
  const out = syncPayload(row);
  assert.equal(out.id, undefined, 'the local id stays local');
  assert.equal(out.attempts, undefined);
  assert.equal(out.last_error, null, 'a local failure means nothing in production');
  assert.equal(out.slug, 'kyoto-blossom');
  assert.equal(out.version, 11);
  assert.deepEqual(out.doc, row.doc);
  assert.deepEqual(out.review, row.review);
  assert.equal(out.checked_at, row.checked_at);
  assert.equal(out.published_at, row.published_at);
  assert.match(out.updated_at, /^\d{4}-\d{2}-\d{2}T/);

  // A journey saved before summaries were kept still arrives with one.
  const old = syncPayload({ ...row, summary: null, doc: { ...row.doc, place: 'Kyoto', country: 'Japan', months: { best: [4] }, days: [5, 7], blocks: [], places: [] } });
  assert.equal(old.summary.slug, 'kyoto-blossom');
});
