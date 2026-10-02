// Track our own writes before invoking save: its optimistic update can reach
// the editor before the network request resolves. Serial writes also prevent
// an older request from overwriting a newer paragraph on the server.
export function createNotesSync(initial, { save, publish, delay = 700, clock = globalThis }) {
  let text = initial, base = initial, incoming = null, status = '';
  let timer = null, busy = false, due = false, disposed = false;
  const echoes = new Set();
  const emit = () => { if (!disposed) publish({ text, incoming, status }); };
  const cancel = () => { if (timer !== null) clock.clearTimeout(timer); timer = null; due = false; };
  const schedule = () => {
    cancel();
    if (incoming !== null) return;
    timer = clock.setTimeout(() => { timer = null; due = true; void flush(); }, delay);
  };
  async function flush() {
    if (disposed || busy || !due || incoming !== null) return;
    due = false;
    if (text === base) { status = 'Saved'; emit(); return; }
    const value = text;
    busy = true;
    echoes.add(value);
    let success = false;
    try { success = (await save(value)) !== false; } catch { /* Retain the draft for retry. */ }
    if (disposed) return;
    busy = false;
    if (success) {
      base = value;
      // Bounded history recognises delayed realtime echoes of earlier saves.
      if (echoes.size > 32) echoes.delete(echoes.values().next().value);
      status = incoming !== null ? 'Unsaved changes' : text === value ? 'Saved' : 'Saving';
    } else {
      echoes.delete(value);
      status = 'Could not save';
    }
    emit();
    if (due) void flush();
  }
  return {
    change(value) {
      text = value;
      status = incoming !== null ? 'Unsaved changes' : 'Saving';
      schedule(); emit();
    },
    receive(value) {
      if (disposed || value === base || echoes.has(value)) return;
      if (value === text || (text === base && !busy)) {
        cancel(); base = value; text = value; incoming = null; status = ''; emit();
      } else {
        // A genuine remote edit pauses queued autosaves until the user chooses.
        cancel(); incoming = value; status = 'Unsaved changes'; emit();
      }
    },
    useTheirs() {
      if (incoming === null) return;
      cancel(); base = incoming; text = incoming; incoming = null; status = '';
      // An already-sent write cannot be cancelled. Reapply the user's chosen
      // text after it completes rather than letting that older write win.
      if (busy) { status = 'Saving'; schedule(); }
      emit();
    },
    keepMine() {
      if (incoming === null) return;
      base = incoming; incoming = null; status = 'Saving'; schedule(); emit();
    },
    retry() { status = 'Saving'; schedule(); emit(); },
    dispose() { disposed = true; cancel(); },
  };
}
