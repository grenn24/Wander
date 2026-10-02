/*
 * Gives the local test account's trip a few fictional bookings to test against: a lunch, a
 * temple visit and a flight, plus one packing item. LOCAL STACK ONLY — it refuses any other host.
 *
 *   node scripts/e2e/seed-travel-tester.mjs
 *
 * The account's login and the trip's id come from .env.e2e.local (see .env.e2e.example); nothing
 * is printed or written back. It is a one-shot: running it twice adds the bookings twice.
 */
import { createClient } from '@supabase/supabase-js';
import nextEnv from '@next/env';
import { clockAt, nextDate } from '../../public/trip-time.js';

nextEnv.loadEnvConfig(process.cwd());
process.loadEnvFile('.env.e2e.local');

const { NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, E2E_EMAIL, E2E_PASSWORD, E2E_TRIP_ID } = process.env;
if (!E2E_EMAIL || !E2E_PASSWORD || !E2E_TRIP_ID) throw new Error('Fill in .env.e2e.local first (see .env.e2e.example).');
if (!['localhost', '127.0.0.1'].includes(new URL(url).hostname)) throw new Error('Local testing only');

const db = createClient(url, anon, { auth: { persistSession: false } });
const { error: signInError } = await db.auth.signInWithPassword({ email: E2E_EMAIL, password: E2E_PASSWORD });
if (signInError) throw new Error('Could not sign in the local tester: ' + signInError.message);

const day = clockAt('Asia/Tokyo').day;
const at = clockAt('Asia/Tokyo').minutes;
const time = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

const { data: trip, error: tripError } = await db.from('trips').select('id').eq('id', E2E_TRIP_ID).single();
if (tripError) throw new Error(tripError.message);

const { error: activityError } = await db.from('activities').insert([
  { trip_id: trip.id, day, title: 'E2E — Lunch in Asakusa', start_time: time(Math.max(0, at - 30)), end_time: time(Math.min(1439, at + 15)), category: 'food', details: {}, location: 'Asakusa, Tokyo', cost: 40, booking_ref: 'TEST-LUNCH-123', notes: 'Window table, fictional booking' },
  { trip_id: trip.id, day, title: 'E2E — Senso-ji visit', start_time: time(Math.min(1438, at + 45)), end_time: time(Math.min(1439, at + 90)), category: 'sightseeing', details: {}, location: 'Senso-ji, Asakusa, Tokyo', cost: 60, notes: 'Bring the saved itinerary' },
  { trip_id: trip.id, day: nextDate(day), title: 'E2E — Flight to Tokyo', category: 'transport', subtype: 'flight', cost: 0, start_time: '23:00', end_time: '07:00', booking_ref: 'TEST-FLIGHT-456', details: { from: 'SIN', to: 'HND', departure_timezone: 'Asia/Singapore', arrival_timezone: 'Asia/Tokyo', arrival_date: nextDate(nextDate(day)) } },
]);
if (activityError) throw new Error(activityError.message);

await db.from('packing_items').insert({ trip_id: trip.id, label: 'Passport (test checklist)', qty: 1, packed: false });
console.log('Seeded the local tester’s trip.');
