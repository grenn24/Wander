'use client';
import { useCallback, useEffect, useState } from 'react';
import { X } from 'lucide-react';

// Long enough to read as leaving, short enough that a queue still clears.
const EXIT = 200;

export default function Toasts({ items, onDismiss }) {
  if (!items.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {items.map((t) => <Toast key={t.id} toast={t} onDismiss={onDismiss} />)}
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  const { id, action, kind } = toast;
  /*
   * A toast asks to leave before it is removed. The provider drops it from the
   * list the moment onDismiss runs, so calling that straight from the timer
   * meant it could only ever vanish — the exit has to happen here, while it
   * still exists, and the removal comes after.
   */
  const [leaving, setLeaving] = useState(false);
  const close = useCallback(() => setLeaving(true), []);

  useEffect(() => {
    // Undo needs a longer window than a plain confirmation does.
    const ms = action ? 9000 : kind === 'error' ? 7000 : 4000;
    const timer = setTimeout(close, ms);
    return () => clearTimeout(timer);
  }, [action, kind, close]);

  useEffect(() => {
    if (!leaving) return undefined;
    const timer = setTimeout(() => onDismiss(id), EXIT);
    return () => clearTimeout(timer);
  }, [leaving, id, onDismiss]);

  return (
    <div className={`toast${kind === 'error' ? ' error' : ''}`}
      data-state={leaving ? 'exit' : 'enter'}>
      <span className="toast-msg">{toast.message}</span>
      {action ? (
        <button className="toast-action" type="button"
          onClick={() => { action.run(); close(); }}>{action.label}</button>
      ) : null}
      <button className="toast-x" type="button" aria-label="Dismiss"
        onClick={close}><X size={14} /></button>
    </div>
  );
}
