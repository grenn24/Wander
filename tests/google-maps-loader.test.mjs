import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapsLoader } from '../lib/googleMapsLoader.js';

const libraries = {
  core: { LatLngBounds: class {}, event: {} },
  maps: { Map: class {}, InfoWindow: class {}, Polyline: class {}, Polygon: class {} },
  marker: { AdvancedMarkerElement: class {} },
};

function browser(importLibrary) {
  const scripts = [];
  const win = {
    document: {
      createElement() {
        const listeners = new Map();
        return {
          addEventListener: (type, handler) => listeners.set(type, handler),
          removeEventListener: (type) => listeners.delete(type),
          emit: (type) => listeners.get(type)?.(),
          remove() { this.removed = true; },
        };
      },
      head: { appendChild: (script) => scripts.push(script) },
    },
  };
  if (importLibrary) win.google = { maps: { importLibrary } };
  return { win, scripts };
}

function loaderFor(win, options) {
  return createMapsLoader('test-key', { getWindow: () => win, retryDelayMs: 0, timeoutMs: 1000, ...options });
}

function ready(win, script) {
  win.google = { maps: { importLibrary: async (name) => libraries[name] } };
  win[new URL(script.src).searchParams.get('callback')]();
}

test('waits for the API callback and shares the load across simultaneous mounts', async () => {
  const { win, scripts } = browser();
  const load = loaderFor(win);
  const first = load();
  assert.equal(load(), first);
  assert.equal(scripts.length, 1);
  let settled = false;
  first.then(() => { settled = true; });
  scripts[0].emit('load');
  await Promise.resolve();
  assert.equal(settled, false);
  ready(win, scripts[0]);
  const result = await first;
  assert.equal(result.Map, libraries.maps.Map);
  assert.equal(result.AdvancedMarkerElement, libraries.marker.AdvancedMarkerElement);
  assert.equal(result.LatLngBounds, libraries.core.LatLngBounds);
  assert.equal(result.Polygon, libraries.maps.Polygon);
  assert.equal(load(), first);
});

test('a transient marker failure recovers automatically for every waiting map', async () => {
  let markerCalls = 0;
  const { win, scripts } = browser(async (name) => {
    if (name === 'marker' && ++markerCalls === 1) throw new Error('Could not load marker');
    return libraries[name];
  });
  const load = loaderFor(win);
  const first = load();
  const second = load();
  assert.equal(first, second);
  assert.equal((await first).AdvancedMarkerElement, libraries.marker.AdvancedMarkerElement);
  assert.equal(await second, await first);
  assert.equal(markerCalls, 2);
  assert.equal(scripts.length, 0);
});

test('persistent failure is bounded and reopening retries instead of reusing rejection', async () => {
  let blocked = true;
  let markerCalls = 0;
  const { win } = browser(async (name) => {
    if (name === 'marker') {
      markerCalls += 1;
      if (blocked) throw new Error('Could not load marker');
    }
    return libraries[name];
  });
  const load = loaderFor(win);
  const first = load();
  await assert.rejects(first, /Could not load marker/);
  assert.equal(markerCalls, 2);
  blocked = false;
  const reopened = load();
  assert.notEqual(reopened, first);
  assert.equal((await reopened).Map, libraries.maps.Map);
  assert.equal(markerCalls, 3);
});

test('a failed bootstrap script is removed and a fresh script can succeed', async () => {
  const { win, scripts } = browser();
  const append = win.document.head.appendChild;
  win.document.head.appendChild = (script) => {
    append(script);
    queueMicrotask(() => {
      if (scripts.length === 1) script.emit('error');
      else ready(win, script);
    });
  };
  const result = await loaderFor(win)();
  assert.equal(result.Map, libraries.maps.Map);
  assert.equal(scripts.length, 2);
  assert.equal(scripts[0].removed, true);
  assert.equal(Object.keys(win).some((key) => key.startsWith('__wanderMapsReady')), false);
});

test('a hung marker import times out, then a later retry can succeed', async () => {
  let blocked = true;
  const { win } = browser((name) => (
    blocked && name === 'marker' ? new Promise(() => {}) : Promise.resolve(libraries[name])
  ));
  const load = loaderFor(win, { timeoutMs: 10 });
  await assert.rejects(load(), /too long to load/);
  blocked = false;
  assert.equal((await load()).AdvancedMarkerElement, libraries.marker.AdvancedMarkerElement);
});

test('a bootstrap that never calls back times out and cleans up its scripts', async () => {
  const { win, scripts } = browser();
  await assert.rejects(loaderFor(win, { timeoutMs: 10 })(), /too long to load/);
  assert.equal(scripts.length, 2);
  assert.equal(scripts.every((script) => script.removed), true);
  assert.equal(Object.keys(win).some((key) => key.startsWith('__wanderMapsReady')), false);
});

test('synchronous import errors and missing marker classes are recoverable failures', async () => {
  let calls = 0;
  const { win } = browser((name) => {
    if (++calls === 1) throw new Error('API not ready');
    return Promise.resolve(name === 'marker' ? {} : libraries[name]);
  });
  const load = loaderFor(win);
  await assert.rejects(load(), /map and marker libraries/);
  win.google.maps.importLibrary = async (name) => libraries[name];
  assert.equal((await load()).Map, libraries.maps.Map);
});

test('a server-side call does not poison a later browser load', async () => {
  let win = null;
  const load = loaderFor(null, { getWindow: () => win });
  await assert.rejects(load(), /no window/);
  win = browser(async (name) => libraries[name]).win;
  assert.equal((await load()).Map, libraries.maps.Map);
});
