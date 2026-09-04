/** Internal identifiers belong in structured operations, never in visible prose. */
export function publicAgentText(value, records = []) {
  let text = String(value || '');
  // Remove labelled references before replacing standalone identifiers.
  text = text.replace(/[\[(]\s*(?:(?:google\s+maps?\s+)?place[ _-]?id|activity[ _-]?id|id)\s*[:=]?\s*[^\])]+[\])]/gi, '');
  text = text.replace(/\b(?:google\s+maps?\s+)?place[ _-]?id\s*[:=]?\s*[`"']?[A-Za-z0-9_-]+[`"']?/gi, 'this place');
  for (const record of records) {
    for (const id of [record.id, record.place_id]) {
      if (id) text = text.split(String(id)).join(record.title || 'this place');
    }
  }
  return text
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 'this activity')
    .replace(/\bplaces\/[A-Za-z0-9_-]+/g, 'this place')
    .replace(/\b(?:ChI|GhI)[A-Za-z0-9_-]{10,}/g, 'this place')
    .replace(/\b0x[0-9a-f]+:0x[0-9a-f]+\b/gi, 'this place')
    .replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.?!;])/g, '$1').trim();
}
