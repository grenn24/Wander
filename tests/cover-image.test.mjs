import test from 'node:test';
import assert from 'node:assert/strict';
import { COVER_WIDEST, prepareCover } from '../lib/coverImage.js';

const file = (type, size) => ({ type, size });
const runtime = (width, height) => ({
  decode: async () => ({ width, height }),
  encode: async (image, w, h, quality) => ({ type: 'image/webp', size: w * h, drawn: [w, h], quality }),
});

test('a photograph from a phone is redrawn to a width a cover is shown at', async () => {
  const { blob, extension, type } = await prepareCover(file('image/jpeg', 8 * 1024 * 1024), runtime(4032, 3024));
  assert.deepEqual(blob.drawn, [COVER_WIDEST, 1200]);
  assert.equal(extension, 'webp');
  assert.equal(type, 'image/webp');
});

test('a picture already small is left at its own size', async () => {
  const { blob } = await prepareCover(file('image/png', 120 * 1024), runtime(900, 600));
  assert.deepEqual(blob.drawn, [900, 600]);
});

test('only pictures, and nothing enormous', async () => {
  await assert.rejects(prepareCover(file('application/pdf', 1000), runtime(10, 10)), /JPG, PNG or WebP/);
  await assert.rejects(prepareCover(file('image/jpeg', 40 * 1024 * 1024), runtime(10, 10)), /under 30 MB/);
  await assert.rejects(prepareCover(null, runtime(10, 10)), /JPG, PNG or WebP/);
  // A picture the browser cannot open says so rather than uploading nothing.
  await assert.rejects(
    prepareCover(file('image/jpeg', 1000), { decode: async () => { throw new Error('nope'); } }),
    /could not be opened/,
  );
});
