import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  expand, expandAll, placeTargets, sortPlaces, withChosenPlaces, applyChanges, onlySet, shiftTime,
} from '../lib/tripChanges.js';
import {
  cleanEdits, editActivities, editHistory, editPrompt, proposeEdits,
} from '../lib/tripEdits.js';
import { changeNote } from '../lib/tripAsk.js';
import { shortPlace } from '../lib/util.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

const trip = { id: 't1', name: 'Tokyo', destination: 'Tokyo, Japan', start_date: '2026-12-12', end_date: '2026-12-15', currency: 'JPY', timezone: 'Asia/Tokyo' };
const ginza = { id: 'a-ginza', day: '2026-12-12', start_time: '11:00:00', end_time: '14:00:00', title: 'Ginza', category: 'shopping', location: 'Ginza, Chuo City, Tokyo 104-0061, Japan', notes: 'Bring the tax-free passport' };
const moma = { id: 'a-moma', day: '2026-12-12', start_time: '12:00', end_time: '12:30', title: 'MoMA Design Store', category: 'shopping', location: 'MoMA Design Store, Ginza Loft, Ginza, Tokyo' };
const hotel = { id: 'a-hotel', day: '2026-12-13', title: 'Hotel', category: 'lodging', location: 'Shinjuku', notes: 'Ref 123', details: { check_in_date: '2026-12-13' } };
const activities = [ginza, moma, hotel];

/* ------------------------------------------------------- the editor --- */

test('the editor sees database rows the way the command bar sends them', () => {
  const rows = editActivities([{ ...ginza, lat: 35.6, lng: 139.7, sort_order: 3, trip_id: 't1' }, hotel]);
  assert.deepEqual(Object.keys(rows[0]).sort(), ['category', 'cost', 'day', 'details', 'end_time', 'id', 'location', 'notes', 'start_time', 'title'].sort());
  assert.equal(rows[0].location, shortPlace(ginza.location), 'a short place, as the command bar sends it');
  assert.equal(rows[0].location, 'Chuo City, Tokyo');
  assert.equal(rows[0].notes, undefined, 'only lodging notes go to the editor');
  assert.equal(rows[1].notes, 'Ref 123');
  assert.equal(editActivities(Array.from({ length: 90 }, (_, i) => ({ id: String(i) }))).length, 80);
});

test('the editor is not shown the app\'s own pins inside details', () => {
  const flight = { id: 'f', day: '2026-12-12', title: 'NH804', category: 'transport',
    details: { to: 'NRT', gate: 'B7', _arrive: { q: 'NRT', lat: 35.77, lng: 140.39 } } };
  assert.deepEqual(editActivities([flight])[0].details, { to: 'NRT', gate: 'B7' });
  assert.equal(editActivities([{ id: 'x', details: null }])[0].details, null);
});

test('the editor is told the trip, its days, the conversation and the instruction', () => {
  const prompt = editPrompt({
    trip,
    activities: editActivities(activities),
    history: editHistory([{ role: 'assistant', content: 'JINS Ginza Loft is in the same building.' }, { role: 'user', content: 'Add it to the same day' }]),
    instruction: 'Add JINS Ginza Loft on Day 1 after MoMA Design Store',
  });
  assert.match(prompt, /Days: Day 1 = 2026-12-12, Day 2 = 2026-12-13/);
  assert.match(prompt, /id=a-moma \| 2026-12-12 \| 12:00–12:30 \| MoMA Design Store/);
  assert.match(prompt, /- Wander \[message\]: JINS Ginza Loft is in the same building\./);
  assert.match(prompt, /- Traveller \[message\]: Add it to the same day/);
  assert.match(prompt, /Instruction: "Add JINS Ginza Loft on Day 1 after MoMA Design Store"/);
});

test('edits only touch activities that exist, and questions come back readable', () => {
  const out = cleanEdits({
    understood: true,
    summary: 'Add JINS Ginza Loft after MoMA Design Store',
    ops: [
      { kind: 'add_activity', describe: 'Add JINS Ginza Loft to Day 1', day: '2026-12-12', title: 'JINS Ginza Loft', start_time: '12:30:00', end_time: '13:15', category: 'shopping', location: 'JINS Ginza Loft, Ginza, Tokyo' },
      { kind: 'delete_activity', describe: 'Delete something invented', activity_id: 'nope' },
      { kind: 'drop_table', describe: 'Not a kind' },
    ],
  }, activities);
  assert.equal(out.understood, true);
  assert.deepEqual(out.ops.map((o) => o.kind), ['add_activity']);
  assert.equal(out.ops[0].start_time, '12:30');

  const asked = cleanEdits({
    understood: false,
    question: { ask: 'Which Ginza stop?', header: 'Which stop', kind: 'multi', options: [{ label: 'Ginza', detail: null }, { label: '', detail: 'blank' }] },
  }, activities);
  assert.equal(asked.understood, false);
  assert.equal(asked.question.kind, 'multi');
  assert.deepEqual(asked.question.options.map((o) => o.label), ['Ginza']);
});

