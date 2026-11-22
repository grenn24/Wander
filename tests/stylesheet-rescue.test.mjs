import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { stylesheetRescueScript, RELOADED_KEY, RELOAD_WINDOW_MS } from '../lib/chunkRetry.js';

const ORIGIN = 'https://wander.example';

/**
 * A <link rel="stylesheet"> that loaded (a sheet with rules) or failed: Firefox
 * leaves no sheet, Chrome (`empty`) leaves one with no rules.
 */
function link(path, { loaded = true, empty = false } = {}) {
  let sheet = null;
  if (loaded) sheet = { cssRules: { length: 12 } };
  else if (empty) sheet = { cssRules: { length: 0 } };
  return {
    tagName: 'LINK',
    rel: 'stylesheet',
    href: path.startsWith('http') ? path : ORIGIN + path,
    sheet,
    parentNode: null,
    addEventListener() {},
    cloneNode() { return link(this.href, { loaded: false }); },
  };
}

/**
 * The script run on a page whose <head> holds these stylesheets. Timers do not
 * fire until the test says so; the error listener is the one the page would
 * call when a later stylesheet fails.
 */
function page(links, { store = new Map(), online = true, now = 1_000_000, statuses = {} } = {}) {
  const fetched = [];
  const head = {
    children: [...links],
    replaceChild(fresh, old) {
      const i = this.children.indexOf(old);
      assert.notEqual(i, -1, 'replaced a stylesheet that is in the page');
      this.children[i] = fresh;
      fresh.parentNode = this;
      old.parentNode = null;
      fetched.push(fresh);
    },
  };
  links.forEach((l) => { l.parentNode = head; });
  const timers = [];
  const listeners = {};
  let reloads = 0;
  const context = {
    URL,
    Map,
    Date: { now: () => now },
    location: { href: `${ORIGIN}/trips/1/itinerary`, origin: ORIGIN, reload: () => { reloads++; } },
    navigator: { onLine: online },
    performance: {
      getEntriesByName: (href) => {
        const path = new URL(href).pathname;
        return path in statuses ? [{ responseStatus: statuses[path] }] : [];
      },
    },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    setTimeout: (fn, ms) => timers.push({ fn, ms }),
    document: { querySelectorAll: () => [...head.children] },
    window: {
      addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    },
  };
  vm.runInNewContext(stylesheetRescueScript, context);
  return {
    head,
    timers,
    store,
    get reloads() { return reloads; },
    /** Fire the waiting timers, then report each stylesheet they fetched again as failed again. */
    failAgain() {
      const due = timers.splice(0);
      due.forEach((t) => t.fn());
      fetched.splice(0).forEach((l) => {
        (listeners.error || []).forEach((fn) => fn({ target: l }));
      });
      return due.map((t) => t.ms);
    },
    error(target) { (listeners.error || []).forEach((fn) => fn({ target })); },
    online() {
      context.navigator.onLine = true;
      (listeners.online || []).splice(0).forEach((fn) => fn());
    },
  };
}

test('a page whose stylesheets all loaded is left alone', () => {
  const p = page([link('/_next/static/css/a.css'), link('/_next/static/css/b.css')]);
  assert.equal(p.timers.length, 0);
  assert.equal(p.reloads, 0);
  assert.equal(p.store.size, 0, 'nothing written to sessionStorage');
});

test('a failed stylesheet is fetched again in its own place', () => {
  const a = link('/_next/static/css/a.css');
  const b = link('/_next/static/css/b.css', { loaded: false });
  const c = link('/_next/static/css/c.css');
  const p = page([a, b, c]);
  assert.equal(p.timers.length, 1);
  assert.equal(p.timers[0].ms, 500, 'after a moment, not at once');
  p.timers[0].fn();
  assert.equal(p.head.children[0], a);
  assert.notEqual(p.head.children[1], b, 'a fresh element, which the browser will fetch');
  assert.equal(p.head.children[1].href, b.href, 'from the same address');
  assert.equal(p.head.children[2], c, 'and in the same place in the cascade');
  assert.equal(p.reloads, 0);
});

test('Chrome\'s empty sheet for a stylesheet that failed counts as failed', () => {
  const p = page([
    link('/_next/static/css/a.css'),
    link('/_next/static/css/b.css', { loaded: false, empty: true }),
  ], { statuses: { '/_next/static/css/a.css': 200, '/_next/static/css/b.css': 400 } });
  assert.equal(p.timers.length, 1);
});

test('an empty stylesheet that did arrive is left alone', () => {
  const p = page([link('/_next/static/css/a.css', { loaded: false, empty: true })], {
    statuses: { '/_next/static/css/a.css': 200 },
  });
  assert.equal(p.timers.length, 0);
  assert.equal(p.reloads, 0);
});

test('a failure found by the check and then heard as an error is one failure', () => {
  const b = link('/_next/static/css/b.css', { loaded: false });
  const p = page([b]);
  p.error(b); // the browser dispatched its error event late
  assert.equal(p.timers.length, 1);
  const waits = [];
  for (let i = 0; i < 4; i++) waits.push(...p.failAgain());
  assert.deepEqual(waits, [500, 1000, 2000, 4000], 'no attempt lost to the echo');
});

test('one that keeps failing is tried four times, waiting longer each time, then the page reloads once', () => {
  const p = page([link('/_next/static/css/a.css', { loaded: false })]);
  const waits = [];
  for (let i = 0; i < 4; i++) waits.push(...p.failAgain());
  assert.deepEqual(waits, [500, 1000, 2000, 4000]);
  assert.equal(p.reloads, 1);
  assert.equal(p.store.get(RELOADED_KEY), String(1_000_000));
});

test('it does not reload again straight after a reload, from either cause', () => {
  const store = new Map([[RELOADED_KEY, String(1_000_000 - RELOAD_WINDOW_MS + 1)]]);
  const p = page([link('/_next/static/css/a.css', { loaded: false })], { store });
  for (let i = 0; i < 5; i++) p.failAgain();
  assert.equal(p.reloads, 0, 'the last reload, perhaps for a chunk, was moments ago');
});

test('a page that cannot remember reloading does not reload', () => {
  const p = page([link('/_next/static/css/a.css', { loaded: false })], {
    store: { has: () => { throw new Error('blocked'); }, get: () => null, set: () => {} },
  });
  for (let i = 0; i < 5; i++) p.failAgain();
  assert.equal(p.reloads, 0);
});

test('offline, it waits for the connection before reloading', () => {
  const p = page([link('/_next/static/css/a.css', { loaded: false })], { online: false });
  for (let i = 0; i < 5; i++) p.failAgain();
  assert.equal(p.reloads, 0);
  p.online();
  assert.equal(p.reloads, 1);
});

test('stylesheets that are not the app\'s own are not its business', () => {
  const p = page([
    link('https://fonts.example.com/css/a.css', { loaded: false }),
    link('/somewhere/else.css', { loaded: false }),
    link('chrome-extension://abc/inject.css', { loaded: false }),
  ]);
  assert.equal(p.timers.length, 0);
  assert.equal(p.reloads, 0);
});

test('a stylesheet added later that fails is caught too', () => {
  const p = page([link('/_next/static/css/a.css')]);
  const later = link('/_next/static/css/route.css', { loaded: false });
  later.parentNode = p.head;
  p.head.children.push(later);
  p.error(later);
  assert.equal(p.timers.length, 1);
  p.error({ tagName: 'IMG', src: `${ORIGIN}/x.png` });
  assert.equal(p.timers.length, 1, 'a broken image is not a stylesheet');
});
