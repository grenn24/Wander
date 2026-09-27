import test from 'node:test';
import assert from 'node:assert/strict';
import { coverFileURL, coverPathFor, coverURL } from '../lib/tripCover.js';

const HOST = 'https://db.example.supabase.co';
const TRIP = '11111111-2222-3333-4444-555555555555';

test('a trip draws its own picture before the place photograph it was given', () => {
  const own = { cover_path: `${TRIP}/abc123.webp`, cover_ref: 'places/ChIJ/photos/AV' };
  assert.equal(coverURL(own, 400, HOST), `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/abc123.webp`);
  const borrowed = { cover_ref: 'places/ChIJ/photos/AV' };
  assert.equal(coverURL(borrowed, 88, HOST), '/api/places/photo?ref=places%2FChIJ%2Fphotos%2FAV&w=88');
  // Nothing to draw: the list shows its placeholder.
  assert.equal(coverURL({}, 400, HOST), null);
  assert.equal(coverURL(null, 400, HOST), null);
});

test('only a path inside the bucket is served, and only a Google reference is fetched', () => {
  assert.equal(coverFileURL('../../etc/passwd', HOST), null);
  assert.equal(coverFileURL('https://example.com/evil.png', HOST), null);
  assert.equal(coverFileURL(`${TRIP}/ok.webp`, ''), null); // no server to serve it
  assert.equal(coverURL({ cover_ref: 'https://example.com/evil.png' }, 400, HOST), null);
});

test('a new cover is a random name under its trip', () => {
  const path = coverPathFor(TRIP);
  assert.match(path, new RegExp(`^${TRIP}/[0-9a-f-]{36}\\.webp$`));
  assert.notEqual(coverPathFor(TRIP), path);
  assert.ok(coverFileURL(path, HOST));
});
