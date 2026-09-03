'use client';
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

/**
 * A text field that grows with what is written in it.
 *
 * A single-line input hides everything past its right edge, which is fine for a
 * name and wrong for a sentence: you cannot re-read what you just typed, and
 * these fields are where people explain themselves. It starts one line tall and
 * grows to a cap set in CSS, after which it scrolls.
 *
 * Enter always starts a new paragraph. Ctrl/Command+Enter remains available
 * as a desktop shortcut for fields that provide an onSubmit handler.
 */
const GrowArea = forwardRef(function GrowArea(
  { value, onSubmit, onKeyDown, className = 'input', ...rest }, ref,
) {
  const inner = useRef(null);
  useImperativeHandle(ref, () => inner.current, []);

  // Measured, not calculated: reset to auto so scrollHeight reports the height
  // the content wants rather than the height it currently has. The cap comes
  // from CSS, and the bar only appears once the text is actually against it —
  // a permanent scrollbar in a two-line field is just clutter.
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const want = el.scrollHeight;
    el.style.overflowY = want > cap ? 'auto' : 'hidden';
    el.style.height = `${Math.min(want, cap)}px`;
  }, [value]);

  return (
    <textarea
      ref={inner}
      rows={1}
      className={`grow-area ${className}`}
      value={value}
      enterKeyHint="enter"
      onKeyDown={(e) => {
        if (onKeyDown) onKeyDown(e);
        if (!e.defaultPrevented && e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
      {...rest}
    />
  );
});

export default GrowArea;
