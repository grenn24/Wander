import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relayStream } from '../lib/aiStream.js';
import { readPlan } from '../lib/planResume.js';
import { openDraft, draftWriter, followDraft } from '../lib/planDraft.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => { setTimeout(r, ms); });
const frame = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/** Enough of supabase-js for plan_drafts: insert, conditional update, delete. */
function fakeDb({ missing = false, delay = 0 } = {}) {
  const rows = new Map();
  const writes = [];
  let n = 0;
  const run = async (q) => {
    if (delay) await wait(delay);
    if (missing) return { data: null, error: { message: 'relation "public.plan_drafts" does not exist' } };
    const id = (q.filters.find(([k]) => k === 'id') || [])[1];
    if (q.op === 'insert') {
      n += 1;
      rows.set(`d${n}`, { status: 'running', plan: {}, ...q.fields });
      return { data: { id: `d${n}` }, error: null };
    }
    if (q.op === 'update') {
      writes.push(q.fields);
      const row = rows.get(id);
      const wanted = (q.filters.find(([k]) => k === 'status') || [])[1];
      if (!row || (wanted && row.status !== wanted)) return { data: [], error: null };
      Object.assign(row, q.fields);
      return { data: [{ id }], error: null };
    }
    return { data: [], error: null };
  };
  return {
    rows,
    writes,
    from() {
      const q = { op: null, fields: null, filters: [] };
      const b = {
        insert(f) { q.op = 'insert'; q.fields = f; return b; },
        update(f) { q.op = 'update'; q.fields = f; return b; },
        delete() { q.op = 'delete'; return b; },
        select() { return b; },
        single() { return b; },
        eq(k, v) { q.filters.push([k, v]); return b; },
        lt(k, v) { q.filters.push([k, v]); return b; },
        then(ok, bad) { return run(q).then(ok, bad); },
      };
      return b;
    },
  };
}

test('without the table there is no draft, and nothing else changes', async () => {
  const warn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await openDraft(fakeDb({ missing: true })), null);
    assert.equal(await openDraft(null), null, 'nobody to ask as');
  } finally { console.warn = warn; }
  const db = fakeDb();
  assert.equal(await openDraft(db), 'd1');
  assert.equal(db.rows.get('d1').status, 'running');
});

test('a slow database gets the latest plan, not a queue of every day', async () => {
  const db = fakeDb({ delay: 30 });
  const id = await openDraft(db);
  db.writes.length = 0;
  const writer = draftWriter(db, id);
  for (let day = 1; day <= 6; day += 1) writer.save({ days: Array.from({ length: day }, (_, i) => ({ day_index: i + 1 })) });
  await writer.finish('done', { days: 'all' });
  assert.ok(db.writes.length <= 3, `${db.writes.length} writes`);
  assert.equal(db.rows.get(id).status, 'done');
  assert.equal(db.rows.get(id).plan.days, 'all', 'the finish is written last');
});

test('a draft no longer running means Cancel, and stops the model', async () => {
  const db = fakeDb();
  const id = await openDraft(db);
  let stopped = 0;
  const writer = draftWriter(db, id, { onCancelled: () => { stopped += 1; } });
  writer.save({ days: [1] });
  await wait(5);
  db.rows.get(id).status = 'cancelled'; // what the page's Cancel does
  writer.save({ days: [1, 2] });
  await wait(5);
  assert.equal(stopped, 1);
  assert.equal(writer.cancelled(), true);
  await writer.finish('done', { days: [1, 2, 3] });
  assert.equal(db.rows.get(id).status, 'cancelled', 'nothing is written over a cancel');
});

test('a finished draft is handed over, and the days on the way are shown', async () => {
  const rows = [
    { status: 'running', plan: { days: [{ day_index: 6 }] }, updated_at: 'a', created_at: new Date().toISOString() },
    { status: 'running', plan: { days: [{ day_index: 6 }, { day_index: 7 }] }, updated_at: 'b', created_at: new Date().toISOString() },
    { status: 'done', plan: { name: 'Aurora', days: [{ day_index: 6 }, { day_index: 7 }, { day_index: 8 }] }, updated_at: 'c' },
  ];
  const shown = [];
  const out = await followDraft({ read: async () => rows.shift(), onDraft: (p) => shown.push(p.days.length), pollMs: 1 });
  assert.equal(out.plan.name, 'Aurora');
  assert.deepEqual(shown, [1, 2, 3]);
});

