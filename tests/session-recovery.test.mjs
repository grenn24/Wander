import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSession, readWithSessionRecovery } from '../lib/sessionRecovery.js';

const session = (token = 'old', id = 'traveller') => ({ access_token: token, user: { id } });
const result = (s) => ({ data: { session: s }, error: null });
const expired = { code: 'PGRST301', message: 'JWT expired' };
const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

function clientFixture() {
  let current = session();
  const calls = { get: 0, refresh: 0, unsubscribed: 0 };
  let callback;
  const client = { auth: {
    async getSession() { calls.get++; return result(current); },
    async refreshSession() { calls.refresh++; current = session('new'); return result(current); },
    onAuthStateChange(fn) {
      callback = fn;
      return { data: { subscription: { unsubscribe() { calls.unsubscribed++; } } } };
    },
  } };
  return { client, calls, emit: (...args) => callback(...args), set: (s) => { current = s; } };
}

test('expired trip read refreshes once and returns the replayed read', async () => {
  const { client, calls } = clientFixture();
  let reads = 0;
  const actual = await readWithSessionRecovery(client, async () =>
    ++reads === 1 ? { error: expired } : { data: ['trip'], error: null });
  assert.deepEqual(actual.data, ['trip']);
  assert.equal(reads, 2);
  assert.equal(calls.refresh, 1);
});

test('an expired child query replays the entire read bundle', async () => {
  const { client } = clientFixture();
  let reads = 0;
  const actual = await readWithSessionRecovery(client, async () =>
    ++reads === 1 ? [{ data: 'trip' }, { error: expired }] : [{ data: 'trip' }, { data: 'stops' }]);
  assert.equal(reads, 2);
  assert.equal(actual[1].data, 'stops');
});

test('simultaneous rejected reads share one refresh', async () => {
  const { client, calls } = clientFixture();
  const makeRead = () => {
    let count = 0;
    return () => Promise.resolve(++count === 1 ? { error: expired } : { data: 'ok' });
  };
  await Promise.all([readWithSessionRecovery(client, makeRead()), readWithSessionRecovery(client, makeRead())]);
  assert.equal(calls.refresh, 1);
});

test('a token already renewed by the SDK is reused', async () => {
  const { client, calls, set } = clientFixture();
  let reads = 0;
  await readWithSessionRecovery(client, async () => {
    set(session('sdk-refreshed'));
    return ++reads === 1 ? { error: expired } : { data: 'ok' };
  });
  assert.equal(reads, 2);
  assert.equal(calls.refresh, 0);
});

test('persistent JWT rejection stops after one retry', async () => {
  const { client, calls } = clientFixture();
  let reads = 0;
  const actual = await readWithSessionRecovery(client, async () => { reads++; return { error: expired }; });
  assert.equal(actual.error, expired);
  assert.equal(reads, 2);
  assert.equal(calls.refresh, 1);
});

test('permission and network errors do not trigger token refresh', async () => {
  for (const error of [{ code: '42501', message: 'permission denied' }, new Error('Failed to fetch')]) {
    const { client, calls } = clientFixture();
    let reads = 0;
    const actual = await readWithSessionRecovery(client, async () => { reads++; return { error }; });
    assert.equal(actual.error, error);
    assert.equal(reads, 1);
    assert.equal(calls.refresh, 0);
  }
});

test('a failed session check never falls through to anonymous data reads', async () => {
  const { client } = clientFixture();
  client.auth.getSession = async () => ({ data: { session: null }, error: new Error('Failed to fetch') });
  let reads = 0;
  await assert.rejects(readWithSessionRecovery(client, async () => { reads++; }), /Failed to fetch/);
  assert.equal(reads, 0);
});

test('an account switch during recovery prevents replay', async () => {
  const { client, set } = clientFixture();
  let reads = 0;
  await assert.rejects(readWithSessionRecovery(client, async () => {
    reads++;
    set(session('other-token', 'other-person'));
    return { error: expired };
  }), /account changed/);
  assert.equal(reads, 1);
});

