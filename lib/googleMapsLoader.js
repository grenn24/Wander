/** Share a successful load, but let transient script/library failures recover. */
export function createMapsLoader(key, {
  getWindow = () => (typeof window === 'undefined' ? null : window),
  timeoutMs = 20000,
  retryDelayMs = 750,
} = {}) {
  let loader = null;
  let callbackId = 0;

  function attempt(win) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let script;
      let callback;
      let importing = false;
      const timer = setTimeout(() => finish(new Error('Google Maps took too long to load.')), timeoutMs);

      function finish(error, libraries) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (callback) delete win[callback];
        if (script) {
          script.removeEventListener('error', failed);
          if (error) script.remove();
        }
        if (error) reject(error); else resolve(libraries);
      }

      function failed() {
        finish(new Error('Google Maps failed to load. Check your connection and try again.'));
      }

      function ready() {
        if (settled || importing) return;
        importing = true;
        // loading=async needs the API callback, not the script's load event.
        // Catch synchronous import errors as well as rejected library promises.
        Promise.resolve().then(() => Promise.all([
          win.google.maps.importLibrary('core'),
          win.google.maps.importLibrary('maps'),
          win.google.maps.importLibrary('marker'),
        ])).then(([core, maps, marker]) => {
          if (typeof maps.Map !== 'function' || typeof marker.AdvancedMarkerElement !== 'function') {
            throw new Error('Google Maps could not load its map and marker libraries.');
          }
          finish(null, {
            LatLngBounds: core.LatLngBounds,
            event: core.event,
            Map: maps.Map,
            InfoWindow: maps.InfoWindow,
            Polyline: maps.Polyline,
            Polygon: maps.Polygon,
            AdvancedMarkerElement: marker.AdvancedMarkerElement,
          });
        }).catch((error) => finish(error));
      }

      if (win.google?.maps?.importLibrary) {
        ready();
        return;
      }

      callback = `__wanderMapsReady${++callbackId}`;
      win[callback] = ready;
      script = win.document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}`
        + `&loading=async&callback=${callback}&v=weekly&libraries=core,maps,marker`;
      script.async = true;
      script.addEventListener('error', failed);
      win.document.head.appendChild(script);
    });
  }

  return function loadMaps() {
    const win = getWindow();
    if (!win) return Promise.reject(new Error('no window'));
    if (loader) return loader;
    loader = attempt(win).catch(async () => {
      // One shared retry also covers simultaneous mounts and React Strict Mode.
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      return attempt(win);
    }).catch((error) => {
      // Never keep a rejected promise: reopening or Retry must make a new attempt.
      loader = null;
      throw error;
    });
    return loader;
  };
}