test('proposeEdits asks the command task once, with the shared schema', async () => {
  const calls = [];
  const out = await proposeEdits({
    instruction: 'Remove MoMA Design Store',
    trip,
    activities: editActivities(activities),
    ask: async (req) => {
      calls.push(req);
      return { understood: true, question: null, summary: 'Remove MoMA Design Store', ops: [{ kind: 'delete_activity', describe: 'Delete MoMA Design Store from Day 1', activity_id: 'a-moma' }] };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].task, 'command');
  assert.equal(calls[0].schemaName, 'trip_edits');
  assert.match(calls[0].system, /One place, one activity/);
  assert.match(calls[0].user, /Instruction: "Remove MoMA Design Store"/);
  assert.deepEqual(out.ops.map((o) => [o.kind, o.activity_id]), [['delete_activity', 'a-moma']]);
});

/* ------------------------------------------------------ applying them --- */

test('bulk edits expand to the stops they land on', () => {
  assert.deepEqual(expand({ kind: 'shift_times', day: '2026-12-12', minutes: 30 }, activities).map((o) => [o.activity_id, o.start_time, o.end_time]),
    [['a-ginza', '11:30', '14:30'], ['a-moma', '12:30', '13:00']]);
  assert.deepEqual(expand({ kind: 'clear_day', day: '2026-12-12' }, activities).map((o) => o.kind), ['delete_activity', 'delete_activity']);
  assert.deepEqual(expand({ kind: 'move_day', day: '2026-12-13', to_day: '2026-12-14' }, activities).map((o) => [o.activity_id, o.day]), [['a-hotel', '2026-12-14']]);
  const notes = expand({ kind: 'edit_many', items: [{ activity_id: 'a-ginza', note_add: 'Opens 11:00' }, { activity_id: 'gone' }] }, activities);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].notes, 'Bring the tax-free passport\nOpens 11:00', 'appended, never replaced');
  assert.equal(expandAll([{ kind: 'clear_day', day: '2026-12-12' }, { kind: 'add_activity' }], activities).length, 3);
  assert.equal(shiftTime('23:50', 30), '23:59', 'clamped to the day');
  assert.deepEqual(onlySet({ gate: 'B4', seat: null, check_in_date: '' }), { gate: 'B4', check_in_date: '' });
});

test('new and moved places are looked up before saving; ambiguous ones wait for a choice', () => {
  const expanded = [
    { kind: 'add_activity', title: 'JINS Ginza Loft', location: 'JINS Ginza Loft, Ginza, Tokyo', category: 'shopping', day: '2026-12-12', named_place: true },
    { kind: 'update_activity', activity_id: 'a-moma', location: 'MoMA Design Store, Ginza Loft, Ginza, Tokyo' },
    { kind: 'update_activity', activity_id: 'a-ginza', location: 'Ginza Six, Tokyo' },
  ];
  const { targets, destination } = placeTargets(expanded, activities, trip);
  assert.equal(destination, 'Tokyo, Japan');
  assert.deepEqual(targets.map((t) => t.id), ['op-0', 'op-2'], 'an unchanged location is not looked up again');

  const candidates = [{ place_id: 'p1', label: 'JINS, Ginza 2-4-6' }, { place_id: 'p2', label: 'JINS, Ginza 5' }];
  const { resolved, uncertain } = sortPlaces([
    { id: 'op-0', found: true, ambiguous: true, candidates },
    { id: 'op-2', found: true, label: 'Ginza Six', lat: 35.67, lng: 139.76, place_id: 'g6' },
  ], targets);
  assert.deepEqual(Object.keys(resolved), ['op-2']);
  assert.equal(uncertain[0].title, 'JINS Ginza Loft');
  const chosen = withChosenPlaces(resolved, uncertain, { 'op-0': 'p1' });
  assert.equal(chosen['op-0'].place_id, 'p1');
  assert.equal(withChosenPlaces(resolved, uncertain, { 'op-0': '__none__' })['op-0'], null);
});

test('a venue the editor chose is never a question: its ranked match stands', () => {
  const expanded = [
    { kind: 'add_activity', title: 'Ramen lunch', location: 'Ichiran, Ginza, Tokyo', category: 'food', day: '2026-12-12', named_place: false },
    { kind: 'add_activity', title: 'Coffee', location: 'Blue Bottle, Tokyo', category: 'food', day: '2026-12-12' },
  ];
  const { targets } = placeTargets(expanded, activities, trip);
  assert.deepEqual(targets.map((t) => t.named), [false, false], 'a missing flag is the editor\'s pick');
  const two = [
    { place_id: 'i1', label: 'Ichiran Ginza', lat: 35.67, lng: 139.76 },
    { place_id: 'i2', label: 'Ichiran Shibuya', lat: 35.66, lng: 139.70 },
  ];
  const { resolved, uncertain } = sortPlaces([
    { id: 'op-0', found: true, ambiguous: true, confidence: 'medium', ...two[0], candidates: two },
    { id: 'op-1', found: true, ambiguous: true, confidence: 'low', place_id: 'b1', candidates: [{ place_id: 'b1' }, { place_id: 'b2' }] },
  ], targets);
  assert.equal(uncertain.length, 0);
  assert.equal(resolved['op-0'].place_id, 'i1', 'the ranked match is pinned');
  assert.equal(resolved['op-1'], null, 'none trusted: the words stay, unpinned');
});

