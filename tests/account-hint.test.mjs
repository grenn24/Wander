import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { accountHintScript, authStorageKey } from '../lib/accountHint.js';

const URL_LOCAL = 'http://127.0.0.1:56321';
const KEY = 'sb-127-auth-token';

/** A page with a stored value (or none) under the local key, then the script run on it. */
function browser({ stored, blocked = false, url = URL_LOCAL } = {}) {
  const attrs = {};
  const style = {};
  const root = {
    setAttribute(name, value) { attrs[name] = value; },
    removeAttribute(name) { delete attrs[name]; },
    style: {
      setProperty(name, value) { style[name] = value; },
      removeProperty(name) { delete style[name]; },
    },
  };
  const key = authStorageKey(url);
  const run = () => vm.runInNewContext(accountHintScript(url), {
    document: { documentElement: root },
    window: {
      localStorage: {
        getItem(name) {
          if (blocked) throw new Error('blocked');
          return name === key && stored !== undefined ? stored : null;
        },
      },
    },
  });
  run();
  return { attrs, style, run };
}

const session = (user, extra = {}) => JSON.stringify({
  access_token: 'a.b.c', refresh_token: 'r', expires_at: 1, user, ...extra,
});

test('the key is the first label of the API host, as supabase-js derives it', () => {
  assert.equal(authStorageKey('http://127.0.0.1:56321'), 'sb-127-auth-token');
  assert.equal(authStorageKey('http://localhost:54321'), 'sb-localhost-auth-token');
  assert.equal(authStorageKey('https://abcdwxyz.supabase.co'), 'sb-abcdwxyz-auth-token');
  assert.equal(authStorageKey('not a url'), '');
  assert.equal(accountHintScript(''), '');
});

test('a stored session marks the page signed in before anything has loaded', () => {
  const page = browser({ stored: session({ email: 'mei.tan@example.com' }) });
  assert.equal(page.attrs['data-account'], 'in');
  assert.equal(page.style['--account-initials'], '"MT"');
});

test('with no session, or storage that cannot be read, the page stays signed out', () => {
  for (const opts of [{}, { blocked: true }, { stored: 'not json' }, { stored: '{}' }, { stored: 'null' }]) {
    const page = browser(opts);
    assert.equal(page.attrs['data-account'], undefined);
    assert.equal(page.style['--account-initials'], undefined);
  }
});

test('a session the SDK would refuse to use does not count', () => {
  const page = browser({ stored: JSON.stringify({ access_token: 'a', user: { email: 'x@y.z' } }) });
  assert.equal(page.attrs['data-account'], undefined);
});

test('the name comes from the profile before the address, and the address before nothing', () => {
  const initials = (user) => browser({ stored: session(user) }).style['--account-initials'];
  assert.equal(initials({ user_metadata: { display_name: 'Sam Lee', full_name: 'Other Person' } }), '"SL"');
  assert.equal(initials({ user_metadata: { full_name: 'Ana Costa' } }), '"AC"');
  assert.equal(initials({ user_metadata: { name: 'Priya' } }), '"PR"');
  assert.equal(initials({ email: 'travel_e2e@wander.test' }), '"TE"');
  assert.equal(initials({}), '"TR"'); // Traveller
});

test('initials are whole characters and safe to print inside a CSS string', () => {
  const initials = (name) => browser({ stored: session({ user_metadata: { display_name: name } }) })
    .style['--account-initials'];
  assert.equal(initials('😀 Smith'), '"😀S"');
  assert.equal(initials('Élodie'), '"ÉL"');
  assert.equal(initials('"Bo" \\Ng'), '"\\"\\\\"'); // quote and backslash escaped
});

test('running it again follows the stored session out, as sign-out removes it', () => {
  const page = browser({ stored: session({ email: 'a@b.c' }) });
  assert.equal(page.attrs['data-account'], 'in');
  const signedOut = browser({});
  signedOut.attrs['data-account'] = 'in';
  signedOut.style['--account-initials'] = '"AB"';
  signedOut.run();
  assert.equal(signedOut.attrs['data-account'], undefined);
  assert.equal(signedOut.style['--account-initials'], undefined);
});

/** The functions themselves, on a page whose globals are ours. */
async function withPage(stored, run) {
  const attrs = {};
  const events = [];
  const saved = { document: globalThis.document, window: globalThis.window, Event: globalThis.Event };
  globalThis.document = { documentElement: {
    setAttribute(n, v) { attrs[n] = v; }, removeAttribute(n) { delete attrs[n]; },
    style: { setProperty() {}, removeProperty() {} },
  } };
  globalThis.window = {
    localStorage: { getItem: () => stored },
    dispatchEvent: (e) => events.push(e.type),
  };
  globalThis.Event = class { constructor(type) { this.type = type; } };
  try { return await run({ attrs, events }); }
  finally { Object.assign(globalThis, saved); }
}

test('a session that is being signed out is treated as gone, whatever storage still says', async () => {
  const lib = await import('../lib/accountHint.js');
  const stored = session({ email: 'a@b.c' }, { refresh_token: 'old-token' });
  await withPage(stored, ({ attrs }) => {
    assert.equal(lib.installAccountHint(KEY, 'old-token'), null);
    assert.equal(attrs['data-account'], undefined);
    // Any other token is somebody signing in afterwards, and counts.
    assert.equal(lib.installAccountHint(KEY, 'some-other-token').name, 'a');
    assert.equal(attrs['data-account'], 'in');
    // And nothing marked means storage is believed, as it is in the inline script.
    assert.equal(lib.installAccountHint(KEY, undefined).name, 'a');
  });
});

// The mark is module state, so each test gets its own copy of the module.
let copies = 0;
const fresh = () => import(`../lib/accountHint.js?copy=${++copies}`);

test('marking a sign-out remembers that session by its refresh token', async () => {
  const lib = await fresh();
  await withPage(session({ email: 'a@b.c' }, { refresh_token: 'token-1' }), () => {
    assert.equal(lib.signingOutToken(), null);
    lib.markSigningOut(URL_LOCAL);
    assert.equal(lib.signingOutToken(), 'token-1');
  });
});

test('a sign-in after a sign-out is a different session, and is believed', async () => {
  const lib = await fresh();
  await withPage(session({ email: 'a@b.c' }, { refresh_token: 'token-1' }), () => lib.markSigningOut(URL_LOCAL));
  // Later, storage holds a new session. Nothing was reset, and nothing needs to be.
  await withPage(session({ email: 'a@b.c' }, { refresh_token: 'token-2' }), ({ attrs }) => {
    assert.equal(lib.installAccountHint(KEY, lib.signingOutToken()).name, 'a');
    assert.equal(attrs['data-account'], 'in');
  });
  // While it is still the first one, it is gone.
  await withPage(session({ email: 'a@b.c' }, { refresh_token: 'token-1' }), ({ attrs }) => {
    assert.equal(lib.installAccountHint(KEY, lib.signingOutToken()), null);
    assert.equal(attrs['data-account'], undefined);
  });
});

test('marking a sign-out with nothing stored, or storage that cannot be read, is harmless', async () => {
  for (const stored of [null, 'not json', '{}']) {
    const lib = await fresh();
    await withPage(stored, () => { lib.markSigningOut(URL_LOCAL); assert.equal(lib.signingOutToken(), null); });
  }
  // No window at all (the server): still no throw.
  const lib = await fresh();
  const window = globalThis.window;
  delete globalThis.window;
  try { assert.doesNotThrow(() => lib.markSigningOut(URL_LOCAL)); assert.equal(lib.signingOutToken(), null); }
  finally { if (window) globalThis.window = window; }
});
