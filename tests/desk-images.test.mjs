import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareDeskImage, DESK_IMAGE_LIMIT } from '../lib/deskImages.js';

const large = new File([new Uint8Array(DESK_IMAGE_LIMIT + 1)], 'holiday.jpg', { type: 'image/jpeg' });
test('images at the limit keep their original bytes and format', async () => {
  const file = new File([new Uint8Array(DESK_IMAGE_LIMIT)], 'picture.png', { type: 'image/png' });
  assert.equal(await prepareDeskImage(file), file);
});

test('large photos shrink proportionally without upscaling and close decoded resources', async () => {
  let closed = false;
  const result = await prepareDeskImage(large, {
    decode: async () => ({ width: 6000, height: 4000, close: () => { closed = true; } }),
    encode: async (image, width, height, quality) => {
      assert.equal(width, 2560); assert.equal(height, 1707); assert.equal(quality, .86);
      return new Blob(['compressed'], { type: 'image/webp' });
    },
  });
  assert.equal(result.name, 'holiday.webp'); assert.equal(result.type, 'image/webp');
  assert.ok(result.size < large.size); assert.equal(closed, true);
});

test('compression falls back to smaller dimensions when quality alone is insufficient', async () => {
  const calls = [];
  const result = await prepareDeskImage(large, {
    decode: async () => ({ width: 2000, height: 1000 }),
    encode: async (image, width, height, quality) => {
      calls.push([width, height, quality]);
      return new Blob([new Uint8Array(width === 2000 ? 3 * 1048576 : 1048576)], { type: 'image/png' });
    },
  });
  assert.deepEqual(calls, [[2000, 1000, .86], [2000, 1000, .74], [1500, 750, .86]]);
  assert.equal(result.type, 'image/png'); assert.equal(result.name, 'holiday.png');
});

test('failed encoding reports an error and releases the decoded image', async () => {
  let closed = false;
  await assert.rejects(prepareDeskImage(large, {
    decode: async () => ({ width: 2000, height: 1000, close: () => { closed = true; } }),
    encode: async () => null,
  }), /reduced below 6 MB/);
  assert.equal(closed, true);
});

test('large animations are not silently flattened', async () => {
  await assert.rejects(prepareDeskImage(new File([large], 'animation.gif', { type: 'image/gif' })), /Animated pictures/);
  for (const [type, offset, tag] of [['image/png', 12, 'acTL'], ['image/webp', 12, 'ANIM']]) {
    const bytes = new Uint8Array(DESK_IMAGE_LIMIT + 1);
    bytes.set(new TextEncoder().encode(tag), offset);
    await assert.rejects(prepareDeskImage(new File([bytes], 'animated', { type })), /Animated pictures/);
  }
});

test('unsupported formats and oversized originals fail before decoding', async () => {
  await assert.rejects(prepareDeskImage(new File(['svg'], 'image.svg', { type: 'image/svg+xml' })), /JPG, PNG/);
  await assert.rejects(prepareDeskImage({ type: 'image/jpeg', size: 31 * 1048576 }), /under 30 MB/);
});
