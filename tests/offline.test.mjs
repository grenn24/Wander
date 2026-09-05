import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { tripSnapshot } from '../public/offline-store.js';

test('downloads retain travel essentials without account, sharing, calendar or Google image tokens', () => {
  const snapshot = tripSnapshot('user', { id: 'trip', name: 'Tokyo', notes: 'Hotel code', share_code: 'secret' }, [{
    id: 'a', title: 'Flight', booking_ref: 'ABC123', location: 'Haneda', notes: 'Terminal 3',
    details: { arrival_timezone: 'Asia/Tokyo' }, photo_ref: 'token', google_event_id: 'event',
  }], [{ label: 'Passport', packed: false }]);
  assert.equal(snapshot.activities[0].booking_ref, 'ABC123');
  assert.equal(snapshot.trip.notes, 'Hotel code');
  assert.equal(snapshot.activities[0].details.arrival_timezone, 'Asia/Tokyo');
  assert.equal('share_code' in snapshot.trip, false);
  assert.equal('photo_ref' in snapshot.activities[0], false);
  assert.equal('google_event_id' in snapshot.activities[0], false);
});
test('service worker serves downloaded reader on failed navigation and never intercepts private APIs', async () => {
  const handlers = {};
  const cached = new Map();
  const shell = { offline: true };
  const context = { URL, Promise,
    self: { location: { origin: 'https://wander.test' }, addEventListener: (name, fn) => { handlers[name] = fn; }, skipWaiting: async () => {}, clients: { claim: async () => {} } },
    caches: { open: async () => ({ addAll: async (paths) => paths.forEach((p) => cached.set(p, shell)), match: async (p) => cached.get(p) }), keys: async () => [] },
    fetch: async () => { throw new Error('offline'); },
  };
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), context);
  let installing;
  handlers.install({ waitUntil: (promise) => { installing = promise; } });
  await installing;
  assert.ok(cached.has('/offline.html'));
  assert.ok(cached.has('/trip-time.js'));
  let response;
  handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://wander.test/trips/test' }, respondWith: (p) => { response = p; } });
  assert.equal(await response, shell);
  for (const [method, url] of [['GET', 'https://wander.test/api/places/photo'], ['POST', 'https://wander.test/api/plan'], ['GET', 'https://db.supabase.co/rest/v1/trips']]) {
    handlers.fetch({ request: { method, mode: 'cors', url }, respondWith: () => assert.fail('Private data must not be cached') });
  }
});
