import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { staticMapOptions, staticMapURL } from '../lib/staticMap.js';
const options = (query) => staticMapOptions(new URLSearchParams(query));

test('static preview requires valid finite coordinates, including zero', () => {
  assert.ok(options('lat=0&lng=0'));
  for (const q of ['lat=&lng=0', 'lat=91&lng=0', 'lat=0&lng=-181', 'lat=NaN&lng=0', 'lng=0']) {
    assert.equal(options(q), null);
  }
});
test('static map endpoint supports labelled satellite and bounded dimensions', () => {
  const url = staticMapURL(options('lat=22.54&lng=114.11&type=hybrid&compact=1'), 'test-key');
  assert.equal(url.hostname, 'maps.googleapis.com');
  assert.equal(url.pathname, '/maps/api/staticmap');
  assert.equal(url.searchParams.get('maptype'), 'hybrid');
  assert.equal(url.searchParams.get('size'), '640x320');
  assert.equal(url.searchParams.get('scale'), '2');
  assert.equal(url.searchParams.has('markers'), false);
});
test('activity preview always requests light road maps independently of saved preferences', () => {
  const source = readFileSync(new URL('../components/StaticActivityMap.jsx', import.meta.url), 'utf8');
  assert.match(source, /type: 'roadmap', theme: 'light'/);
  assert.doesNotMatch(source, /useMapPreferences|useMapScheme|mapColorScheme/);
  const url = staticMapURL(options('lat=22.54&lng=114.11&type=roadmap&theme=light'), 'test-key');
  assert.equal(url.searchParams.get('maptype'), 'roadmap');
  assert.equal(url.searchParams.has('style'), false);
});
test('only confirmed coordinates receive a marker', () => {
  const url = staticMapURL(options('lat=22.54&lng=114.11&pin=1&color=aabbcc'), 'test-key');
  assert.equal(url.searchParams.get('markers'), 'color:0xaabbcc|label:1|22.54,114.11');
  assert.equal(url.searchParams.get('zoom'), '15');
});
test('legacy unlabelled static requests also resolve to labelled satellite', () => {
  const url = staticMapURL(options('lat=0&lng=0&type=satellite'), 'test-key');
  assert.equal(url.searchParams.get('maptype'), 'hybrid');
});
test('dark road/terrain styles do not alter satellite imagery', () => {
  for (const type of ['roadmap', 'terrain', 'hybrid', 'satellite']) {
    const url = staticMapURL(options(`lat=0&lng=0&type=${type}&theme=dark`), 'test-key');
    assert.equal(url.searchParams.has('style'), ['roadmap', 'terrain'].includes(type));
  }
});
test('caller cannot inject URLs, markers, sizes or styles', () => {
  const url = staticMapURL(options('lat=0&lng=0&type=bad&color=red%7C0,0&size=9999x9999&url=https://example.com&style=bad'), 'test-key');
  assert.equal(url.searchParams.get('size'), '640x640');
  assert.equal(url.searchParams.get('maptype'), 'roadmap');
  assert.equal(url.searchParams.has('url'), false);
  assert.equal(url.searchParams.has('style'), false);
});
test('only expanded activity maps mount GoogleMap; failures do not auto-load it', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  assert.match(read('components/ActivityMap.jsx'), /!expanded \? <StaticActivityMap/);
  assert.match(read('components/ActivityMap.jsx'), /title=\{draft.title\} \/> : <GoogleMap/);
  assert.doesNotMatch(read('components/StaticActivityMap.jsx'), /<GoogleMap/);
  assert.match(read('components/StaticActivityMap.jsx'), /URL.revokeObjectURL/);
  assert.match(read('app/api/maps/static/route.js'), /if \(!user\) return notSignedIn/);
  assert.match(read('app/api/maps/static/route.js'), /private, no-store/);
  assert.match(read('app/globals.css'), /\.amap-static img[^}]*object-fit: contain/);
});

test('a preview cannot spin forever', () => {
  const source = readFileSync(new URL('../components/StaticActivityMap.jsx', import.meta.url), 'utf8');
  // The token the app already holds comes first; the SDK's lock is only asked
  // after a rejection, and then with a time limit.
  assert.match(source, /const \{ supabase, session \} = useApp\(\)/);
  assert.match(source, /within\(supabase\.auth\.getSession\(\), SESSION_PATIENCE\)/);
  // The whole attempt has a deadline that turns into the failure state.
  assert.match(source, /setTimeout\(\(\) => controller\.abort\(\), PATIENCE\)/);
  assert.match(source, /if \(!gone\) setResult\(\{ query, error: true \}\)/);
  // And the failure offers another go, above the overlay that opens the map.
  assert.match(source, /setAttempt\(\(n\) => n \+ 1\)/);
  assert.match(readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8'),
    /\.amap-static-retry \{ position: relative; z-index: 3; \}/);
});
