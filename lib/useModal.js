'use client';
import { useEffect, useRef } from 'react';

/**
 * Shared modal behaviour: Escape to dismiss, Cmd/Ctrl+Enter to submit, the page
 * behind held still, and focus handed back to whatever opened the modal.
 * Handlers are read through a ref so a draft that changes on every keystroke
 * does not re-bind the listener each time.
 */
/*
 * How many dialogs are holding the page still. A dialog opened from a dialog
 * (a confirmation over an editor) must not let the page go when it closes.
 * While any is open the page keeps the width its scrollbar had, so nothing
 * shifts under them (html[data-locked] in globals.css); the rest of the time
 * the page runs to the edge of the window.
 */
let locks = 0;

export function useModalChrome({ onEscape, onSubmit }) {
  const handlers = useRef({ onEscape, onSubmit });
  handlers.current = { onEscape, onSubmit };

  useEffect(() => {
    const opener = document.activeElement;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    // Only where there is a scrollbar to lose, and asked before it is taken
    // away: a page that does not scroll has no width to keep, and reserving
    // it would be the shift itself.
    const held = window.innerWidth - document.documentElement.clientWidth > 0;
    body.style.overflow = 'hidden';
    if (held) {
      locks += 1;
      document.documentElement.dataset.locked = '';
    }

    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (handlers.current.onEscape) handlers.current.onEscape();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (handlers.current.onSubmit) handlers.current.onSubmit();
      }
    }

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      body.style.overflow = prevOverflow;
      if (held) {
        locks = Math.max(0, locks - 1);
        if (!locks) delete document.documentElement.dataset.locked;
      }
      if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* gone */ } }
    };
  }, []);
}