test('applying writes each edit through the trip, pins included', async () => {
  const calls = [];
  const api = {
    addActivities: async (rows) => { calls.push(['add', rows]); return rows; },
    saveActivity: async (patch) => { calls.push(['save', patch]); },
    moveActivity: async (a, day) => { calls.push(['move', a.id, day]); },
    deleteActivity: async (a) => { calls.push(['delete', a.id]); },
    updateTrip: async (patch) => { calls.push(['trip', patch]); },
  };
  const done = await applyChanges({
    expanded: [
      { kind: 'add_activity', title: 'JINS Ginza Loft', day: '2026-12-12', start_time: '12:30', end_time: '13:15', category: 'shopping', location: 'JINS Ginza Loft, Ginza, Tokyo' },
      { kind: 'update_activity', activity_id: 'a-ginza', title: null, start_time: null, end_time: '14:30', location: 'Ginza Six, Tokyo' },
      { kind: 'move_activity', activity_id: 'a-moma', day: '2026-12-13' },
      { kind: 'delete_activity', activity_id: 'gone' },
      { kind: 'update_trip', budget: 300000 },
    ],
    resolved: {
      'op-0': { label: 'JINS Ginza Loft, 2-4-6 Ginza', lat: 35.67, lng: 139.76, place_id: 'p1', photo_ref: 'ph' },
      'op-1': null,
    },
    activities,
    trip,
    api,
  });
  assert.equal(done, 4, 'the missing stop is skipped, not counted');
  const add = calls.find((c) => c[0] === 'add')[1][0];
  assert.equal(add.location, 'JINS Ginza Loft, 2-4-6 Ginza');
  assert.equal(add.place_id, 'p1');
  const save = calls.find((c) => c[0] === 'save')[1];
  assert.equal(save.end_time, '14:30');
  assert.equal(save.start_time, '11:00:00', 'null leaves a field alone');
  assert.equal(save.lat, null, 'a new address with no match drops the old pin');
  assert.deepEqual(calls.find((c) => c[0] === 'move'), ['move', 'a-moma', '2026-12-13']);
  assert.deepEqual(calls.find((c) => c[0] === 'trip'), ['trip', { budget: 300000 }]);
  assert.equal(calls[calls.length - 1][0], 'add', 'new stops go in together, last');
});

/* --------------------------------------------------- the Assistant --- */

test('a proposed change reads in the history as what became of it', () => {
  const proposal = { summary: 'Add JINS Ginza Loft to Day 1', ops: [{ kind: 'add_activity', describe: 'Add JINS Ginza Loft' }] };
  assert.equal(changeNote({ proposal: { ...proposal, state: 'applied' } }), '[Proposed change: Add JINS Ginza Loft to Day 1. the traveller applied it]');
  assert.match(changeNote({ proposal: { ...proposal, state: 'discarded' } }), /discarded it, so nothing changed/);
  assert.match(changeNote({ proposal: { ...proposal, state: 'pending' } }), /not applied yet/);
  assert.match(changeNote({ proposal: { summary: 'Already there', ops: [] } }), /nothing needed changing/);
  assert.equal(changeNote({ editQuestion: { ask: 'Which day?' } }), '[Before changing the trip, asked: Which day?]');
  assert.equal(changeNote({ content: 'Just words' }), '');
});

test('the Assistant can change the trip, through the command bar\'s editor, and only proposes', () => {
  const route = read('app/api/trips/ask/route.js');
  assert.doesNotMatch(route, /You cannot change the trip/);
  assert.match(route, /name: 'change_trip'/);
  assert.match(route, /tools: \[\{ type: 'web_search' \}, CHANGE_TOOL\]/);
  assert.match(route, /proposeEdits\(/);
  assert.match(route, /Never tell them to make the change themselves/);
  // Nothing on the server writes to the trip: Apply on the page does.
  assert.doesNotMatch(route, /\.from\([^)]*\)\s*\.(insert|update|delete|upsert)\(/);
  assert.match(route, /db\.from\('activities'\)\.select\('\*'\)/, 'it does read the trip');
  const command = read('app/api/command/route.js');
  assert.match(command, /proposeEdits\(/);
  // Both surfaces apply through the same hook.
  assert.match(read('components/Command.jsx'), /useTripChanges\(\)/);
  assert.match(read('components/AskChanges.jsx'), /useTripChanges\(\)/);
});
