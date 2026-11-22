'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, ArrowLeft, Car, Check, ChevronDown, Clock, Compass, Copy, Footprints, Globe,
  Loader2, LocateFixed, MapPin, Navigation, PersonStanding, Phone, Plus, SquarePen, TrainFront,
} from 'lucide-react';
import PlaceFacts, { Stars } from '@/components/PlaceFacts';
import PlacePhoto from '@/components/PlacePhoto';
import Select from '@/components/Select';
import { routeBetween, decodePath, haversine, fmtKm } from '@/lib/geo';
import {
  WEEKDAYS, describeOpen, dayHours, openOn, openState, placeNow, weekdayOf,
} from '@/lib/openingHours';
import { fmtDuration, fmtTime, money, sortActs } from '@/lib/util';
import x from './MapExplorer.module.css';

/*
 * A place, the way a map app describes one: its pictures, what it is, whether
 * it is open, how to reach it and what people made of it — beside the map it
 * is on, so nothing about it needs a trip out to Google Maps.
 *
 * Everything comes from one Place Details call (lib/places), asked for when
 * the place is opened and never before. A stop in the plan says when it is
 * planned, and whether the place is open then.
 */

const photoUrl = (ref, w) => `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

const PRICE_WORDS = ['Free', 'Inexpensive', 'Moderate', 'Expensive', 'Very expensive'];

/** ¥1,000–2,000, or the level in words where Google has no range. */
function priceOf(d) {
  if (!d) return '';
  const r = d.priceRange;
  if (r && r.from != null && r.currency) {
    return r.to != null ? `${money(r.from, r.currency)}–${Number(r.to).toLocaleString()}` : `${money(r.from, r.currency)}+`;
  }
  return d.price != null ? PRICE_WORDS[d.price] || '' : '';
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

/** A trip day as "Sun 13 Dec". */
function dayName(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** "Day 2 · Sun 13 Dec · 12:30pm" for a stop. */
export function whenOf(a, days) {
  if (!a) return '';
  const n = days ? days.indexOf(a.day) : -1;
  return [n >= 0 ? `Day ${n + 1}` : '', dayName(a.day), a.start_time ? fmtTime(a.start_time) : ''].filter(Boolean).join(' · ');
}

export default function PlacePanel({
  place, details, failed, days, inTrip, onBack, backLabel,
  onDirections, onNearby, onStreetView, street, onAdd, onOpenStop, onPhotos,
}) {
  const [week, setWeek] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setWeek(false); setCopied(false); }, [place.id]);

  const d = details || null;
  const loading = !!place.place_id && !d && !failed;
  const name = place.name || (d && d.name) || '';
  const photos = (d && d.photos && d.photos.length) ? d.photos
    : place.photos && place.photos.length ? place.photos
      : place.photo_ref ? [{ ref: place.photo_ref, author: '', authorUri: '' }] : [];
  const address = (d && d.address) || place.address || '';
  const type = (d && d.type_label) || place.type_label || '';
  const price = priceOf(d);
  const stop = place.stop || null;
  const located = place.lat != null && place.lng != null;

  // Open now, in the place's own time; and on the day it is planned for.
  const now = d && d.hours ? openState(d.hours, d.utcOffset) : null;
  const today = d && d.utcOffset != null ? placeNow(d.utcOffset).day : new Date().getDay();
  const visitDay = stop && stop.day ? weekdayOf(stop.day) : null;
  const atVisit = stop && d && d.hours ? openOn(d.hours, stop.day, stop.start_time) : null;
  const shut = d && (d.status === 'CLOSED_PERMANENTLY' || d.status === 'CLOSED_TEMPORARILY') ? d.status : '';

  function copy() {
    if (!address || !navigator.clipboard) return;
    navigator.clipboard.writeText(name && !address.startsWith(name) ? `${name}, ${address}` : address)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => {});
  }

  return (
    <article className={x.panel} aria-label={name || 'Place'}>
      {onBack ? (
        <button type="button" className={`btn ghost sm ${x.back}`} onClick={onBack}>
          <ArrowLeft size={15} aria-hidden="true" /> {backLabel || 'Back'}
        </button>
      ) : null}

      {photos.length ? (
        <div className={x.gallery} data-n={Math.min(photos.length, 5)}>
          {photos.slice(0, 5).map((ph, i) => (
            <button key={ph.ref} type="button" className={x.shot}
              aria-label={i === 0 ? `Photos of ${name}` : `Photo ${i + 1} of ${name}`}
              onClick={() => onPhotos(photos, i, name)}>
              <img src={photoUrl(ph.ref, i === 0 ? 720 : 360)} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.parentElement.hidden = true; }} />
            </button>
          ))}
        </div>
      ) : loading ? <div className={`skel ${x.galleryWait}`} aria-hidden="true" /> : null}

      <div className={x.head}>
        {name ? <h3>{name}</h3> : <div className={`skel ${x.nameWait}`} aria-label="Loading the place" />}
        {d && d.rating != null ? (
          <div className="facts-score">
            <span className="facts-num">{d.rating.toFixed(1)}</span>
            <Stars value={d.rating} />
            <span className="tiny dim">({(d.ratings || 0).toLocaleString()})</span>
          </div>
        ) : null}
        {type || price ? <div className="small muted">{[type, price].filter(Boolean).join(' · ')}</div> : null}
        {stop ? <div className="small muted">{whenOf(stop, days)}</div> : null}
        {shut ? (
          <div className={`small ${x.closed}`}>
            <AlertTriangle size={14} aria-hidden="true" />
            {shut === 'CLOSED_PERMANENTLY' ? 'Permanently closed' : 'Temporarily closed'}
          </div>
        ) : now ? (
          <div className={`small ${now.open ? x.open : x.closed}`}>{describeOpen(now, today)}</div>
        ) : null}
      </div>

      <div className={`chiprow ${x.actions}`}>
        <button type="button" className="btn primary sm" onClick={onDirections} disabled={!located}>
          <Navigation size={14} aria-hidden="true" /> Directions
        </button>
        {stop ? (
          <button type="button" className="btn sm" onClick={() => onOpenStop(stop)}>
            <SquarePen size={14} aria-hidden="true" /> Open activity
          </button>
        ) : inTrip ? (
          <button type="button" className="btn sm" onClick={() => onOpenStop(inTrip)}
            data-tip={`In your trip · ${whenOf(inTrip, days)}`}>
            <Check size={14} aria-hidden="true" /> In your trip
          </button>
        ) : (
          <button type="button" className="btn sm" onClick={onAdd} disabled={!located}>
            <Plus size={14} aria-hidden="true" /> Add to trip
          </button>
        )}
        <button type="button" className="btn sm" onClick={onNearby} disabled={!located}>
          <Compass size={14} aria-hidden="true" /> Nearby
        </button>
        <button type="button" className="btn sm" onClick={onStreetView} disabled={!located || street === 'asking'}
          aria-pressed={street === 'open'}>
          {street === 'asking' ? <Loader2 size={14} className="spin" aria-hidden="true" />
            : <PersonStanding size={14} aria-hidden="true" />}
          {street === 'open' ? 'Back to map' : 'Street View'}
        </button>
      </div>
      {street === 'none' ? <p className="small muted" role="status">No Street View near this place.</p> : null}

      {d && d.summary ? <p className={`small ${x.summary}`}>{d.summary}</p> : null}

      <ul className={x.rows}>
        {address ? (
          <li>
            <MapPin size={16} aria-hidden="true" />
            <span className={x.rowText}>{address}</span>
            <button type="button" className="btn ghost sm icon-btn" onClick={copy}
              data-tip={copied ? 'Copied' : 'Copy address'} aria-label="Copy address">
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </li>
        ) : null}
        {d && d.hours ? (
          <li>
            <Clock size={16} aria-hidden="true" />
            <span className={x.rowText}>
              <button type="button" className={`linkbtn ${x.hoursToggle}`} aria-expanded={week}
                onClick={() => setWeek((v) => !v)}>
                {now ? describeOpen(now, today) : 'Opening hours'}
                <ChevronDown size={14} aria-hidden="true" className={week ? x.flip : undefined} />
              </button>
              {stop && atVisit != null ? (
                <span className={`small ${atVisit ? x.open : x.closed}`}>
                  {atVisit ? 'Open' : 'Closed'} at {fmtTime(stop.start_time)} on {dayName(stop.day)}
                </span>
              ) : null}
              {week ? (
                <span className={x.week}>
                  {[1, 2, 3, 4, 5, 6, 0].map((wd) => (
                    <span key={wd} className={x.weekRow} aria-current={wd === today ? 'date' : undefined}>
                      <span>
                        {WEEKDAYS[wd]}
                        {wd === visitDay ? <span className="tiny dim"> · your visit</span> : null}
                      </span>
                      <span className="mono">{dayHours(d.hours, wd)}</span>
                    </span>
                  ))}
                </span>
              ) : null}
            </span>
          </li>
        ) : null}
        {d && d.phone ? (
          <li>
            <Phone size={16} aria-hidden="true" />
            <a className={x.rowText} href={`tel:${d.dial || d.phone}`}>{d.phone}</a>
          </li>
        ) : null}
        {d && d.website ? (
          <li>
            <Globe size={16} aria-hidden="true" />
            <a className={x.rowText} href={d.website} target="_blank" rel="noreferrer">{host(d.website)}</a>
          </li>
        ) : null}
      </ul>

      {loading ? (
        <p className="small muted"><Loader2 size={14} className="spin" aria-hidden="true" /> Getting the details</p>
      ) : failed && place.place_id ? (
        <p className="small muted">The details could not be loaded just now.</p>
      ) : null}

      {d && d.rating != null ? (
        <section className={x.reviews} aria-label="Reviews">
          <h4>Reviews</h4>
          <PlaceFacts details={d} score={false} contact={false} link={false} />
        </section>
      ) : null}
    </article>
  );
}

/* ---------------------------------------------------------- directions -- */

const WAYS = [
  { id: 'WALK', label: 'Walk', icon: Footprints },
  { id: 'TRANSIT', label: 'Transit', icon: TrainFront },
  { id: 'DRIVE', label: 'Drive', icon: Car },
];

const located = (a) => a && a.lat != null && a.lng != null
  && Number.isFinite(Number(a.lat)) && Number.isFinite(Number(a.lng));

// The trip's order: by day, then the day's own order (sortActs is within a day).
const byTrip = (a, b) => {
  const ad = a.day || '9999';
  const bd = b.day || '9999';
  return ad !== bd ? (ad < bd ? -1 : 1) : sortActs(a, b);
};

/*
 * The way to a place, drawn on the map beside it, from somewhere in the trip.
 *
 * Planning happens far from the place, so "from where I am now" is usually a
 * journey across a sea; the starting point is a stop in the plan instead —
 * the one before it that day for a stop, the nearest one for anything else —
 * and your own position is one of the choices. `onRoute` tells the map what
 * to draw: { path, from, fromName, here }, or null when this closes.
 */
export function PlaceRoute({
  place, activities, days, onRoute, onBack,
}) {
  const to = useMemo(() => ({ lat: Number(place.lat), lng: Number(place.lng) }), [place.lat, place.lng]);
  // Stops with a position, in the order of the trip, without the place itself.
  const origins = useMemo(() => (activities || []).filter(located)
    .filter((a) => a.id !== (place.stop && place.stop.id))
    .filter((a) => haversine(Number(a.lat), Number(a.lng), to.lat, to.lng) * 1000 > 30)
    .slice().sort(byTrip), [activities, place.stop, to]);

  const [from, setFrom] = useState(() => {
    if (place.stop) {
      const before = origins.filter((a) => a.day === place.stop.day && sortActs(a, place.stop) < 0);
      if (before.length) return String(before[before.length - 1].id);
    }
    let best = null;
    origins.forEach((a) => {
      const km = haversine(Number(a.lat), Number(a.lng), to.lat, to.lng);
      if (!best || km < best.km) best = { id: a.id, km };
    });
    return best ? String(best.id) : 'here';
  });
  const [mine, setMine] = useState(null);
  const [where, setWhere] = useState('idle'); // idle | asking | got | refused | off
  const start = from === 'here' ? mine
    : (() => { const a = origins.find((o) => String(o.id) === from); return a ? { lat: Number(a.lat), lng: Number(a.lng) } : null; })();
  const startName = from === 'here' ? 'your location' : (origins.find((o) => String(o.id) === from) || {}).title || '';

  const [mode, setMode] = useState(() => {
    const a = origins.find((o) => String(o.id) === from);
    const km = a ? haversine(Number(a.lat), Number(a.lng), to.lat, to.lng) : 2;
    return km <= 1.2 ? 'WALK' : 'TRANSIT';
  });
  const [legs, setLegs] = useState({}); // `${from}:${mode}` -> result | { failed: true }

  // Your position, asked for only when it is chosen.
  useEffect(() => {
    if (from !== 'here' || mine || where !== 'idle') return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) { setWhere('off'); return; }
    setWhere('asking');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setMine({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setWhere('got'); },
      (e) => setWhere(e && e.code === 1 ? 'refused' : 'off'),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [from, mine, where]);

  const key = `${from}:${mode}`;
  const startKey = start ? `${start.lat},${start.lng}` : '';
  useEffect(() => {
    if (!start || legs[key]) return undefined;
    let alive = true;
    routeBetween(start, to, mode)
      .then((r) => { if (alive) setLegs((v) => ({ ...v, [key]: r })); })
      .catch(() => { if (alive) setLegs((v) => ({ ...v, [key]: { failed: true } })); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, startKey, to]);

  const leg = legs[key];
  const train = leg && leg.found && Array.isArray(leg.options) && leg.options.length ? leg.options[0] : null;
  const path = useMemo(() => {
    if (!leg || !leg.found) return null;
    if (train) return train.legs.flatMap((l) => (l.polyline ? decodePath(l.polyline) : []));
    return leg.polyline ? decodePath(leg.polyline) : null;
  }, [leg, train]);

  // What the map draws, and nothing once this closes.
  useEffect(() => {
    onRoute(start ? {
      path: path && path.length > 1 ? path : null,
      from: start,
      fromName: startName,
      here: from === 'here' ? mine : null,
    } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, startKey, from]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => onRoute(null), []);

  const options = [
    ...origins.map((a) => ({ value: String(a.id), label: a.title, hint: whenOf(a, days) })),
    { value: 'here', label: 'Your location', icon: <LocateFixed size={14} aria-hidden="true" /> },
  ];

  const lines = (leg && leg.lines) || [];
  const estimate = leg && (leg.source === 'model' || leg.source === 'walk');

  return (
    <article className={x.panel} aria-label={`Directions to ${place.name}`}>
      <button type="button" className={`btn ghost sm ${x.back}`} onClick={onBack}>
        <ArrowLeft size={15} aria-hidden="true" /> {place.name}
      </button>
      <div className={x.head}>
        <h3>Directions</h3>
        <div className="small muted">To {place.name}</div>
      </div>

      <div className={x.field}>
        <span className="label">From</span>
        <Select value={from} onChange={setFrom} options={options} label="Start from" />
      </div>

      <div className={`chiprow ${x.ways}`} role="group" aria-label="How to travel">
        {WAYS.map((w) => {
          const got = legs[`${from}:${w.id}`];
          return (
            <button key={w.id} type="button" className="btn sm" aria-pressed={mode === w.id}
              onClick={() => setMode(w.id)}>
              <w.icon size={14} aria-hidden="true" />
              {w.label}
              {got && got.found ? (
                <b className="rv-when mono">{got.source === 'model' || got.source === 'walk' ? '~' : ''}{fmtDuration(Math.round(got.seconds / 60))}</b>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className={x.result}>
        {from === 'here' && where === 'asking' ? (
          <p className="rv-note"><LocateFixed size={14} aria-hidden="true" /> Finding where you are</p>
        ) : from === 'here' && !mine && where !== 'idle' ? (
          <p className="rv-note">{where === 'refused' ? 'Location is turned off for this site. Start from a stop instead.' : 'Your location is not available. Start from a stop instead.'}</p>
        ) : !start ? null : !leg ? (
          <p className="rv-note"><Loader2 size={14} className="spin" aria-hidden="true" /> Working out the route</p>
        ) : leg.failed ? (
          <p className="rv-note">Could not work out a route just now.</p>
        ) : !leg.found ? (
          <p className="rv-note">No {WAYS.find((w) => w.id === mode).label.toLowerCase()} route from {startName} to here.</p>
        ) : (
          <>
            <p className="rv-said">
              <b className="mono">{estimate ? 'About ' : ''}{fmtDuration(Math.round(leg.seconds / 60)) || 'Under a minute'}</b>
              <span className="dim">· {fmtKm(leg.metres / 1000)}</span>
              {leg.source === 'model' ? (
                <span className="rv-from" data-tip="No timetable here, so the time is worked out from how often trains run on these lines">estimated</span>
              ) : leg.source === 'walk' ? <span className="rv-from">quicker on foot</span> : null}
            </p>
            <p className="small muted">From {startName}</p>
            {lines.length ? (
              <span className="rv-lines">
                {lines.map((l) => <span className="rv-line" key={l.name + (l.from || '')}>{l.name}</span>)}
              </span>
            ) : null}
          </>
        )}
      </div>
    </article>
  );
}

/* -------------------------------------------------------------- nearby -- */

/** A row for a found place: its picture, name and what it is, as the Map tab lists them. */
export function FoundRow({ place, onOpen, current }) {
  return (
    <button type="button" className={`nearby ${x.found}${current ? ' is-focus' : ''}`} onClick={() => onOpen(place)}>
      <PlacePhoto photoRef={place.photo_ref} category={place.category || 'other'} size={38} alt="" />
      <span className={x.foundText}>
        <span className="nearby-name">{place.name}</span>
        <span className="tiny dim">
          {[place.type_label, place.rating ? `★ ${Number(place.rating).toFixed(1)}` : '', place.km != null ? fmtKm(place.km) : ''].filter(Boolean).join(' · ')}
        </span>
      </span>
    </button>
  );
}
