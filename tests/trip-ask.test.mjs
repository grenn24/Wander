import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUrlTransform } from 'react-markdown';
import {
  stopTokens, stopFor, stopHref, STOP_HREF, parseMapSpec, cleanSourceUrl, isCitation, sourceSite,
  tripContext, askSuggestions, askGreetings, tidyCitations,
} from '../lib/tripAsk.js';

test('a citation loses the brackets around it', () => {
  const a = (href, text) => ({ type: 'element', tagName: 'a', properties: { href }, children: [{ type: 'text', value: text }] });
  const p = {
    type: 'element',
    tagName: 'p',
    children: [
      { type: 'text', value: 'Open daily (' },
      a('https://www.tnm.jp/x', 'tnm.jp'),
      { type: 'text', value: '). See (' },
      a('https://www.tnm.jp/x', 'the museum'),
      { type: 'text', value: ') too.' },
    ],
  };
  tidyCitations()({ type: 'root', children: [p] });
  assert.equal(p.children[0].value, 'Open daily ');
  assert.equal(p.children[2].value, '. See (', 'an ordinary link keeps its brackets');
  assert.equal(p.children[4].value, ') too.');
});

const A = (id, extra = {}) => ({
  id, day: '2026-12-13', title: 'Stop', category: 'sightseeing', cost: 0, sort_order: 0, ...extra,
});

test('stop tokens are short, stable prefixes that grow only to stay unique', () => {
  const acts = [
    A('3f9a2c11-0000-4000-8000-000000000001'),
    A('77aa0011-0000-4000-8000-000000000002'),
    A('77aa0099-0000-4000-8000-000000000003'),
  ];
  const token = stopTokens(acts);
  assert.equal(token(acts[0]), '3f9a2c');
  // The two sharing "77aa00" each get two more characters.
  assert.equal(token(acts[1]), '77aa0011');
  assert.equal(token(acts[2]), '77aa0099');
  assert.equal(stopFor(acts, '77aa0099').id, acts[2].id);
  assert.equal(stopFor(acts, '3F9A2C').id, acts[0].id);
  assert.equal(stopFor(acts, 'abc'), null, 'too short to trust');
  assert.equal(stopFor(acts, 'ffffff'), null, 'a stop since deleted');
});

test('stop links survive react-markdown\'s URL check', () => {
  const href = stopHref('3f9a2c');
  // A custom scheme would be emptied here; a fragment is kept as written.
  assert.equal(defaultUrlTransform(href), href);
  assert.equal(defaultUrlTransform('stop:3f9a2c'), '');
  assert.match(href, STOP_HREF);
  assert.equal(href.match(STOP_HREF)[1], '3f9a2c');
  assert.equal('#stop-xyz'.match(STOP_HREF), null);
});

test('a map block is read defensively, never with coordinates', () => {
  const spec = parseMapSpec(JSON.stringify({
    title: 'Sunday around Ueno',
    places: [
      { stop: '3f9a2c' },
      { stop: '#stop-77aa00' },
      { name: 'Tokyo National Museum', near: 'Ueno, Tokyo', note: 'Closed Mondays', lat: 1, lng: 2 },
      { name: 'tokyo national museum', near: 'again' },
      { stop: '3f9a2c' },
      { stop: 'not-a-token' },
      null,
    ],
  }));
  assert.deepEqual(spec, {
    title: 'Sunday around Ueno',
    places: [
      { stop: '3f9a2c', note: '' },
      { stop: '77aa00', note: '' },
      { name: 'Tokyo National Museum', near: 'Ueno, Tokyo', note: 'Closed Mondays' },
    ],
  });
  // Half a block, as it is while the answer streams.
  assert.equal(parseMapSpec('{"title": "Sunday", "places": [{"stop": "3f9'), null);
  assert.equal(parseMapSpec('{"places": []}'), null);
  assert.equal(parseMapSpec('not json'), null);
  const many = parseMapSpec(JSON.stringify({ places: Array.from({ length: 20 }, (_, i) => ({ name: `Place ${i}` })) }));
  assert.equal(many.places.length, 10);
});

test('sources lose the search tracking tag and read as their site', () => {
  assert.equal(cleanSourceUrl('https://www.tnm.jp/page?id=1&utm_source=openai'), 'https://www.tnm.jp/page?id=1');
  assert.equal(cleanSourceUrl('javascript:alert(1)'), '');
  assert.equal(cleanSourceUrl('nonsense'), '');
  assert.equal(sourceSite('https://www.tnm.jp/x'), 'tnm.jp');
  assert.ok(isCitation('tnm.jp', 'https://www.tnm.jp/modules/page'));
  assert.ok(isCitation('japan-guide.com', 'https://www.japan-guide.com/e/e3002.html'));
  assert.ok(!isCitation('the museum site', 'https://www.tnm.jp/'));
  assert.ok(!isCitation('example.org', 'https://www.tnm.jp/'));
});

