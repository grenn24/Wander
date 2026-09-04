import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapConcurrent, createSerialQueue } from '../lib/asyncWork.js';
import { readCommandCalendar } from '../lib/commandCalendar.js';
import { mergeAgentHistory } from '../lib/agentHistory.js';
import { requestTiming } from '../lib/requestTiming.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
test('calendar reads overlap at most three at once, preserving calendar order on merge', async () => {
  let active = 0;
  let peak = 0;
  const started = [];
  const release = [];
  const result = readCommandCalendar(async (path) => {
    if (path.startsWith('/users')) return { items: Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, primary: i === 0, selected: true, summary: `Calendar ${i}` })) };
    const id = Number(path.match(/\/c(\d)\//)[1]);
    started.push(id); active += 1; peak = Math.max(peak, active);
    await new Promise((resolve) => { release[id] = resolve; });
    active -= 1;
    return { items: [{ id: `e${id}`, iCalUID: 'same-booking', summary: 'Hotel', start: { date: '2026-11-26' }, end: { date: '2026-11-28' } }] };
  }, { start_date: '2026-11-26', end_date: '2026-12-03' });
  await tick();
  assert.deepEqual(started, [0, 1, 2]);
  release[2](); await tick();
  assert.deepEqual(started, [0, 1, 2, 3]);
  release[0](); release[1](); release[3](); await tick();
  release[4](); release[5]();
  const events = await result;
  assert.equal(peak, 3);
  assert.equal(events.length, 1);
  assert.equal(events[0].calendar, 'Calendar 0');
});

test('a failed concurrent read rejects the batch without starting queued reads', async () => {
  const started = [];
  let release;
  const result = mapConcurrent([0, 1, 2, 3], 2, async (i) => {
    started.push(i);
    if (i === 0) throw new Error('unavailable');
    await new Promise((resolve) => { release = resolve; });
  });
  await assert.rejects(result, /unavailable/);
  release(); await tick();
  assert.deepEqual(started, [0, 1]);
});

test('history queue preserves question/reply order without blocking independent work, and recovers after failures', async () => {
  const enqueue = createSerialQueue();
  const writes = [];
  let release;
  const question = enqueue(async () => { writes.push('question'); await new Promise((resolve) => { release = resolve; }); });
  const answer = enqueue(async () => { writes.push('answer'); });
  await tick();
  assert.deepEqual(writes, ['question']);
  const independent = await Promise.resolve('proposal visible');
  assert.equal(independent, 'proposal visible');
  release(); await Promise.all([question, answer]);
  assert.deepEqual(writes, ['question', 'answer']);
  await assert.rejects(enqueue(() => { throw new Error('write failed'); }), /write failed/);
  assert.equal(await enqueue(() => 'next saved'), 'next saved');
});

test('pending history survives refresh, and persisted echoes do not duplicate it', () => {
  const a = { id: 'a', content: 'request', created_at: '2026-09-04T10:00:00Z' };
  const b = { id: 'b', content: 'proposal', created_at: '2026-09-04T10:00:01Z' };
  assert.deepEqual(mergeAgentHistory([], [a, b]), [a, b]);
  assert.deepEqual(mergeAgentHistory([b, a], [a, b]), [a, b]);
  assert.equal(mergeAgentHistory(Array.from({ length: 70 }, (_, i) => ({ id: String(i), created_at: String(i).padStart(3, '0') })), []).length, 60);
});

test('request timing includes failed stages and total, without request contents', async () => {
  let clock = 0;
  const logged = [];
  const timing = requestTiming(() => clock, (...args) => logged.push(args));
  await timing.measure('auth', () => { clock = 10; });
  await timing.measure('calendar', () => { clock = 30; });
  await assert.rejects(timing.measure('ai', () => { clock = 90; throw new Error('private prompt'); }));
  const response = timing.finish(Response.json({ error: 'Unavailable' }, { status: 502 }));
  assert.equal(response.headers.get('Server-Timing'), 'auth;dur=10.0, calendar;dur=20.0, ai;dur=60.0, total;dur=90.0');
  assert.doesNotMatch(JSON.stringify(logged), /private prompt/);
});

test('the command request and proposal display never await history persistence', () => {
  const code = readFileSync(new URL('../components/Command.jsx', import.meta.url), 'utf8');
  const run = code.slice(code.indexOf('async function run(reply)'), code.indexOf('async function pack'));
  // The only remaining awaited history write is after applying actual changes.
  const request = run.slice(0, run.indexOf('async function commitChanges'));
  assert.doesNotMatch(request, /await appendAgentMessage/);
  assert.match(request, /void appendAgentMessage/);
  const provider = readFileSync(new URL('../components/TripProvider.jsx', import.meta.url), 'utf8');
  assert.match(provider, /historyQueue\.current\(async/);
  assert.match(provider, /ascending: false/);
});
