'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Footprints, TrainFront, Car, LocateFixed, ExternalLink, MapPin,
} from 'lucide-react';
import GoogleMap, { googleMapsAvailable, catColor, useMapScheme } from '@/components/GoogleMap';
import { routeBetween, decodePath, fmtKm } from '@/lib/geo';
import { fmtDuration } from '@/lib/util';

/**
 * The way there, on this app's own map.
 *
 * Handing straight over to Google Maps answered the question but took the trip
 * with it: you left, and coming back meant finding your way to the right day
 * of the right trip again. The thing actually being asked is usually "how far
 * is this and how long will it take" — which is a picture and two numbers, and
 * both belong here.
 *
 * What does not belong here is turn-by-turn. That needs your position ten
 * times a second and a voice, and it is what a navigation app is; the hand-off
 * stays, as a deliberate last step rather than the first one.
 */

const WAYS = [
  { id: 'WALK', label: 'Walk', icon: Footprints },
  { id: 'TRANSIT', label: 'Transit', icon: TrainFront },
  { id: 'DRIVE', label: 'Drive', icon: Car },
];

/**
 * `fallback` is where the route starts from when the phone will not say: the
 * activity you are in the middle of. It is a worse answer than your actual
 * position and a far better one than nothing, because at the moment you ask
 * for directions you are usually still at the last place.
 */
export default function RouteView({ to, title, fallback, fallbackName, onClose }) {
  const [mode, setMode] = useState('WALK');
  const [mine, setMine] = useState(null); // the phone's answer, if it gives one
  const [where, setWhere] = useState('asking'); // asking | got | refused | off
  const [legs, setLegs] = useState({}); // mode -> result
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scheme = useMapScheme();

  /*
   * Where you are, asked for the moment this opens — which is the one moment
   * the request explains itself, because the screen it appears over is a
   * screen about getting somewhere.
   *
   * Asked again on demand, because the first ask can be dismissed by accident
   * and a browser that has been told no once will never prompt again on its
   * own. The button is the only way back from that, so there is a button.
   */
  const ask = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setWhere('off');
      return;
    }
    setWhere('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMine({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setWhere('got');
      },
      (e) => setWhere(e && e.code === 1 ? 'refused' : 'off'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => { ask(); }, [ask]);

  // Your position if the phone gave one, the place you are standing in
  // otherwise, and nothing at all if neither.
  const from = mine || (where !== 'asking' && fallback ? fallback : null);
  const guessed = !mine && !!from;

  useEffect(() => {
    if (!from || legs[mode]) return undefined;
    let alive = true;
    setBusy(true); setErr('');
    routeBetween(from, to, mode)
      .then((r) => { if (alive) setLegs((v) => ({ ...v, [mode]: r })); })
      .catch(() => { if (alive) setErr('Could not work out a route just now.'); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [from, to, mode, legs]);

  const leg = legs[mode];
  const nowhere = where !== 'asking' && !from;
  const path = useMemo(
    () => (leg && leg.polyline ? decodePath(leg.polyline) : null),
    [leg],
  );

  const maps = `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`
    + `&travelmode=${mode.toLowerCase()}`;

  return createPortal((
    <div className="rv">
      <header className="rv-top">
        <span className="rv-title">{title}</span>
        <button className="btn ghost sm icon-btn" type="button"
          data-tip="Close  Esc" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </header>

      <div className="rv-ways" role="group" aria-label="How to travel">
        {WAYS.map((w) => {
          const got = legs[w.id];
          return (
            <button key={w.id} type="button" className="btn sm" aria-pressed={mode === w.id}
              onClick={() => setMode(w.id)}>
              <w.icon size={14} aria-hidden="true" />
              {w.label}
              {got && got.found ? (
                <b className="rv-when mono">{fmtDuration(Math.round(got.seconds / 60))}</b>
              ) : null}
            </button>
          );
        })}
      </div>

      {/* No origin at all means no route to draw — say that once, plainly,
          rather than showing an empty map with a spinner over it. */}
      <div className="rv-map">
        {nowhere ? (
          <p className="rv-nowhere">
            <MapPin size={20} aria-hidden="true" />
            Nothing to measure from — turn location on, or give the activity you
            are at now a place of its own.
          </p>
        ) : googleMapsAvailable() ? (
          <GoogleMap
            key={scheme}
            stops={[{
              id: 'to', lat: to.lat, lng: to.lng, day: 'to', title, category: 'sightseeing',
            }]}
            places={[]}
            focused={null}
            focusedPlace={null}
            stopColour={() => catColor('sightseeing')}
            path={path}
            here={mine}
            gestures="greedy"
          />
        ) : null}

        {/* Bottom right of the map, where every map keeps this button — the
            words live in the tooltip, because a control this well known does
            not need them and the map has better uses for the space. */}
        {where !== 'got' ? (
          <button className="rv-locate" type="button" onClick={ask}
            disabled={where === 'asking'}
            data-tip={where === 'refused' ? 'Allow location first' : 'Use my location'}
            aria-label="Use my location">
            {where === 'asking'
              ? <Loader2 size={17} className="spin" />
              : <LocateFixed size={17} />}
          </button>
        ) : null}
      </div>

      <footer className="rv-foot">
        {where === 'asking' && !from ? (
          <p className="rv-note"><LocateFixed size={14} /> Finding where you are…</p>
        ) : nowhere ? (
          <p className="rv-note">No starting point.</p>
        ) : busy ? (
          <p className="rv-note"><Loader2 size={14} className="spin" /> Working out the route…</p>
        ) : err ? (
          <p className="rv-note">{err}</p>
        ) : leg && !leg.found ? (
          <p className="rv-note">No {WAYS.find((w) => w.id === mode).label.toLowerCase()} route
            {' '}between here and there.</p>
        ) : leg ? (
          <p className="rv-said">
            <b>{fmtDuration(Math.round(leg.seconds / 60)) || 'Under a minute'}</b>
            <span className="dim"> · {fmtKm(leg.metres / 1000)}</span>
            {/* Said out loud, because a time measured from the wrong place is
                worth having and not worth mistaking for the right one. */}
            {guessed ? (
              <span className="rv-from">from {fallbackName || 'where you were'}</span>
            ) : null}
            {leg.lines.length ? (
              <span className="rv-lines">
                {leg.lines.map((l) => <span className="rv-line" key={l.name + l.from}>{l.name}</span>)}
              </span>
            ) : null}
          </p>
        ) : null}

        <a className="btn primary rv-go" href={maps} target="_blank" rel="noreferrer">
          <ExternalLink size={15} /> Navigate
        </a>
      </footer>
    </div>
  ), document.body);
}
