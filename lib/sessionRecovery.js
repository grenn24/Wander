// Reads may be replayed after an expired JWT. Never use this helper for writes.
const refreshes = new WeakMap();

export function isSessionTokenError(error) {
  if (!error || error.code === '42501') return false; // RLS is not token expiry.
  return ['PGRST301', 'PGRST303'].includes(error.code)
    || /jwt (?:expired|invalid)|invalid jwt|jwt has expired/i.test(error.message || '');
}

async function currentSession(client) {
  const { data, error } = await client.auth.getSession();
  if (error) throw error; // A network failure must not become an anonymous read.
  if (!data?.session) throw new Error('Please sign in to continue.');
  return data.session;
}

function renewRejectedSession(client, rejectedToken) {
  if (refreshes.has(client)) return refreshes.get(client);
  const work = (async () => {
    const current = await currentSession(client);
    // The SDK or another tab may already have renewed the rejected token.
    if (current.access_token !== rejectedToken) return current;
    const { data, error } = await client.auth.refreshSession();
    if (error) throw error;
    if (!data?.session) throw new Error('Please sign in to continue.');
    return data.session;
  })().finally(() => refreshes.delete(client));
  refreshes.set(client, work);
  return work;
}

export async function readWithSessionRecovery(client, read) {
  const session = await currentSession(client);
  let result;
  try { result = await read(); }
  catch (error) {
    if (!isSessionTokenError(error)) throw error;
    result = { error };
  }
  const results = Array.isArray(result) ? result : [result];
  if (!results.some((item) => isSessionTokenError(item?.error))) return result;
  const renewed = await renewRejectedSession(client, session.access_token);
  if (renewed.user?.id !== session.user?.id) throw new Error('Your account changed. Please try again.');
  return read(); // One retry only; a persistent rejection stays visible.
}

/** Restore on mobile resume, bfcache return and reconnect without remounting editors. */
export function observeSession(client, { onSession, onError, onRecovered, windowTarget, documentTarget }) {
  let disposed = false;
  let revision = 0;
  let pending = null;
  const timers = new Set();
  // Subscribe before the first read so a concurrent sign-out cannot be missed.
  const { data } = client.auth.onAuthStateChange((event, session) => {
    // getSession below owns initial errors; INITIAL_SESSION null can also mean
    // an offline refresh failed, not that the user signed out.
    if (event === 'INITIAL_SESSION' || disposed) return;
    const mine = ++revision;
    // Auth callbacks run inside the SDK's lock. Calendar handoff and other
    // consumers must run after that callback has returned.
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!disposed && mine === revision) onSession(session || null);
    }, 0);
    timers.add(timer);
  });

  function recover() {
    if (disposed) return Promise.resolve();
    if (pending) return pending;
    const mine = revision;
    pending = (async () => {
      try {
        const { data: state, error } = await client.auth.getSession();
        if (disposed || mine !== revision) return;
        if (error) throw error;
        onSession(state?.session || null);
      } catch (error) {
        if (!disposed && mine === revision) onError(error);
      }
    })().finally(() => {
      pending = null;
      if (!disposed) onRecovered?.();
    });
    return pending;
  }
  const resume = () => {
    if (documentTarget?.visibilityState !== 'hidden') recover();
  };
  documentTarget?.addEventListener('visibilitychange', resume);
  for (const event of ['pageshow', 'online', 'focus']) windowTarget?.addEventListener(event, resume);
  recover();
  return {
    recover,
    dispose() {
      disposed = true;
      data.subscription.unsubscribe();
      timers.forEach(clearTimeout);
      documentTarget?.removeEventListener('visibilitychange', resume);
      for (const event of ['pageshow', 'online', 'focus']) windowTarget?.removeEventListener(event, resume);
    },
  };
}
