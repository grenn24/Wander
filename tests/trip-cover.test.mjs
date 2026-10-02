import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_LIBRARY_MAX, coverCaption, coverFileURL, coverKind, coverPathFor, coverPhoto, coverSlides, coverURL,
  coversFrom, heroCoverURL, removeAllCovers,
} from '../lib/tripCover.js';

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

test('the trip page draws its cover wide, and drops one that would not load', () => {
  const own = { cover_path: `${TRIP}/abc123.webp` };
  const url = `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/abc123.webp`;
  assert.equal(heroCoverURL(own, '', 1200, HOST), url);
  // A borrowed place photograph is asked for at the page's width, not a thumbnail's.
  assert.equal(
    heroCoverURL({ cover_ref: 'places/ChIJ/photos/AV' }, '', 1200, HOST),
    '/api/places/photo?ref=places%2FChIJ%2Fphotos%2FAV&w=1200',
  );
  // Once that address has failed the plain heading is drawn instead...
  assert.equal(heroCoverURL(own, url, 1200, HOST), null);
  // ...but a different cover, chosen since, is tried afresh.
  assert.equal(
    heroCoverURL({ cover_path: `${TRIP}/other.webp` }, url, 1200, HOST),
    `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/other.webp`,
  );
  assert.equal(heroCoverURL({}, '', 1200, HOST), null);
});

test('the image viewer is given the cover as a file or as a Google reference', () => {
  const url = `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/abc123.webp`;
  // Its own picture first, exactly as coverURL prefers it.
  assert.deepEqual(coverPhoto({ cover_path: `${TRIP}/abc123.webp`, cover_ref: 'places/ChIJ/photos/AV' }, HOST), { url });
  // A borrowed photograph is a reference: the viewer asks for the size it wants.
  assert.deepEqual(coverPhoto({ cover_ref: 'places/ChIJ/photos/AV' }, HOST), { ref: 'places/ChIJ/photos/AV' });
  // Nothing that is not ours or Google's is ever handed to it.
  assert.equal(coverPhoto({ cover_path: '../../etc/passwd' }, HOST), null);
  assert.equal(coverPhoto({ cover_ref: 'https://example.com/evil.png' }, HOST), null);
  assert.equal(coverPhoto({}, HOST), null);
  assert.equal(coverPhoto(null, HOST), null);
});

test('a borrowed photograph is asked for wide enough for the trip page unless told otherwise', () => {
  assert.equal(
    heroCoverURL({ cover_ref: 'places/ChIJ/photos/AV' }, '', undefined, HOST),
    '/api/places/photo?ref=places%2FChIJ%2Fphotos%2FAV&w=1920',
  );
});

test('a cover says how it was made in its name, and older ones say nothing', () => {
  const drawn = coverPathFor(TRIP, 'webp', 'drawn');
  const uploaded = coverPathFor(TRIP, 'png', 'upload');
  assert.match(drawn, new RegExp(`^${TRIP}/drawn-[0-9a-f-]{36}\\.webp$`));
  assert.match(uploaded, new RegExp(`^${TRIP}/upload-[0-9a-f-]{36}\\.png$`));
  assert.equal(coverKind(drawn), 'drawn');
  assert.equal(coverKind(uploaded), 'upload');
  assert.equal(coverKind(`${TRIP}/0b8f6c1e-aaaa-bbbb-cccc-123456789abc.webp`), '');
  assert.equal(coverKind(null), '');
  // Still a path the bucket will serve.
  assert.ok(coverFileURL(drawn, HOST) && coverFileURL(uploaded, HOST));
});

test('a trip\'s covers are the pictures in its folder, newest first', () => {
  const entries = [
    { name: '.emptyFolderPlaceholder', created_at: '2026-09-01T00:00:00Z' },
    { name: 'upload-a.webp', created_at: '2026-09-10T10:00:00Z' },
    { name: 'drawn-b.webp', created_at: '2026-09-12T10:00:00Z' },
    { name: 'old-c.jpg', created_at: '2026-09-11T10:00:00Z' },
    { name: 'notes.txt', created_at: '2026-09-13T10:00:00Z' },
    { name: 'up load.webp', created_at: '2026-09-14T10:00:00Z' }, // not a name the route serves
  ];
  const covers = coversFrom(TRIP, entries, null, HOST);
  assert.deepEqual(covers.map((c) => c.path), [`${TRIP}/drawn-b.webp`, `${TRIP}/old-c.jpg`, `${TRIP}/upload-a.webp`]);
  assert.deepEqual(covers.map((c) => c.kind), ['drawn', '', 'upload']);
  assert.equal(covers[0].url, `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/drawn-b.webp`);
  assert.deepEqual(coversFrom(TRIP, null, null, HOST), []);
});

