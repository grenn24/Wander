/**
 * Passing a streamed OpenAI answer on to the browser, and stopping when the
 * browser stops listening.
 *
 * Both streamed routes (the planner and a guide's questions) used to read the
 * upstream body to the end whatever happened at the other end. A traveller
 * who cancelled a plan, or closed the tab, left the server reading a two
 * minute itinerary nobody would see — and the model writing, and billing, the
 * whole of it. Worse, the guide route caught the error from writing to the
 * closed stream as "one bad frame" and carried on. Cancelling the reader here
 * closes the connection to OpenAI, which is what stops the generation.
 */

/**
 * The text of each read from a chat-completions event stream: every
 * `delta.content` in one network chunk, joined. Lines are split across chunks
 * and reassembled; a frame that is not JSON is skipped rather than fatal.
 */
export async function* chatText(reader) {
  const decoder = new TextDecoder();
  let buf = '';
  const textOf = (lines) => {
    let out = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta;
        if (delta && typeof delta.content === 'string') out += delta.content;
      } catch { /* keep reading; one bad frame is not fatal */ }
    }
    return out;
  };
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    const text = textOf(lines);
    if (text) yield text;
  }
  // A last line with no newline after it still counts.
  const tail = textOf([buf + decoder.decode()]);
  if (tail) yield tail;
}

/**
 * The stream a route answers with, fed from `upstream` (a fetch Response).
 *
 * `produce({ text, send, gone, progress, stop, stopped })` does the route's own
 * work: `text` is chatText over the upstream body, `send(chunk)` enqueues
 * bytes or a string (dropped once the reader has gone), and `gone()` says
 * whether it has. It should catch its own errors; the stream is closed when
 * it returns.
 *
 * Options, all off unless given — for an answer long enough that the
 * connection carrying it may not last:
 *
 *   beat, beatMs     send `beat` whenever nothing has been sent for beatMs, so
 *                    the reader can tell a live answer from a dead connection
 *   quietMs          stop reading when produce has not called `progress()` for
 *                    this long (`firstMs` before the first call, which waits on
 *                    the model thinking)
 *   deadline         stop reading at this time (ms since the epoch), so the
 *                    stream is closed by us rather than cut by the host
 *   detached         keep reading the answer after the reader has gone,
 *                    because it is being saved somewhere the reader can find
 *                    it again (the planner's drafts); `stop()` ends it instead
 *
 * A stop ends `text` as if the answer had finished; `stopped()` then says why
 * ('quiet', 'deadline', or what was passed to `stop(why)`), so produce can
 * tell the reader it was cut short.
 */
export function relayStream(upstream, produce, {
  beat = null, beatMs = 0, quietMs = 0, firstMs = 0, deadline = 0, now = Date.now,
  detached = false,
} = {}) {
  const encoder = new TextEncoder();
  let reader = null;
  let gone = false;
  // Leaving stops the model, unless the answer outlives the reader on purpose.
  const left = () => { if (!detached && reader) reader.cancel().catch(() => {}); };
  return new ReadableStream({
    async start(controller) {
      reader = upstream.body.getReader();
      let lastSent = now();
      let lastProgress = now();
      let progressed = false;
      let stoppedFor = null;
      const send = (chunk) => {
        if (gone) return;
        try {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
          lastSent = now();
        } catch {
          // The reader went away between the check and the write.
          gone = true;
          left();
        }
      };
      const progress = () => { progressed = true; lastProgress = now(); };
      const stop = (why) => {
        if (stoppedFor) return;
        stoppedFor = why;
        // Resolves the pending read as done, so `text` ends.
        reader.cancel().catch(() => {});
      };

      const periods = [beat ? beatMs : 0, quietMs, firstMs].filter((ms) => ms > 0);
      const watch = (periods.length || deadline) ? setInterval(() => {
        const t = now();
        if (beat && beatMs && t - lastSent >= beatMs) send(beat);
        if (deadline && t >= deadline) stop('deadline');
        else if (quietMs && t - lastProgress >= (progressed ? quietMs : (firstMs || quietMs))) stop('quiet');
      }, Math.max(5, Math.min(1000, ...periods) / 4)) : null;

      try {
        await produce({
          text: chatText(reader), send, gone: () => gone, progress, stop, stopped: () => stoppedFor,
        });
      } finally {
        if (watch) clearInterval(watch);
        if (!gone) {
          gone = true;
          try { controller.close(); } catch { /* already closed */ }
        }
        // Whatever is left upstream is not wanted.
        reader.cancel().catch(() => {});
      }
    },
    cancel() {
      gone = true;
      // Resolves the pending read as done, so `produce` winds down too —
      // unless the answer is detached, when it carries on for the draft.
      left();
    },
  });
}
