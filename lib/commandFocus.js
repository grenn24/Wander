export function holdCommandPage(doc) {
  const body = doc.body;
  const root = doc.documentElement;
  const overflow = body.style.overflow;
  const gutter = root.style.scrollbarGutter;
  root.style.scrollbarGutter = 'stable';
  body.style.overflow = 'hidden';
  return () => {
    body.style.overflow = overflow;
    root.style.scrollbarGutter = gutter;
  };
}

// Move only the panel's own scroll position, never the document or viewport.
export function focusCommandField(field) {
  if (!field) return;
  field.focus({ preventScroll: true });
  const panel = field.closest('.ck');
  if (!panel) return;
  const bounds = panel.getBoundingClientRect();
  const input = field.getBoundingClientRect();
  const header = panel.querySelector('.ck-top');
  const top = header && !header.contains(field) ? header.getBoundingClientRect().bottom : bounds.top;
  if (input.bottom > bounds.bottom - 12) panel.scrollTop += input.bottom - bounds.bottom + 12;
  else if (input.top < top) panel.scrollTop -= top - input.top;
}
