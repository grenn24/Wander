/**
 * Whether the traveller explicitly forbids suggestions beyond their list:
 * "ONLY these places", "nothing else". The planner then drops everything they
 * did not ask for (app/api/plan/route.js), and the app adds no flights.
 */
export function hasExclusiveScope(text) {
  const value = String(text || '');
  return /\bONLY\b/.test(value)
    || /\b(?:only|just)\s+(?:these|those|the\s+(?:following|listed|named))\b/i.test(value)
    || /\b(?:these|those|following|listed|named)\s+(?:places|activities|stops)?\s*only\b/i.test(value)
    || /\b(?:nothing|nowhere)\s+else\b/i.test(value)
    || /\bno\s+(?:other|extra|additional)\s+(?:activities|places|stops|suggestions)\b/i.test(value)
    || /\bdo(?:n't|\s+not)\s+(?:add|include|suggest|plan)\s+(?:anything|activities|places|stops)\b/i.test(value);
}
