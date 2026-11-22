'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Lightbox from '@/components/Lightbox';
import { centreOf, categoryOf, located, lookup, useSeen } from '@/components/askLookup';
import { dayColor, googleMapsAvailable } from '@/components/GoogleMap';
import { activityIcon, categoryIcon } from '@/lib/icons';
import { retryImport } from '@/lib/chunkRetry';
import { stopFor } from '@/lib/tripAsk';
import { fmtDayTiny, fmtTime, shortPlace } from '@/lib/util';
import s from './TripAsk.module.css';

// The map a name opens on, fetched only when one is clicked.
const MapExplorer = dynamic(() => retryImport(() => import('./MapExplorer')), { ssr: false });

const photoUrl = (ref, w) => `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

/**
 * Places in an answer, with their pictures: a row of cards for a few
 * highlights, or a list where each one is described beside its photo.
 *
 * The pictures are Google's, through our own photo route — a planned stop's
 * from the trip, anything else from a search for its name, looked up once
 * per session and only when the block is scrolled to. Tapping one opens the
 * app's photo viewer, which credits the photographer.
 */
export default function AskPlaces({
  spec, trip, days = [], activities, inline, onOpenStop, onAddPlace,
}) {
  const box = useRef(null);
  const seen = useSeen(box);
  const [found, setFound] = useState(null); // { [key]: place | null }
  const [shots, setShots] = useState(null);
  const [mapAt, setMapAt] = useState(null); // the place a name opened the map on

  const items = useMemo(() => spec.places.map((p, i) => {
    if (p.stop) {
      const a = stopFor(activities, p.stop);
      if (!a) return null;
      return {
        key: `s${i}`, stop: a, title: a.title, caption: p.caption, meta: p.meta, text: p.text,
        category: a.category, ref: a.photo_ref || '',
        // A stop typed in without picking a place has no photo of its own.
        q: a.photo_ref ? '' : [a.title, a.location || (trip && trip.destination)].filter(Boolean).join(', '),
      };
    }
    return {
      key: `p${i}`, title: p.name, caption: p.caption, meta: p.meta, text: p.text,
      q: [p.name, p.near].filter(Boolean).join(', '),
    };
  }).filter(Boolean), [spec, activities, trip]);

  useEffect(() => {
    if (!seen || found) return undefined;
    let dead = false;
    const near = centreOf(activities);
    Promise.all(items.filter((it) => it.q).map((it) => lookup(it.q, near)
      .then((hit) => [it.key, hit])
      .catch(() => [it.key, null])))
      .then((pairs) => { if (!dead) setFound(Object.fromEntries(pairs)); });
    return () => { dead = true; };
    // Looked up once: the trip changing under an old answer should not search again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seen]);

  const waiting = !seen || (!found && items.some((it) => it.q));
  const pictureOf = (it) => {
    const hit = found && found[it.key];
    if (it.ref) return { ref: it.ref, photos: [{ ref: it.ref, author: '', authorUri: '' }] };
    if (hit && hit.photo_ref) return { ref: hit.photo_ref, photos: (hit.photos && hit.photos.length) ? hit.photos : [{ ref: hit.photo_ref, author: '', authorUri: '' }] };
    return null;
  };

  // Render functions, not components: a component declared in here is a new
  // type every render, and React would remount every picture each time.
  function picture(it, w) {
    const pic = pictureOf(it);
    const hit = found && found[it.key];
    if (pic) {
      return (
        <button type="button" className={s.shot} aria-label={`Photos of ${it.title}`}
          onClick={() => setShots({ photos: pic.photos, index: 0, title: it.title })}>
          <img src={photoUrl(pic.ref, w)} alt="" loading="lazy" />
        </button>
      );
    }
    if (waiting) return <span className={`skel ${s.shot}`} aria-hidden="true" />;
    const Icon = it.stop ? activityIcon(it.stop) : categoryIcon(categoryOf(hit && hit.primary_type));
    return <span className={`${s.shot} ${s.shotNone}`} aria-hidden="true"><Icon size={22} /></span>;
  }

  /*
   * The same places as a map, for a name to open on: stops pinned with their
   * number in their day's colour, anything else where the search found it.
   * The rows are the map card's (components/AskLegend).
   */
  const atlas = useMemo(() => {
    let n = 0;
    const rows = items.map((it) => {
      const hit = found && found[it.key];
      if (it.stop) {
        const a = it.stop;
        const pinned = located(a);
        if (pinned) n += 1;
        return {
          key: it.key, kind: 'stop', title: a.title, label: pinned ? n : null,
          colour: dayColor(Math.max(0, days.indexOf(a.day)), days.length),
          meta: [fmtDayTiny(a.day), a.start_time ? fmtTime(a.start_time) : '', shortPlace(a.location), pinned ? '' : 'No location'].filter(Boolean).join(' · '),
          target: {
            id: a.id, kind: 'stop', name: a.title, lat: pinned ? Number(a.lat) : null, lng: pinned ? Number(a.lng) : null,
            place_id: a.place_id || (hit && hit.place_id) || null, photo_ref: it.ref || (hit && hit.photo_ref) || '',
            category: a.category, address: a.location || '', stop: a,
          },
        };
      }
      const category = hit ? categoryOf(hit.primary_type) : '';
      return {
        key: it.key, kind: 'place', title: it.title, category,
        meta: hit ? shortPlace(hit.label) : found ? 'Not found on the map' : '',
        target: hit ? {
          id: `pic-${it.key}`, kind: 'place', name: it.title, lat: hit.lat, lng: hit.lng, place_id: hit.place_id,
          photo_ref: hit.photo_ref, photos: hit.photos, category, address: hit.label,
        } : null,
      };
    });
    const stops = rows.filter((r) => r.kind === 'stop' && r.label).map((r) => ({
      ...r.target.stop, lat: r.target.lat, lng: r.target.lng, pinLabel: r.label, _colour: r.colour,
    }));
    const places = rows.filter((r) => r.kind === 'place' && r.target).map((r) => ({
      ...r.target, detail: shortPlace(r.target.address), location: r.target.address,
    }));
    return { rows, stops, places, byKey: Object.fromEntries(rows.map((r) => [r.key, r.target])) };
  }, [items, found, days]);

  /*
   * A name opens its place on the map, described in full, as the map card's
   * list does; nothing here leaves for Google Maps. A stop with no position
   * and no key to draw a map still opens itself in the itinerary.
   */
  function named(it, children) {
    const target = atlas.byKey[it.key];
    if (target && googleMapsAvailable()) {
      return <button type="button" className={s.placeLink} onClick={() => setMapAt(target)}>{children}</button>;
    }
    if (it.stop) {
      return <button type="button" className={s.placeLink} onClick={() => onOpenStop(it.stop)}>{children}</button>;
    }
    return children;
  }

  return (
    <div className={s.places} ref={box}>
      {spec.title ? <div className={`small muted ${s.placesTitle}`}>{spec.title}</div> : null}
      {spec.style === 'cards' ? (
        <div className={s.cards} data-n={items.length}>
          {items.map((it) => (
            <figure key={it.key} className={s.card}>
              {picture(it, 720)}
              <figcaption>
                {named(it, <strong>{it.title}</strong>)}
                {it.caption ? <span className="small muted">{it.caption}</span> : null}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <ol className={s.plist}>
          {items.map((it, n) => (
            <li key={it.key} className={s.pitem}>
              <div className={s.thumb}>{picture(it, 360)}</div>
              <div className={s.pbody}>
                <h4>
                  {n + 1}. {named(it, it.title)}
                  {it.caption ? <span className={s.pcaption}> — {it.caption}</span> : null}
                </h4>
                {it.meta ? <div className="small muted">{it.meta}</div> : null}
                {it.text ? <div className={s.ptext}>{inline(it.text)}</div> : null}
              </div>
            </li>
          ))}
        </ol>
      )}
      {shots ? (
        <Lightbox photos={shots.photos} index={shots.index} alt={shots.title}
          onIndex={(i) => setShots((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setShots(null)} />
      ) : null}
      {mapAt ? (
        <MapExplorer title={spec.title} stops={atlas.stops} places={atlas.places} rows={atlas.rows} start={mapAt}
          days={days} activities={activities} onOpenStop={onOpenStop} onAddPlace={onAddPlace}
          onClose={() => setMapAt(null)} />
      ) : null}
    </div>
  );
}
