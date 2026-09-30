/*
 * When a piece of the app cannot be fetched.
 *
 * The app is split into chunks that load as they are needed, and any one of
 * those requests can fail on its own: a dropped connection, a TLS hiccup, or a
 * page left open across a deploy, whose chunks are no longer on the server.
 * Left alone, a single failed chunk throws while React is rendering and takes
 * the whole page with it ("Application error: a client-side exception").
 *
 * Two things follow. A chunk that failed is worth asking for again, because
 * most failures are momentary. And when it still will not come, the person
 * should be told and offered a reload rather than left with a blank page.
 */

const CHUNK_MESSAGE = /loading (css )?chunk [^ ]+ failed|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|unable to preload css/i;

/** Is this the failure of a lazily loaded chunk, and not a bug in the code? */
export function isChunkError(error) {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return CHUNK_MESSAGE.test(String(error.message || error));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a dynamic import, and run it again if its chunk failed to load. Webpack
 * forgets a chunk that failed, so the next import() asks the network afresh.
 * Anything but a chunk failure is a real error and is thrown at once.
 */
export async function retryImport(load, { retries = 2, wait = 500 } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await load();
    } catch (e) {
      if (attempt >= retries || !isChunkError(e)) throw e;
      await pause(wait * (attempt + 1));
    }
  }
}

const RELOADED_KEY = 'wander:chunk-reloaded';
// A second failure inside this window means a reload did not help.
const RELOAD_WINDOW_MS = 30000;

/**
 * Reload the page once to pick up a fresh set of chunks. Returns false, and does
 * nothing, if it already did so a moment ago (so a page that cannot be fixed by
 * reloading does not reload forever) or if it cannot remember that it did.
 */
export function reloadOnce(now = Date.now()) {
  try {
    const last = Number(sessionStorage.getItem(RELOADED_KEY) || 0);
    if (now - last < RELOAD_WINDOW_MS) return false;
    sessionStorage.setItem(RELOADED_KEY, String(now));
  } catch (e) {
    return false;
  }
  window.location.reload();
  return true;
}
