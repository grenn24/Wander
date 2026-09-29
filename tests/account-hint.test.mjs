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
