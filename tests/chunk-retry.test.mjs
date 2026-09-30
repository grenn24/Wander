import test from 'node:test';
import assert from 'node:assert/strict';
import { isChunkError, retryImport, reloadOnce } from '../lib/chunkRetry.js';

const chunkFailure = () => Object.assign(new Error('Loading chunk 5077 failed.'), { name: 'ChunkLoadError' });

test('a failed chunk is told apart from a bug in the code', () => {
  assert.equal(isChunkError(chunkFailure()), true);
  assert.equal(isChunkError(new Error('Loading chunk 12 failed.\n(error: https://x/y.js)')), true);
  assert.equal(isChunkError(new Error('Loading CSS chunk 9 failed.')), true);
  assert.equal(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://x/y.js')), true);
  assert.equal(isChunkError(new Error('error loading dynamically imported module')), true);
  assert.equal(isChunkError(new Error('Importing a module script failed.')), true);
  assert.equal(isChunkError(new TypeError("Cannot read properties of undefined (reading 'map')")), false);
  assert.equal(isChunkError(null), false);
  assert.equal(isChunkError(undefined), false);
});

test('an import that fails once is asked for again', async () => {
  let calls = 0;
  const module = { default: 'Globe' };
  const got = await retryImport(async () => {
    calls++;
    if (calls < 3) throw chunkFailure();
    return module;
  }, { wait: 0 });
  assert.equal(got, module);
  assert.equal(calls, 3);
});

test('an import that keeps failing gives up with the chunk error', async () => {
  let calls = 0;
  await assert.rejects(
    retryImport(async () => { calls++; throw chunkFailure(); }, { retries: 2, wait: 0 }),
    (e) => e.name === 'ChunkLoadError',
  );
  assert.equal(calls, 3);
});

test('a bug in the module is thrown at once, not retried', async () => {
  let calls = 0;
  await assert.rejects(
    retryImport(async () => { calls++; throw new ReferenceError('nope is not defined'); }, { wait: 0 }),
    ReferenceError,
  );
  assert.equal(calls, 1);
});

test('a page reloads once for a failed chunk, and not again straight after', () => {
  const store = new Map();
  let reloads = 0;
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  globalThis.window = { location: { reload: () => { reloads++; } } };
  try {
    assert.equal(reloadOnce(1_000_000), true);
    assert.equal(reloads, 1);
    assert.equal(reloadOnce(1_010_000), false, 'ten seconds later is still the same failure');
    assert.equal(reloads, 1);
    assert.equal(reloadOnce(1_040_000), true, 'long enough later is a new failure');
    assert.equal(reloads, 2);
  } finally {
    delete globalThis.sessionStorage;
    delete globalThis.window;
  }
});

test('a page that cannot remember reloading does not reload', () => {
  let reloads = 0;
  globalThis.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => {} };
  globalThis.window = { location: { reload: () => { reloads++; } } };
  try {
    assert.equal(reloadOnce(1), false);
    assert.equal(reloads, 0);
  } finally {
    delete globalThis.sessionStorage;
    delete globalThis.window;
  }
});
