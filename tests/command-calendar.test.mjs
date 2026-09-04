import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calendarRange, overlapsTrip, readCommandCalendar, calendarContext, explicitlyNeedsCalendar } from '../lib/commandCalendar.js';

const trip = { start_date: '2026-11-26', end_date: '2026-12-03' };
const hotel = { id: 'event-id', iCalUID: 'booking-id', summary: 'Hotel confirmation',
  description: '<p>Shenzhen Bay Hotel. Booking ABC123. Check in 15:00, check out 11:00.</p>',
  location: 'Full hotel address', start: { date: '2026-11-25' }, end: { date: '2026-12-04' } };
const primary = { id: 'primary', primary: true, summary: 'Personal' };

test('lookup waits, follows pagination and finds a booking beyond the first forty entries on another selected calendar', async () => {
  const requests = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let settled = false;
  const promise = readCommandCalendar(async (path) => {
    requests.push(path);
    if (path.startsWith('/users')) return { items: [primary, { id: 'travel@calendar', selected: true, summary: 'Travel' }, { id: 'hidden', selected: false }] };
    if (path.includes('/primary/')) return { items: Array.from({ length: 45 }, (_, i) => ({
      id: `meeting-${i}`, summary: `Meeting ${i}`, start: { date: '2026-11-26' }, end: { date: '2026-11-27' },
    })) };
    if (!path.includes('pageToken=')) return { items: [], nextPageToken: 'second-page' };
    await gate;
    return { items: [hotel] };
  }, trip).then((result) => { settled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  const result = await promise;
  assert.equal(result.length, 46);
  assert.ok(requests.some((p) => p.includes('travel%40calendar')));
  assert.ok(requests.some((p) => p.includes('pageToken=second-page')));
  assert.ok(!requests.some((p) => p.includes('/hidden/')));
  const booking = result.find((e) => e.title === hotel.summary);
  assert.equal(booking.end, '2026-12-04');
  assert.equal(booking.where, hotel.location);
  assert.match(booking.details, /Shenzhen Bay Hotel.*ABC123/);
  assert.equal(booking.calendar, 'Travel');
  assert.equal(booking.id, undefined);
  assert.match(calendarContext(result), /ABC123/);
});

test('same booking in multiple calendars is deduplicated; exported and cancelled events are excluded', async () => {
  const result = await readCommandCalendar(async (path) => path.startsWith('/users')
    ? { items: [primary, { id: 'secondary', selected: true }] }
    : { items: [hotel, { ...hotel, id: 'cancelled', status: 'cancelled' },
      { ...hotel, id: 'export', extendedProperties: { private: { wanderTrip: 'trip-id' } } }] }, trip);
  assert.equal(result.length, 1);
});

test('overlapping stays are included; exclusive checkout and timezone edges are respected', () => {
  const range = calendarRange(trip);
  assert.equal(overlapsTrip(hotel, range), true);
  assert.equal(overlapsTrip({ ...hotel, end: { date: '2026-11-26' } }, range), false);
  assert.equal(overlapsTrip({ ...hotel, start: { date: '2026-12-04' } }, range), false);
  const early = { start: { dateTime: '2026-11-26T00:30:00+14:00' }, end: { dateTime: '2026-11-26T01:00:00+14:00' } };
  assert.equal(overlapsTrip(early, range), true);
  assert.ok(Date.parse(range.timeMin) < Date.parse(early.start.dateTime));
});

test('invalid and excessive date ranges fail before any calendar request', async () => {
  for (const input of [{}, { start_date: '2026-02-30', end_date: '2026-03-03' },
    { start_date: '2026-12-03', end_date: '2026-11-26' }, { start_date: '2026-01-01', end_date: '2026-12-01' }]) {
    await assert.rejects(readCommandCalendar(() => assert.fail('must not fetch'), input), { code: 'calendar_range' });
  }
});

test('empty calendar, reconnect and partial failure remain distinct', async () => {
  const empty = await readCommandCalendar(async (path) => ({ items: path.startsWith('/users') ? [primary] : [] }), trip);
  assert.match(calendarContext(empty), /No entries overlap/);
  assert.match(calendarContext([], 'not connected or expired'), /could not be read/);
  assert.doesNotMatch(calendarContext([], 'unavailable'), /No entries overlap/);
  await assert.rejects(readCommandCalendar(async (path) => {
    if (path.startsWith('/users')) return { items: [primary, { id: 'second', selected: true }] };
    if (path.includes('/primary/')) return { items: [hotel] };
    throw Object.assign(new Error('Reconnect'), { code: 'reconnect' });
  }, trip), { code: 'reconnect' });
});

test('lookup budget errors never return a silently truncated calendar', async () => {
  await assert.rejects(readCommandCalendar(async (path) => path.startsWith('/users')
    ? { items: [primary] } : { items: [], nextPageToken: 'endless' }, trip), { code: 'calendar_limit' });
  await assert.rejects(readCommandCalendar(async (path) => path.startsWith('/users')
    ? { items: [primary] } : { items: Array.from({ length: 251 }, (_, i) => ({ ...hotel, id: `${i}`, iCalUID: `${i}` })) }, trip), { code: 'calendar_limit' });
});

test('calendar intent carries through follow-ups while ordinary edits remain possible', () => {
  assert.equal(explicitlyNeedsCalendar('Add my hotel stay, u can check my calendar'), true);
  assert.equal(explicitlyNeedsCalendar('Add my hotel', ['Use my calendar']), true);
  assert.equal(explicitlyNeedsCalendar('Move dinner to 7pm'), false);
});

test('command authenticates and awaits calendar before AI, with no client diary or forty-event truncation', () => {
  const route = readFileSync(new URL('../app/api/command/route.js', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../components/Command.jsx', import.meta.url), 'utf8');
  assert.ok(route.indexOf('await userFromRequest(req)') < route.indexOf('await commandCalendar(user.id, trip)'));
  assert.ok(route.indexOf('await commandCalendar(user.id, trip)') < route.indexOf('await askJson('));
  assert.doesNotMatch(route, /body\.calendar/);
  assert.doesNotMatch(client, /useCommitments|Object\.values\(booked\)/);
  assert.match(client, /Authorization: `Bearer \$\{token\}`/);
  assert.match(route, /If one booking clearly matches, propose adding it without asking/);
});
