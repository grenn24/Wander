'use client';
import { useEffect } from 'react';

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

  useEffect(() => {
    // Undo needs a longer window than a plain confirmation does.
    const ms = action ? 9000 : kind === 'error' ? 7000 : 4000;
    const timer = setTimeout(() => onDismiss(id), ms);
    return () => clearTimeout(timer);
  }, [id, action, kind, onDismiss]);

  return (
    <div className={`toast${kind === 'error' ? ' error' : ''}`}>
      <span className="toast-msg">{toast.message}</span>
      {action ? (
        <button className="toast-action" type="button"
          onClick={() => { action.run(); onDismiss(id); }}>{action.label}</button>
      ) : null}
      <button className="toast-x" type="button" aria-label="Dismiss"
        onClick={() => onDismiss(id)}>✕</button>
    </div>
  );
}
