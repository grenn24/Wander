// Independent reads can overlap; preserve input order for deterministic merges.
export async function mapConcurrent(items, limit, work) {
  const results = new Array(items.length);
  let next = 0;
  let failed = false;
  async function worker() {
    while (!failed && next < items.length) {
      const index = next++;
      try { results[index] = await work(items[index], index); }
      catch (error) { failed = true; throw error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// History writes depend on one another, but need not block the UI or AI call.
export function createSerialQueue() {
  let tail = Promise.resolve();
  return (work) => {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  };
}
