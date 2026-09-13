import { haversine } from './geo.js';
import { validMapPoint } from './map3dCamera.js';

export function cameraFlightDuration(from, to, reducedMotion = false) {
  if (reducedMotion || !validMapPoint(from?.center) || !validMapPoint(to?.center)) return 0;
  const km = haversine(from.center.lat, from.center.lng, to.center.lat, to.center.lng);
  const ratio = Math.max(from.range, to.range) / Math.max(1, Math.min(from.range, to.range));
  if (km > 20 || ratio > 8) return 0;
  if (km < 0.02 && Math.abs(from.range - to.range) < 20 && from.heading === to.heading && from.tilt === to.tilt) return 0;
  return Math.round(900 + 500 * Math.sqrt(km / 20));
}

// Google may emit an old animation-end event after a new destination is chosen.
// Check the target as well as cancelling listeners, so it cannot open the wrong
// card. A bounded fallback also handles interrupted flights and SDK failures.
export function move3DCamera(map, target, { reducedMotion = false, onComplete = () => {} } = {}) {
  let active = true, timer;
  const durationMillis = cameraFlightDuration(map, target, reducedMotion);
  function clean() {
    clearTimeout(timer);
    map.removeEventListener('gmp-animationend', ended);
  }
  function finish() {
    if (!active) return;
    active = false;
    clean();
    onComplete();
  }
  function ended() {
    const c = map.center;
    // The renderer adjusts the target for terrain height. Allow that small
    // correction instead of waiting for the fallback on every hillside.
    if (validMapPoint(c) && haversine(c.lat, c.lng, target.center.lat, target.center.lng) < Math.max(0.03, target.range / 10000)
      && Math.abs(map.range - target.range) < Math.max(20, target.range * 0.1)) finish();
  }
  function snap() {
    if (!active) return;
    Object.assign(map, target);
    finish();
  }
  if (!durationMillis || typeof map.flyCameraTo !== 'function') snap();
  else {
    map.addEventListener('gmp-animationend', ended);
    timer = setTimeout(finish, durationMillis + 1500);
    try { Promise.resolve(map.flyCameraTo({ endCamera: target, durationMillis })).catch(snap); }
    catch { snap(); }
  }
  return () => {
    if (!active) return;
    active = false;
    clean();
    // Stop before the next flight, never after it has already started.
    try { Promise.resolve(map.stopCameraAnimation?.()).catch(() => {}); } catch { /* Removed map. */ }
  };
}
