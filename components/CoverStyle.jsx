'use client';
import { useRef } from 'react';
import GrowArea from '@/components/GrowArea';
import { COVER_STYLE_LONGEST, DEFAULT_COVER_STYLE } from '@/lib/coverPrompt';

// What the field would draw with if left empty, worded as a value.
const DEFAULT_LOOK = DEFAULT_COVER_STYLE.charAt(0).toUpperCase() + DEFAULT_COVER_STYLE.slice(1);

/*
 * The style typed for a drawn cover.
 *
 * It is a sentence, so it wraps and grows rather than scrolling out of sight
 * sideways: you can read what you have written. Two lines tall to begin with,
 * because the placeholder — the whole default look — is longer than a phone is
 * wide, and a textarea does not shorten a placeholder with an ellipsis the way
 * an input does.
 *
 * Enter draws on a computer, and starts a new line on a phone, where a draw
 * costs real money and Enter is where a thumb lands (see GrowArea). A new line
 * is harmless: the server folds it into a space (lib/coverPrompt.js). Cmd/Ctrl
 * + Enter is the dialog's Save, so it must not also draw.
 */
export default function CoverStyle({ id, value, onChange, onDraw }) {
  const saving = useRef(false);
  return (
    <GrowArea id={id} value={value} rows={2} maxLength={COVER_STYLE_LONGEST}
      placeholder={DEFAULT_LOOK} autoComplete="off"
      onChange={(event) => onChange(event.target.value)}
      // GrowArea calls this just before it decides whether Enter submits, so
      // what it records is what onSubmit reads.
      onKeyDown={(event) => { saving.current = event.metaKey || event.ctrlKey; }}
      onSubmit={() => { if (!saving.current) onDraw(); }} />
  );
}
