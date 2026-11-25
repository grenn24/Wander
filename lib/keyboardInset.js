/**
 * How much of the bottom of the window an on-screen keyboard is covering, in
 * pixels, or 0 when there is none.
 *
 * On iOS Safari, and on Chrome for Android since it stopped resizing the page
 * for the keyboard, the keyboard shrinks only the visual viewport. The layout
 * viewport, which `position: sticky; bottom: 0` and `position: fixed` measure
 * from, still runs to the foot of the screen, underneath the keyboard. The
 * distance from the bottom of what can be seen to the bottom of the layout
 * viewport is how far a bar pinned to the bottom has to rise to be seen.
 *
 * Only counted while something that takes typing has focus, as nothing else
 * raises a keyboard, and not while pinch-zoomed in, where the visible region
 * is small because it has been magnified rather than covered. A gap of tens
 * of pixels is the browser's own toolbar (ViewportInsets deals with that); a
 * keyboard is hundreds.
 */
export const KEYBOARD_MIN = 140;

export function keyboardInset({ innerHeight, height, offsetTop = 0, scale = 1, editing }) {
  if (!editing || !(innerHeight > 0) || !(height > 0)) return 0;
  if (scale > 1.01) return 0;
  const gap = innerHeight - height - offsetTop;
  return gap > KEYBOARD_MIN ? Math.round(gap) : 0;
}

const NOT_TYPED = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit']);

/** Whether this element, focused, brings up a keyboard. */
export function takesTyping(el) {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return !el.readOnly && !el.disabled;
  if (tag === 'INPUT') return !NOT_TYPED.has(String(el.type || 'text').toLowerCase()) && !el.readOnly && !el.disabled;
  return false;
}
