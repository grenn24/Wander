/**
 * Reads JSON that has not finished arriving.
 *
 * A streamed response is a valid document cut off mid-write. Rather than guess
 * at the truncated tail, this rewinds to the last structure that actually
 * closed — outside of any string — and shuts the still-open brackets above it.
 * The result is always real JSON containing only complete values, so callers
 * never see a half-written activity.
 *
 * Returns null until there is at least one complete structure to report.
 */
export function parsePartial(src) {
  let inString = false;
  let escaped = false;
  const open = [];
  let cutAt = -1;
  let cutOpen = null;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];

    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }

    if (c === '"') { inString = true; continue; }

    if (c === '{') open.push('}');
    else if (c === '[') open.push(']');
    else if (c === '}' || c === ']') {
      open.pop();
      // A complete value ends here — a safe place to rewind to.
      cutAt = i;
      cutOpen = open.slice();
    }
  }

  if (cutAt < 0) return null;

  const closers = (cutOpen || []).slice().reverse().join('');
  try {
    return JSON.parse(src.slice(0, cutAt + 1) + closers);
  } catch (e) {
    return null;
  }
}
