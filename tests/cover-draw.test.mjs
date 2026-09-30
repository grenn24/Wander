import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_IMAGE_MODEL, LARGE_COVER_SIZE, SMALL_COVER_SIZE, coverDrawing,
} from '../lib/coverDraw.js';

test('with nothing set, a cover is drawn by the default model at the size it can draw', () => {
  assert.deepEqual(coverDrawing({}), { model: DEFAULT_IMAGE_MODEL, size: SMALL_COVER_SIZE, quality: 'high' });
  assert.deepEqual(coverDrawing(), { model: 'gpt-image-1', size: '1536x1024', quality: 'high' });
  assert.equal(coverDrawing({ model: '', size: '' }).model, 'gpt-image-1');
});

test('the first generation of image models is never asked for more than it draws', () => {
  for (const model of ['gpt-image-1', 'gpt-image-1-mini', ' gpt-image-1 ']) {
    assert.equal(coverDrawing({ model }).size, SMALL_COVER_SIZE, model);
  }
});

test('later models are asked for the larger size, in the same 3:2 shape', () => {
  for (const model of ['gpt-image-2', 'gpt-image-2.5', 'gpt-image-10']) {
    assert.equal(coverDrawing({ model }).size, LARGE_COVER_SIZE, model);
  }
  const [w, h] = LARGE_COVER_SIZE.split('x').map(Number);
  assert.equal(w / h, 1.5);
  // Both edges are multiples of 16, which the newer models require.
  assert.equal(w % 16, 0);
  assert.equal(h % 16, 0);
});

test('a size can be given outright, and a value that is not a size is ignored', () => {
  assert.equal(coverDrawing({ model: 'gpt-image-2', size: '3072x2048' }).size, '3072x2048');
  assert.equal(coverDrawing({ model: 'gpt-image-2', size: ' 2048X1360 ' }).size, '2048x1360');
  assert.equal(coverDrawing({ model: 'gpt-image-2', size: 'huge' }).size, LARGE_COVER_SIZE);
  assert.equal(coverDrawing({ model: 'gpt-image-1', size: '1024; drop' }).size, SMALL_COVER_SIZE);
});

test('the model name is trimmed, and every draw asks for the best quality', () => {
  const drawing = coverDrawing({ model: '  gpt-image-2\n' });
  assert.equal(drawing.model, 'gpt-image-2');
  assert.equal(drawing.quality, 'high');
});

test('quality can be stepped down without a deploy, and a value that is not a quality is ignored', () => {
  for (const quality of ['low', 'medium', 'high', 'auto']) {
    assert.equal(coverDrawing({ model: 'gpt-image-2', quality }).quality, quality);
  }
  assert.equal(coverDrawing({ quality: ' Medium ' }).quality, 'medium');
  for (const quality of ['', 'best', 'hd', undefined, null, 5]) {
    assert.equal(coverDrawing({ quality }).quality, 'high', String(quality));
  }
});
