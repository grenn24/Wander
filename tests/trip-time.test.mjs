import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarEvent } from '../lib/calendarEvents.js';
import { activityTimes, clockAt, instantAt, offTripClock, tripNow, validZone, zoneOffset } from '../public/trip-time.js';

const activity = { id: 'a', title: 'Breakfast', day: '2026-09-05', start_time: '09:00:00', end_time: '10:00:00' };
test('Tokyo calendar export preserves destination wall time regardless of the planner browser zone', () => {
  const event = calendarEvent(activity, 'Asia/Tokyo', 'trip');
  assert.equal(event.start.dateTime, '2026-09-05T00:00:00.000Z');
  assert.equal(event.start.timeZone, 'Asia/Tokyo');
  assert.equal(clockAt('Asia/Singapore', new Date(event.start.dateTime)).minutes, 480);
  assert.equal(clockAt('Asia/Tokyo', new Date(event.start.dateTime)).minutes, 540);
  assert.throws(() => calendarEvent(activity, null, 'trip'), /destination time zone/);
  assert.equal(validZone('MadeUp/City'), false);
});
test('DST uses the offset on the activity date and rejects nonexistent local times', () => {
  assert.equal(new Date(instantAt('2026-01-10', '09:00', 'America/New_York')).toISOString(), '2026-01-10T14:00:00.000Z');
  assert.equal(new Date(instantAt('2026-07-10', '09:00', 'America/New_York')).toISOString(), '2026-07-10T13:00:00.000Z');
  assert.equal(instantAt('2026-03-08', '02:30', 'America/New_York'), null);
  assert.equal(instantAt('2026-02-30', '09:00', 'UTC'), null);
  assert.equal(instantAt('2026-09-05', '25:00', 'UTC'), null);
});
test('overnight flights and date-line crossings carry separate local dates and zones', () => {
  const flight = { ...activity, category: 'transport', subtype: 'flight', start_time: '23:00', end_time: '07:00',
    details: { departure_timezone: 'Asia/Singapore', arrival_timezone: 'Asia/Tokyo', arrival_date: '2026-09-06' } };
  const event = calendarEvent(flight, 'Asia/Tokyo');
  assert.equal(event.start.dateTime, '2026-09-05T15:00:00.000Z');
  assert.equal(event.end.dateTime, '2026-09-05T22:00:00.000Z');
  assert.equal(event.end.timeZone, 'Asia/Tokyo');
  const west = { ...flight, start_time: '17:00', end_time: '10:00', details: {
    departure_timezone: 'Asia/Tokyo', arrival_timezone: 'America/Los_Angeles', arrival_date: '2026-09-05',
  } };
  assert.equal((activityTimes(west, 'Asia/Tokyo').end - activityTimes(west, 'Asia/Tokyo').start) / 3600000, 9);
  assert.throws(() => activityTimes({ ...flight, details: {} }, 'Asia/Tokyo'), /flight departure/);
  assert.throws(() => activityTimes({ ...flight, details: { ...flight.details, arrival_date: '' } }, 'Asia/Tokyo'), /arrival date/);
});
test('all-day exclusive dates and ordinary overnight events survive calendar export', () => {
  const allDay = calendarEvent({ ...activity, start_time: null }, 'Asia/Tokyo');
  assert.deepEqual(allDay.start, { date: '2026-09-05' });
  assert.deepEqual(allDay.end, { date: '2026-09-06' });
  const overnight = activityTimes({ ...activity, start_time: '23:30', end_time: '01:00' }, 'Asia/Tokyo');
  assert.equal((overnight.end - overnight.start) / 60000, 90);
});
test('Today crosses destination midnight and recognises a flight still in progress', () => {
  const trip = { timezone: 'Asia/Tokyo', start_date: '2026-09-05', end_date: '2026-09-07' };
  assert.equal(tripNow(trip, [activity], new Date('2026-09-05T00:30Z')).now.id, 'a');
  const flight = { ...activity, category: 'transport', subtype: 'flight', start_time: '23:00', end_time: '07:00',
    details: { departure_timezone: 'Asia/Singapore', arrival_timezone: 'Asia/Tokyo', arrival_date: '2026-09-06' } };
  const state = tripNow(trip, [flight], new Date('2026-09-05T19:00Z'));
  assert.equal(state.day, '2026-09-06');
  assert.equal(state.now.id, 'a');
});

test('untimed ends keep an activity current until the next start, including a day without further stops', () => {
  const trip = { timezone: 'Asia/Tokyo', start_date: '2026-09-05', end_date: '2026-09-07' };
  const morning = { ...activity, end_time: null };
  assert.equal(tripNow(trip, [morning], new Date('2026-09-05T03:00Z')).now.id, 'a');
  assert.equal(tripNow(trip, [morning], new Date('2026-09-05T15:00Z')).now, null);
});

test('flight times on another clock are marked by offset, not by zone name', () => {
  const flight = { ...activity, day: '2026-12-12', category: 'transport', subtype: 'flight', start_time: '00:55', end_time: '08:40',
    details: { departure_timezone: 'Asia/Singapore', arrival_timezone: 'Asia/Tokyo', arrival_date: '2026-12-12' } };
  const marks = offTripClock(flight, 'Asia/Tokyo');
  assert.deepEqual(marks.start, { zone: 'Asia/Singapore', place: 'Singapore', label: 'GMT+8', day: '2026-12-12', time: '01:55' });
  assert.equal(marks.end, null);
  // A different zone on the same clock is not worth a mark.
  const kl = { ...flight, details: { ...flight.details, departure_timezone: 'Asia/Kuala_Lumpur' } };
  assert.equal(offTripClock(kl, 'Asia/Singapore').start, null);
  assert.equal(offTripClock(kl, 'Asia/Singapore').end.label, 'GMT+9');
  // Phoenix keeps standard time: Denver's clock in winter, an hour behind it in summer.
  const phx = { ...flight, start_time: '09:00', details: { departure_timezone: 'America/Phoenix' } };
  assert.equal(offTripClock({ ...phx, day: '2026-01-15' }, 'America/Denver').start, null);
  const summer = offTripClock({ ...phx, day: '2026-07-15' }, 'America/Denver').start;
  assert.equal(summer.label, 'GMT-7');
  assert.equal(summer.time, '10:00');
  // Half-hour zones, the trip's date when it differs, and only flights.
  const del = offTripClock({ ...flight, start_time: '23:30', details: { departure_timezone: 'Asia/Kolkata' } }, 'Asia/Tokyo').start;
  assert.equal(del.label, 'GMT+5:30');
  assert.deepEqual([del.day, del.time], ['2026-12-13', '03:00']);
  assert.equal(zoneOffset('America/St_Johns', Date.parse('2026-01-15T12:00Z')), -210);
  assert.deepEqual(offTripClock({ ...flight, subtype: 'train' }, 'Asia/Tokyo'), { start: null, end: null });
  assert.deepEqual(offTripClock(flight, ''), { start: null, end: null });
  assert.equal(offTripClock({ ...flight, details: {} }, 'Asia/Tokyo').start, null);
});
