'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Lightbox from '@/components/Lightbox';
import { centreOf, categoryOf, lookup, mapsLink, useSeen } from '@/components/askLookup';
import { activityIcon, categoryIcon } from '@/lib/icons';
import { stopFor } from '@/lib/tripAsk';
import s from './TripAsk.module.css';

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
export default function AskPlaces({ spec, trip, activities, inline, onOpenStop }) {
  const box = useRef(null);
  const seen = useSeen(box);
  const [found, setFound] = useState(null); // { [key]: place | null }
  const [shots, setShots] = useState(null);

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

  // A stop opens itself in the itinerary; anything else, its page on Google Maps.
  function named(it, children) {
    if (it.stop) {
      return (
        <a className={s.placeLink} href={`/trips/${trip.id}/itinerary?focus=${encodeURIComponent(it.stop.id)}`}
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
            e.preventDefault();
            onOpenStop(it.stop);
          }}>{children}</a>
      );
    }
    const hit = found && found[it.key];
    return <a className={s.placeLink} href={mapsLink(it.title, hit && hit.place_id)} target="_blank" rel="noopener noreferrer">{children}</a>;
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
    </div>
  );
}
