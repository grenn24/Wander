import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/*
 * Cancel on the planner ends on the trips page without the trip. Checked in
 * the browser against a faked plan: cancelling while the brief is checked,
 * while the trip is written, while its activities are written, and in the
 * moment after saving while the new trip opens. That last one used to land
 * on the trips page with the cancelled trip still in the list.
 */
const page = fs.readFileSync(new URL('../app/plan/page.js', import.meta.url), 'utf8');
const cancel = page.slice(page.indexOf('const cancelPlanning'), page.indexOf('const upsertDay'));

test('cancel deletes a written trip before it goes to the trips page', () => {
  assert.ok(cancel.indexOf('await discardPendingTrip()') > 0, 'waits for the delete');
  assert.ok(cancel.indexOf('await discardPendingTrip()') < cancel.indexOf("router.replace('/trips')"));
  assert.match(cancel, /if \(savingRef\.current\) await savingRef\.current/, 'and for a save under way');
  assert.match(cancel, /setTimeout\(done, \d+\)/, 'but not forever');
  assert.match(cancel, /if \(leavingRef\.current\) return;/, 'a second press does nothing');
});

test('the trip stays pending until the planner is gone', () => {
  const end = page.slice(page.indexOf('const cover = rows.find'), page.indexOf('router.replace(tripHome(trip.id))'));
  assert.doesNotMatch(end, /pendingTripRef\.current = null/);
});

test('the trip is inserted once, though a cancel waits on it too', () => {
  assert.match(page, /const saving = Promise\.resolve\(supabase\.from\('trips'\)\.insert\(/);
});
