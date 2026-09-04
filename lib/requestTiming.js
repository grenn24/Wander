// Only stage names and durations: no prompts, booking details or user IDs.
export function requestTiming(now = () => performance.now(), log = console.info) {
  const started = now();
  const durations = {};
  return {
    async measure(stage, work) {
      const start = now();
      try { return await work(); }
      finally { durations[stage] = Math.max(0, now() - start); }
    },
    finish(response) {
      durations.total = Math.max(0, now() - started);
      const values = Object.entries(durations).map(([stage, ms]) => `${stage};dur=${ms.toFixed(1)}`);
      response.headers.set('Server-Timing', values.join(', '));
      log('[command timing]', values.join(' '));
      return response;
    },
  };
}