test('the cover showing is always in the list, and never one from another trip', () => {
  const entries = [{ name: 'upload-a.webp', created_at: '2026-09-10T10:00:00Z' }];
  const showing = `${TRIP}/drawn-z.webp`;
  assert.deepEqual(coversFrom(TRIP, entries, showing, HOST).map((c) => c.path), [showing, `${TRIP}/upload-a.webp`]);
  // Listed already: not twice.
  assert.equal(coversFrom(TRIP, entries, `${TRIP}/upload-a.webp`, HOST).length, 1);
  // A path in someone else's folder, or one that is no path, is not the list's to add.
  assert.equal(coversFrom(TRIP, entries, '99999999-2222-3333-4444-555555555555/x.webp', HOST).length, 1);
  assert.equal(coversFrom(TRIP, entries, '../../etc/passwd', HOST).length, 1);
});

test('a trip has room for a dozen covers', () => {
  assert.equal(COVER_LIBRARY_MAX, 12);
});

test('deleting a trip clears every cover it kept, and the one showing even if the folder cannot be read', async () => {
  const removed = [];
  const client = (list) => ({
    storage: { from: () => ({ list, remove: async (paths) => { removed.push(...paths); return { data: paths, error: null }; } }) },
  });
  await removeAllCovers(client(async () => ({ data: [{ name: 'a.webp' }, { name: 'drawn-b.webp' }], error: null })), TRIP, `${TRIP}/a.webp`);
  assert.deepEqual(removed.splice(0), [`${TRIP}/a.webp`, `${TRIP}/drawn-b.webp`]);

  await removeAllCovers(client(async () => ({ data: null, error: new Error('down') })), TRIP, `${TRIP}/a.webp`);
  assert.deepEqual(removed.splice(0), [`${TRIP}/a.webp`]);

  // A trip that never had one has nothing to remove and does not ask to.
  await removeAllCovers(client(async () => ({ data: [], error: null })), TRIP, null);
  assert.deepEqual(removed, []);
});

test('the viewer steps through every cover the trip has, and knows which is the default', () => {
  const file = (name, at) => ({ path: `${TRIP}/${name}`, url: `${HOST}/storage/v1/object/public/trip-covers/${TRIP}/${name}`, kind: coverKind(name), at });
  const covers = [file('drawn-b.webp', '2026-09-12T10:00:00Z'), file('upload-a.webp', '2026-09-10T10:00:00Z'), file('old.webp', null)];
  const trip = { id: TRIP, cover_path: `${TRIP}/upload-a.webp`, cover_ref: 'places/ChIJ/photos/AV' };

  const slides = coverSlides(trip, covers, HOST);
  assert.deepEqual(slides.map((s) => s.path), covers.map((c) => c.path));
  assert.deepEqual(slides.map((s) => s.isDefault), [false, true, false]);
  // A file of its own wins over the Google photograph, which then is not offered at all.
  assert.equal(slides.some((s) => s.ref), false);
});

test('a Google photograph standing in as the cover leads the list as the default', () => {
  const covers = [{ path: `${TRIP}/drawn-b.webp`, url: `${HOST}/x/drawn-b.webp`, kind: 'drawn', at: '2026-09-12T10:00:00Z' }];
  const slides = coverSlides({ id: TRIP, cover_path: null, cover_ref: 'places/ChIJ/photos/AV' }, covers, HOST);
  assert.equal(slides.length, 2);
  assert.deepEqual({ ref: slides[0].ref, kind: slides[0].kind, isDefault: slides[0].isDefault }, { ref: 'places/ChIJ/photos/AV', kind: 'place', isDefault: true });
  assert.equal(slides[1].isDefault, false);
  // No cover showing at all: nothing is the default, and a stranger's reference is never offered.
  assert.deepEqual(coverSlides({ id: TRIP }, covers, HOST).map((s) => s.isDefault), [false]);
  assert.equal(coverSlides({ id: TRIP, cover_ref: 'https://example.com/evil.png' }, [], HOST).length, 0);
  assert.deepEqual(coverSlides(null, null, HOST), []);
});

test('a cover is captioned with its number and how it came to be', () => {
  assert.equal(coverCaption({ kind: 'drawn' }, 1, 9, '30 Sep'), 'Cover 2 of 9 · drawn 30 Sep');
  assert.equal(coverCaption({ kind: 'upload' }, 0, 3, '28 Sep'), 'Cover 1 of 3 · uploaded 28 Sep');
  // Older covers have no kind and perhaps no date; neither is invented.
  assert.equal(coverCaption({ kind: '' }, 2, 3, ''), 'Cover 3 of 3 · added');
  assert.equal(coverCaption({ kind: 'place' }, 0, 4, '30 Sep'), 'Cover 1 of 4 · Google photo');
});
