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
 * `produce({ text, send, gone })` does the route's own work: `text` is
 * chatText over the upstream body, `send(chunk)` enqueues bytes or a string
 * (dropped once the reader has gone), and `gone()` says whether it has. It
 * should catch its own errors; the stream is closed when it returns.
 */
export function relayStream(upstream, produce) {
  const encoder = new TextEncoder();
  let reader = null;
  let gone = false;
  return new ReadableStream({
    async start(controller) {
      reader = upstream.body.getReader();
      const send = (chunk) => {
        if (gone) return;
        try {
          controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        } catch {
          // The reader went away between the check and the write.
          gone = true;
          reader.cancel().catch(() => {});
        }
      };
      try {
        await produce({ text: chatText(reader), send, gone: () => gone });
      } finally {
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
      // Resolves the pending read as done, so `produce` winds down too.
      return reader ? reader.cancel().catch(() => {}) : undefined;
    },
  });
}
