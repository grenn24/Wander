'use client';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Footprints, TrainFront, Car, LocateFixed, ExternalLink, TriangleAlert,
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

export default function RouteView({ to, title, onClose }) {
  const [mode, setMode] = useState('WALK');
  const [from, setFrom] = useState(null);
  const [where, setWhere] = useState('asking'); // asking | got | denied
  const [legs, setLegs] = useState({}); // mode -> result
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const scheme = useMapScheme();

  /*
   * Where you are, asked for once and only here. The rest of the app never
   * needs it — a route is the one question that cannot be answered without it,
   * and asking on a screen that has just been opened for directions is the one
   * moment the request explains itself.
   */
  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setWhere('denied');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setFrom({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setWhere('got');
      },
      () => setWhere('denied'),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, []);

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

      <div className="rv-map">
        {googleMapsAvailable() ? (
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
            here={from}
            gestures="greedy"
          />
        ) : null}
      </div>

      <footer className="rv-foot">
        {where === 'asking' ? (
          <p className="rv-note"><LocateFixed size={14} /> Finding where you are…</p>
        ) : where === 'denied' ? (
          <p className="rv-note">
            <TriangleAlert size={14} />
            Wander needs your location to measure the way there. You can still open it below.
          </p>
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
