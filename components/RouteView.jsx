'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Loader2, Footprints, TrainFront, Car, LocateFixed, Navigation,
  ExternalLink, MapPin,
} from 'lucide-react';
import GoogleMap, { googleMapsAvailable, catColor } from '@/components/GoogleMap';
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
  const [follow, setFollow] = useState(false); // map staying under you
  const [heading, setHeading] = useState(null); // which way you are facing
  const [turns, setTurns] = useState(false); // whether this map can face it
  const [legs, setLegs] = useState({}); // mode -> result
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

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

  /*
   * The compass, which on iOS may only be asked for from inside the gesture
   * that wants it — so this is called from the click handler and nowhere else.
   * Everywhere else the events simply arrive, and the ones that never arrive
   * cost nothing.
   */
  function askCompass() {
    if (!turns) return; // nothing would come of it
    const D = typeof DeviceOrientationEvent !== 'undefined' ? DeviceOrientationEvent : null;
    if (D && typeof D.requestPermission === 'function') {
      D.requestPermission().catch(() => {});
    }
  }

  function locate() {
    askCompass();
    setFollow(true);
    ask();
  }

  /*
   * While following, the position is watched rather than asked for once: the
   * point of the blue state is that the map keeps up with you, and a single
   * fix goes stale the moment you start walking.
   */
  useEffect(() => {
    if (!follow || typeof navigator === 'undefined' || !navigator.geolocation) return undefined;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setMine({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setWhere('got');
      },
      (e) => { setWhere(e && e.code === 1 ? 'refused' : 'off'); setFollow(false); },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [follow]);

  /*
   * Which way the phone is pointing. iOS reports true north directly;
   * everywhere else it is the absolute alpha angle, counted the other way
   * round. Either is then corrected for a phone held sideways, because the
   * sensor answers about the device and the map is drawn on the screen.
   *
   * Ignored below a couple of degrees: a hand is never quite still, and a map
   * that trembles is harder to read than one that lags.
   */
  useEffect(() => {
    if (!follow || !turns) { setHeading(null); return undefined; }
    const on = (e) => {
      let h = null;
      if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha;
      if (h == null || !Number.isFinite(h)) return;
      const screen = (window.screen && window.screen.orientation
        && window.screen.orientation.angle) || 0;
      const at = (h + screen + 360) % 360;
      setHeading((was) => {
        if (was == null) return at;
        const off = Math.abs((((at - was) % 360) + 540) % 360 - 180);
        return off >= 2 ? at : was;
      });
    };
    const type = 'ondeviceorientationabsolute' in window
      ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(type, on);
    return () => window.removeEventListener(type, on);
  }, [follow, turns]);

  // Your position if the phone gave one, the place you are standing in
  // otherwise, and nothing at all if neither.
  const from = mine || (where !== 'asking' && fallback ? fallback : null);
  const guessed = !mine && !!from;

  /*
   * Transit is asked for from now: in greater Tokyo the answer comes from the
   * timetable, and the train to catch is the next one, not a typical one.
   * Google ignores it, answering from now anyway.
   */
  useEffect(() => {
    if (!from || legs[mode]) return undefined;
    let alive = true;
    setBusy(true); setErr('');
    routeBetween(from, to, mode, { now: mode === 'TRANSIT' })
      .then((r) => { if (alive) setLegs((v) => ({ ...v, [mode]: r })); })
      .catch(() => { if (alive) setErr('Could not work out a route just now.'); })
      .finally(() => { if (alive) setBusy(false); });
    return () => { alive = false; };
  }, [from, to, mode, legs]);

  const leg = legs[mode];
  const nowhere = where !== 'asking' && !from;
  const dest = useMemo(() => [{
    id: 'to', lat: to.lat, lng: to.lng, day: 'to', title, category: 'sightseeing',
  }], [to.lat, to.lng, title]);
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
            /* A fresh array every render is a redraw every render, and this
               screen re-renders on every position fix. */
            stops={dest}
            places={[]}
            focused={null}
            focusedPlace={null}
            stopColour={() => catColor('sightseeing')}
            path={path}
            here={mine}
            follow={follow}
            heading={heading}
            onFollowBreak={() => setFollow(false)}
            onRotatable={setTurns}
            gestures="greedy"
          />
        ) : null}

        {/* Bottom right of the map, where every map keeps this button — the
            words live in the tooltip, because a control this well known does
            not need them and the map has better uses for the space.

            Always there, in both of its states: lit while the map is yours to
            stand in the middle of, plain the moment you take the map back. */}
        <button className={`rv-locate${follow ? ' is-on' : ''}`} type="button"
          onClick={locate} aria-pressed={follow}
          data-tip={follow ? 'Following you'
            : where === 'refused' ? 'Allow location first' : 'Use my location'}
          aria-label="Use my location">
          {where === 'asking' && !mine ? <Loader2 size={17} className="spin" />
            : follow && heading != null ? <Navigation size={17} />
              : <LocateFixed size={17} />}
        </button>
      </div>

      <footer className="rv-foot">
        {where === 'asking' && !from ? (
          <p className="rv-note"><LocateFixed size={14} /> Finding where you are</p>
        ) : nowhere ? (
          <p className="rv-note">No starting point.</p>
        ) : busy ? (
          <p className="rv-note"><Loader2 size={14} className="spin" /> Working out the route</p>
        ) : err ? (
          <p className="rv-note">{err}</p>
        ) : leg && !leg.found ? (
          <p className="rv-note">{leg.source === 'timetable'
            ? 'No more trains from here today.'
            : `No ${WAYS.find((w) => w.id === mode).label.toLowerCase()} route between here and there.`}</p>
        ) : leg ? (
          <p className="rv-said">
            <b>{fmtDuration(Math.round(leg.seconds / 60)) || 'Under a minute'}</b>
            <span className="dim"> · {fmtKm(leg.metres / 1000)}</span>
            {/* Said out loud, because a time measured from the wrong place is
                worth having and not worth mistaking for the right one. */}
            {guessed ? (
              <span className="rv-from">from {fallbackName || 'where you were'}</span>
            ) : null}
            {/* From a timetable, each train says when it leaves, and a train
                that runs on as another line says to stay on it. */}
            {leg.lines.length ? (
              <span className="rv-lines">
                {leg.lines.map((l) => (
                  <span className="rv-line" key={l.name + l.from}
                    data-tip={l.departs ? (l.through ? `Same train, on from ${l.from}` : `From ${l.from} at ${l.departs}`) : undefined}>
                    {l.name}
                    {l.departs && !l.through ? <span className="mono"> {l.departs}</span> : null}
                  </span>
                ))}
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
