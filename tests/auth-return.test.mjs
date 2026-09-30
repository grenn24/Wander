import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { authForwardScript, returnPath } from '../lib/authReturn.js';

/** The landing page's inline script run against an address, and where it sent the page. */
function arrive(pathname, { search = '', hash = '' } = {}) {
  const sent = [];
  const location = { pathname, search, hash, replace: (to) => sent.push(to) };
  vm.runInNewContext(authForwardScript(), { window: { location } });
  return sent;
}

test('a sign-in comes back to the page it started from', () => {
  assert.equal(returnPath('/trips', ''), '/trips');
  assert.equal(returnPath('/join/ABC123', ''), '/join/ABC123');
  assert.equal(returnPath('/plan', '?q=3+days+in+Kyoto'), '/plan?q=3+days+in+Kyoto');
});

test('the landing page is never where a sign-in comes back to', () => {
  assert.equal(returnPath('/', ''), '/trips');
  assert.equal(returnPath('/', '?utm_source=x'), '/trips');
  assert.equal(returnPath('', ''), '/trips');
  assert.equal(returnPath(undefined, undefined), '/trips');
});

test('somebody who lands on the landing page with a fresh session is sent to their trips', () => {
  // What a confirmation email with no address in it leads to.
  const hash = '#access_token=a.b.c&expires_in=3600&refresh_token=r&token_type=bearer&type=signup';
  assert.deepEqual(arrive('/', { hash }), [`/trips${hash}`]);
  // Kept, so the trips page can still read the session out of it.
  assert.deepEqual(arrive('/', { search: '?x=1', hash }), [`/trips?x=1${hash}`]);
  // Google returns the token second when it also brings a provider token.
  const later = '#provider_token=p&access_token=a.b.c&refresh_token=r';
  assert.deepEqual(arrive('/', { hash: later }), [`/trips${later}`]);
});

test('an ordinary visit, an in-page link, or a failed link stays on the landing page', () => {
  assert.deepEqual(arrive('/'), []);
  assert.deepEqual(arrive('/', { hash: '#features' }), []);
  assert.deepEqual(arrive('/', { hash: '#top' }), []);
  assert.deepEqual(arrive('/', { hash: '#error=access_denied&error_code=otp_expired' }), []);
  // A look-alike parameter is not a token.
  assert.deepEqual(arrive('/', { hash: '#not_access_token=1' }), []);
});

test('only the landing page forwards', () => {
  const hash = '#access_token=a.b.c&refresh_token=r';
  assert.deepEqual(arrive('/trips', { hash }), []);
  assert.deepEqual(arrive('/join/ABC123', { hash }), []);
});
