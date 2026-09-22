'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Keeps the last thing shown on screen for the length of its exit.
 *
 * A dialog is drawn while there is something to edit — `{draft ? <Modal
 * draft={draft} /> : null}` — so the moment the draft is cleared there is
 * nothing left to draw it from, and it could only vanish. This hands back the
 * last value it was given for `ms` more, flagged as leaving, so the dialog
 * can play its way out with the content it had (usePresence does the same for
 * things that only need to know whether they are open).
 *
 * Returns { value, leaving }: `value` is what to draw (null once it has gone).
 */
export default function useKept(value, ms = 170) {
  const shown = !!value;
  const last = useRef(value || null);
  const [gone, setGone] = useState(!shown);
  if (shown) last.current = value;

  useEffect(() => {
    if (shown) { setGone(false); return undefined; }
    const timer = setTimeout(() => setGone(true), ms);
    return () => clearTimeout(timer);
  }, [shown, ms]);

  if (shown) return { value, leaving: false };
  if (gone || !last.current) return { value: null, leaving: false };
  return { value: last.current, leaving: true };
}
