import test from 'node:test';
import assert from 'node:assert/strict';
import { chatText, relayStream } from '../lib/aiStream.js';

const frame = (content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

/** An upstream body that hands out `chunks` one read at a time, and says whether it was cancelled. */
function upstreamOf(chunks, { endless = false } = {}) {
  const encoder = new TextEncoder();
  const seen = { cancelled: false, reads: 0 };
  let i = 0;
  const body = new ReadableStream({
    pull(controller) {
      seen.reads += 1;
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else if (endless) controller.enqueue(encoder.encode(frame('more ')));
      else controller.close();
    },
    cancel() { seen.cancelled = true; },
  }, { highWaterMark: 0 });
  return { response: { body }, seen };
}

async function readAll(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) return out;
    out += decoder.decode(value, { stream: true });
  }
}

test('chatText joins the deltas of each read, across split lines and bad frames', async () => {
  const whole = frame('Hello') + frame(', ') + 'data: not json\n\n' + frame('world') + 'data: [DONE]\n\n';
  // Cut mid-line, as the network does.
  const { response } = upstreamOf([whole.slice(0, 17), whole.slice(17, 60), whole.slice(60)]);
  const parts = [];
  for await (const t of chatText(response.body.getReader())) parts.push(t);
  assert.equal(parts.join(''), 'Hello, world');
});

test('chatText reads a last line that has no newline after it', async () => {
  const { response } = upstreamOf([frame('a'), frame('b').trimEnd()]);
  const parts = [];
  for await (const t of chatText(response.body.getReader())) parts.push(t);
  assert.equal(parts.join(''), 'ab');
});

test('relayStream passes the text on and closes when the answer ends', async () => {
  const { response, seen } = upstreamOf([frame('one '), frame('two')]);
  const stream = relayStream(response, async ({ text, send }) => {
    for await (const t of text) send(t);
  });
  assert.equal(await readAll(stream), 'one two');
  assert.equal(seen.cancelled, false);
});

test('a reader who goes away stops the upstream read, instead of it running to the end', async () => {
  // An answer that would never finish on its own.
  const { response, seen } = upstreamOf([frame('first ')], { endless: true });
  let ended = false;
  const stream = relayStream(response, async ({ text, send }) => {
    for await (const t of text) send(t);
    ended = true;
  });
  const reader = stream.getReader();
  const { value } = await reader.read();
  assert.match(new TextDecoder().decode(value), /first/);
  await reader.cancel();
  // Give the producer a turn to notice.
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.cancelled, true, 'the upstream body is cancelled, which closes the connection to OpenAI');
  assert.equal(ended, true, 'the producer winds down');
  const readsAfter = seen.reads;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(seen.reads, readsAfter, 'nothing more is read');
});

test('sending after the reader has gone is dropped, not thrown', async () => {
  const { response } = upstreamOf([frame('x')]);
  let threw = null;
  let release;
  const held = new Promise((r) => { release = r; });
  const stream = relayStream(response, async ({ send, gone }) => {
    await held;
    try { send('late'); } catch (e) { threw = e; }
    assert.equal(gone(), true);
  });
  await stream.cancel();
  release();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(threw, null);
});
