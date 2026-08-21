'use client';
import { useEffect, useRef } from 'react';

/**
 * Shared modal behaviour: Escape to dismiss, Cmd/Ctrl+Enter to submit, the page
 * behind held still, and focus handed back to whatever opened the modal.
 * Handlers are read through a ref so a draft that changes on every keystroke
 * does not re-bind the listener each time.
 */
export function useModalChrome({ onEscape, onSubmit }) {
  const handlers = useRef({ onEscape, onSubmit });
  handlers.current = { onEscape, onSubmit };

  useEffect(() => {
    const opener = document.activeElement;
    const { body } = document;
    const prevOverflow = body.style.overflow;
    body.style.overflow = 'hidden';

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
      if (opener && opener.focus) { try { opener.focus(); } catch (e) { /* gone */ } }
    };
  }, []);
}