test('a draft that cannot finish is given up on at once, or once it stops moving', async () => {
  assert.deepEqual(await followDraft({ read: async () => null }), { fallback: 'missing' });
  assert.deepEqual(await followDraft({ read: async () => ({ status: 'stopped', plan: {} }) }), { fallback: 'stopped' });
  assert.deepEqual(await followDraft({ read: async () => { throw new Error('offline'); } }), { fallback: 'unreadable' });

  // Running, but nothing has changed for staleMs: the request writing it has died.
  let t = 0;
  const still = { status: 'running', plan: {}, updated_at: 'same', created_at: new Date().toISOString() };
  const stale = await followDraft({
    read: async () => still, now: () => t, sleep: async () => { t += 10_000; }, staleMs: 45_000,
  });
  assert.deepEqual(stale, { fallback: 'stale' });

  // Older than any request can live, however recently it says it moved.
  let u = 0;
  const old = await followDraft({
    read: async () => ({ status: 'running', plan: {}, updated_at: String(u), created_at: new Date(Date.now() - 400_000).toISOString() }),
    sleep: async () => { u += 1; },
  });
  assert.deepEqual(old, { fallback: 'expired' });
});

test('coming back to the tab gives up on a connection that went quiet while it slept', async () => {
  const doc = new EventTarget();
  doc.visibilityState = 'hidden';
  let t = 0;
  const body = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(`${JSON.stringify({ t: 'job', id: 'd1' })}\n`)); },
  });
  const seen = [];
  const reading = readPlan(body, { onEvent: (e) => seen.push(e), doc, now: () => t, quietMs: 60_000, wakeMs: 15_000 });
  await wait(10);
  t = 70_000; // the tab slept for over a minute
  doc.visibilityState = 'visible';
  doc.dispatchEvent(new Event('visibilitychange'));
  assert.deepEqual(await reading, { cut: 'quiet' });
  assert.deepEqual(seen, [{ t: 'job', id: 'd1' }], 'the draft id reaches the page');
});

test('a quick look away from a live stream is not taken for a lost one', async () => {
  const doc = new EventTarget();
  doc.visibilityState = 'visible';
  let t = 0;
  const encoder = new TextEncoder();
  let push;
  const body = new ReadableStream({ start(c) { push = c; } });
  const reading = readPlan(body, { doc, now: () => t, quietMs: 60_000, wakeMs: 15_000 });
  t = 5_000;
  doc.dispatchEvent(new Event('visibilitychange'));
  push.enqueue(encoder.encode(`${JSON.stringify({ t: 'done', plan: { days: [] } })}\n`));
  assert.deepEqual(await reading, { plan: { days: [] } });
});

test('a detached answer is read to the end after the browser has gone, and stop() ends it', async () => {
  const encoder = new TextEncoder();
  const parts = ['{"days":[', '{"day_index":1}', ',{"day_index":2}', ']}'];
  let i = 0;
  let upstreamCancelled = false;
  const upstream = {
    body: new ReadableStream({
      async pull(c) {
        await wait(10);
        if (i < parts.length) c.enqueue(encoder.encode(frame(parts[i++])));
        else c.close();
      },
      cancel() { upstreamCancelled = true; },
    }, { highWaterMark: 0 }),
  };
  let text = '';
  let done;
  const finished = new Promise((r) => { done = r; });
  const stream = relayStream(upstream, async ({ text: chunks, send }) => {
    for await (const t of chunks) { text += t; send(t); }
    done();
  }, { detached: true });
  const reader = stream.getReader();
  await reader.read();
  await reader.cancel(); // the tab went to sleep
  await finished;
  assert.equal(text, parts.join(''), 'the whole answer was read for the draft');
  assert.equal(upstreamCancelled, false);

  // And a cancel, heard through the draft, does stop it.
  let j = 0;
  const endless = {
    body: new ReadableStream({
      async pull(c) { await wait(5); j += 1; c.enqueue(encoder.encode(frame('x'))); },
    }, { highWaterMark: 0 }),
  };
  let why = null;
  const s2 = relayStream(endless, async ({ text: chunks, stop, stopped }) => {
    for await (const t of chunks) { if (t && j >= 3) stop('cancelled'); }
    why = stopped();
  }, { detached: true });
  const r2 = s2.getReader();
  await r2.cancel();
  await wait(100);
  assert.equal(why, 'cancelled');
});

test('the route keeps the plan in a draft only when it can, and the page reads it', () => {
  const route = read('app/api/plan/route.js');
  assert.match(route, /const draftId = await openDraft\(db\)/);
  assert.match(route, /\.\.\.\(draftId \? \{\} : \{ signal: req\.signal \}\)/, 'without a draft, leaving still stops the model');
  assert.match(route, /detached: !!draftId/);
  assert.match(route, /if \(draftId\) after\(\(\) => finished\)/);
  assert.match(route, /await draft\.finish\('done', plan\);\s*send\(\{ t: 'done', plan \}\)/, 'kept before it is sent');
  const page = read('app/plan/page.js');
  assert.match(page, /followDraft\(\{/);
  assert.match(page, /update\(\{ status: 'cancelled' \}\)/);
  const schema = read('supabase/schema.sql');
  assert.match(schema, /create table if not exists public\.plan_drafts/);
  assert.match(schema, /create policy plan_drafts_own on public\.plan_drafts for all to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
});