test('initial restore error stays recoverable and is not reported as sign-out', async () => {
  const fixture = clientFixture();
  let offline = true;
  fixture.client.auth.getSession = async () => offline
    ? { data: { session: null }, error: new Error('Failed to fetch') } : result(session());
  const sessions = [], errors = [];
  const observer = observeSession(fixture.client, { onSession: (s) => sessions.push(s), onError: (e) => errors.push(e) });
  fixture.emit('INITIAL_SESSION', null);
  await observer.recover();
  assert.equal(errors.length, 1);
  assert.equal(sessions.length, 0);
  offline = false;
  await observer.recover();
  assert.equal(sessions[0].user.id, 'traveller');
  observer.dispose();
});

test('mobile visibility, bfcache return and reconnect restore and coalesce sessions', async () => {
  const { client, calls } = clientFixture();
  const win = new EventTarget(), doc = new EventTarget();
  doc.visibilityState = 'visible';
  let recoveries = 0;
  const observer = observeSession(client, {
    onSession() {}, onError: assert.fail, onRecovered: () => recoveries++, windowTarget: win, documentTarget: doc,
  });
  await observer.recover();
  doc.visibilityState = 'hidden';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls.get, 1);
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  win.dispatchEvent(new Event('pageshow'));
  win.dispatchEvent(new Event('focus'));
  await observer.recover();
  assert.equal(calls.get, 2);
  win.dispatchEvent(new Event('online'));
  await observer.recover();
  assert.equal(calls.get, 3);
  assert.equal(recoveries, 3);
  observer.dispose();
  win.dispatchEvent(new Event('focus'));
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(calls.get, 3);
  assert.equal(calls.unsubscribed, 1);
});

test('sign-out beats an older pending restore; auth consumers run outside the SDK callback', async () => {
  const fixture = clientFixture(), waiting = deferred();
  const sessions = [];
  fixture.client.auth.getSession = () => waiting.promise;
  const observer = observeSession(fixture.client, { onSession: (s) => sessions.push(s), onError: assert.fail });
  fixture.emit('SIGNED_OUT', null);
  assert.equal(sessions.length, 0);
  waiting.resolve(result(session()));
  await observer.recover();
  await tick();
  assert.deepEqual(sessions, [null]);
  observer.dispose();
});

test('refresh events do not schedule repeated failed-view retries', async () => {
  const fixture = clientFixture();
  let recoveries = 0;
  const observer = observeSession(fixture.client, {
    onSession() {}, onError: assert.fail, onRecovered: () => recoveries++,
  });
  await observer.recover();
  fixture.emit('TOKEN_REFRESHED', session('new'));
  await tick();
  assert.equal(recoveries, 1);
  observer.dispose();
});

test('disposal ignores late restore responses', async () => {
  const { client } = clientFixture(), waiting = deferred();
  client.auth.getSession = () => waiting.promise;
  const observer = observeSession(client, { onSession: assert.fail, onError: assert.fail, onRecovered: assert.fail });
  observer.dispose();
  waiting.resolve(result(session()));
  await tick();
});

test('a session that has actually ended asks for sign-in and does not read trips', async () => {
  const { client, set } = clientFixture();
  set(null);
  const sessions = [];
  const observer = observeSession(client, { onSession: (s) => sessions.push(s), onError: assert.fail });
  await observer.recover();
  assert.deepEqual(sessions, [null]);
  await assert.rejects(readWithSessionRecovery(client, assert.fail), /sign in/);
  observer.dispose();
});

test('a failed refresh is surfaced without replaying the read', async () => {
  const { client } = clientFixture();
  client.auth.refreshSession = async () => ({ data: { session: null }, error: new Error('Refresh token expired') });
  let reads = 0;
  await assert.rejects(readWithSessionRecovery(client, async () => { reads++; return { error: expired }; }), /Refresh token expired/);
  assert.equal(reads, 1);
});