test('the trip context carries the plan, the time there, and no emails', () => {
  const trip = {
    name: 'Tokyo, December 2026', destination: 'Tokyo', start_date: '2026-12-12', end_date: '2026-12-14',
    currency: 'JPY', budget: 300000, timezone: 'Asia/Tokyo', notes: '<p>Bring the <b>JR</b> passes</p>',
  };
  const acts = [
    A('3f9a2c11-0000-4000-8000-000000000001', {
      title: 'Lunch at Ameyoko Market', category: 'food', start_time: '12:30:00', end_time: '13:30:00',
      location: 'Taito City, Tokyo', lat: 35.71, lng: 139.77, cost: 2500, notes: 'Cash only',
    }),
    A('77aa0011-0000-4000-8000-000000000002', {
      day: '2026-12-14', title: 'Tokyo DisneySea', start_time: '09:00:00', details: { check_in_time: '09:00', _cache: 'x', nested: { a: 1 } },
    }),
  ];
  const text = tripContext({
    trip,
    activities: acts,
    packing: [{ label: 'Umbrella', qty: 1, packed: true }, { label: 'Socks', qty: 4, packed: false }],
    members: [{ user_id: 'u1', display_name: 'Di Heng', email: 'someone@example.com' }],
    now: new Date('2026-11-21T13:00:00Z'),
  });
  assert.match(text, /Trip: Tokyo, December 2026/);
  assert.match(text, /Dates: Sat 12 Dec 2026 to Mon 14 Dec 2026 \(3 days\)/);
  assert.match(text, /Now at the destination \(Asia\/Tokyo\): Sat 21 Nov 2026, 22:00, 21 days before the trip starts\./);
  assert.match(text, /Day 1, Sat 12 Dec 2026: nothing planned/);
  assert.match(text, /- \[3f9a2c\] 12:30–13:30, Lunch at Ameyoko Market \(food\) · Taito City, Tokyo · JPY 2,500 · located · notes: Cash only/);
  assert.match(text, /\[77aa00\] 09:00, Tokyo DisneySea \(sightseeing\) · check in time: 09:00$/m);
  assert.match(text, /Packing list: 2 items, 1 packed\./);
  assert.match(text, /Socks ×4/);
  assert.match(text, /Bring the JR passes/);
  assert.match(text, /Travellers: 1 \(Di Heng\)/);
  assert.doesNotMatch(text, /example\.com/);
  assert.doesNotMatch(text, /3f9a2c11-0000/, 'no full ids');
  assert.doesNotMatch(text, /_cache|nested/);
});

test('suggestions fit the trip', () => {
  const trip = { destination: 'Tokyo', start_date: '2026-12-12', end_date: '2026-12-24' };
  const acts = [A('a1', { day: '2026-12-13' }), A('a2', { day: '2026-12-13' }), A('a3', { day: '2026-12-14' })];
  const list = askSuggestions(trip, acts, '2026-11-21');
  assert.deepEqual(list, ['Map out day 2', 'Weather in Tokyo in Dec', 'What to book ahead', 'Any gaps or clashes?']);
  assert.equal(askSuggestions(trip, acts, '2026-12-15')[2], 'Open late near us');
  assert.equal(askSuggestions(trip, acts, '2026-12-30')[2], 'Sum up the trip');
  assert.equal(askSuggestions({ ...trip, destination: 'Tokyo, Japan' }, [], '2026-11-21')[0], 'What to see in Tokyo');
});

test('the blank page greets in a few ways, all short', () => {
  const trip = { destination: 'Tokyo, Japan', start_date: '2026-12-12', end_date: '2026-12-24' };
  const before = askGreetings(trip, '2026-11-21');
  assert.ok(before.includes('Ask anything about the trip'));
  assert.ok(before.includes('Ask anything about Tokyo'));
  assert.ok(before.includes('Anything to check before Tokyo?'));
  assert.ok(askGreetings(trip, '2026-12-15').includes('What do you need today?'));
  assert.deepEqual(askGreetings({}, ''), ['Ask anything about the trip', 'What would you like to know?']);
  for (const line of before) assert.ok(line.length <= 40, line);
});
