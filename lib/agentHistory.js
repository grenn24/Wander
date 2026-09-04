export function mergeAgentHistory(saved, pending) {
  const messages = new Map(saved.map((row) => [row.id, row]));
  for (const row of pending) if (!messages.has(row.id)) messages.set(row.id, row);
  return [...messages.values()]
    .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || ''))).slice(-60);
}
