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

export const RELOADED_KEY = 'wander:chunk-reloaded';
// A second failure inside this window means a reload did not help.
export const RELOAD_WINDOW_MS = 30000;

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

/*
 * Stylesheets fail without a sound.
 *
 * A JavaScript chunk that will not load throws, and the code above catches it.
 * A stylesheet that will not load throws nothing: the browser shrugs and draws
 * the page with no styles at all, every icon and photo stacked down the left
 * in Times New Roman. It happened on production 19 seconds after a deploy went
 * live (2026-11-22): the page came from the new build, and its stylesheets were
 * asked for while the old one was still answering, which has no such files.
 *
 * So the first script in <body> checks. A browser does not run an inline script
 * until the stylesheets above it have loaded or failed, so by then every one in
 * <head> has settled. Ones added later (a route's own CSS, on a client-side
 * navigation) report through the error event.
 * A failed one is put back in its own place to be fetched again, a few times
 * over a few seconds, which is usually enough for a deploy to settle. If it
 * still will not come, the page reloads, sharing reloadOnce's memory so that a
 * stylesheet and a chunk cannot take turns reloading it forever.
 *
 * It is serialized into the page, so it must not use anything from this module:
 * the reload key and window arrive as arguments.
 */
export function installStylesheetRescue(reloadKey, reloadWindowMs) {
  const RETRIES = 4;
  const tries = new Map();
  const seen = new WeakSet();

  // Only the app's own built stylesheets. One from another site, or one an
  // extension put in, is not ours to retry or to reload the page over.
  const ours = (link) => {
    try {
      const url = new URL(link.href, location.href);
      return url.origin === location.origin && url.pathname.startsWith('/_next/static/');
    } catch (e) {
      return false;
    }
  };

  // Settled, and nothing came of it. Firefox leaves a failed stylesheet with no
  // sheet; Chrome gives it an empty one. A built stylesheet is never empty, but
  // an empty one only counts as failed if its response was not a success.
  const failed = (link) => {
    const sheet = link.sheet;
    if (!sheet) return true;
    try {
      if (sheet.cssRules.length > 0) return false;
    } catch (e) {
      return false;
    }
    const entry = performance.getEntriesByName(link.href).pop();
    return !(entry && entry.responseStatus >= 200 && entry.responseStatus < 300);
  };

  const reload = () => {
    if (navigator.onLine === false) {
      // A reload now would trade an unstyled page for the browser's offline one.
      window.addEventListener('online', reload, { once: true });
      return;
    }
    try {
      const last = Number(sessionStorage.getItem(reloadKey) || 0);
      if (Date.now() - last < reloadWindowMs) return;
      sessionStorage.setItem(reloadKey, String(Date.now()));
    } catch (e) {
      return;
    }
    location.reload();
  };

  const retry = (link) => {
    // The check below can find a stylesheet failed and then hear its error event
    // too, which the browser may only get round to dispatching after this runs.
    if (seen.has(link)) return;
    seen.add(link);
    // Counted by address, because each attempt is a fresh element.
    const n = tries.get(link.href) || 0;
    if (n >= RETRIES) { reload(); return; }
    tries.set(link.href, n + 1);
    setTimeout(() => {
      // A copy in the same place: same address, same order in the cascade, and
      // a new element is always fetched, where moving the old one may not be.
      if (!link.parentNode) return;
      const fresh = link.cloneNode();
      // A failure arrives as an error event, caught below; this is for a
      // browser that calls an empty answer a load.
      fresh.addEventListener('load', () => { if (failed(fresh)) retry(fresh); });
      link.parentNode.replaceChild(fresh, link);
    }, 500 * 2 ** n);
  };

  window.addEventListener('error', (event) => {
    const el = event.target;
    if (el && el.tagName === 'LINK' && el.rel === 'stylesheet' && ours(el)) retry(el);
  }, true);

  document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
    if (ours(link) && failed(link)) retry(link);
  });
}

export const stylesheetRescueScript = `(${installStylesheetRescue.toString()})(${JSON.stringify(RELOADED_KEY)}, ${RELOAD_WINDOW_MS});`;
