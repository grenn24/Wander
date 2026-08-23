'use client';
import { useState } from 'react';
import { Star, ExternalLink, Phone, Globe } from 'lucide-react';
import { colorFor, initials } from '@/lib/util';

/**
 * What other people made of the place.
 *
 * A restaurant at seven in the evening is a decision, and the thing that
 * decides it is not the address — it is whether four thousand people thought it
 * was worth the queue. That answer already exists behind the same call the
 * photographs come from, so not showing it was leaving the useful half of the
 * response on the floor.
 *
 * Two reviews, then the rest on request: enough to take the temperature without
 * turning an editor into a review site. Everything here is Google's content, so
 * every author is named and linked, and the place links back to the map it came
 * from — which is what the Places terms require of anyone showing it.
 */

const SHOWN = 2;

/** The bit of a URL worth reading: tabelog.com, not forty characters of path. */
function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (e) {
    return url;
  }
}

/** Five stars with the average poured into them. */
function Stars({ value, size = 13 }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  const row = (fill) => (
    <span className="stars-row" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star key={i} size={size} fill={fill ? 'currentColor' : 'none'} strokeWidth={1.75} />
      ))}
    </span>
  );
  return (
    <span className="stars" role="img" aria-label={`${value.toFixed(1)} out of 5`}>
      {row(false)}
      <span className="stars-on" style={{ width: `${pct}%` }}>{row(true)}</span>
    </span>
  );
}

export default function PlaceFacts({ details }) {
  const [all, setAll] = useState(false);
  if (!details) return null;

  const {
    rating, ratings, reviews = [], mapsUri, phone, dial, website,
  } = details;
  // A place with a phone number and no reviews still has something to say.
  if (rating == null && !reviews.length && !phone && !website) return null;

  const list = all ? reviews : reviews.slice(0, SHOWN);

  return (
    <div className="facts">
      {rating != null ? (
        <div className="facts-score">
          <span className="facts-num">{rating.toFixed(1)}</span>
          <Stars value={rating} />
          <span className="tiny dim">
            {ratings ? `${ratings.toLocaleString()} review${ratings === 1 ? '' : 's'}` : ''}
          </span>
          {mapsUri ? (
            <a className="facts-link" href={mapsUri} target="_blank" rel="noreferrer"
              data-tip="Open in Google Maps">
              <ExternalLink size={13} aria-hidden="true" />
            </a>
          ) : null}
        </div>
      ) : null}

      {/*
        * How to reach it. Both are links rather than text to copy: a phone
        * number on a phone should be one tap, and a website you have to
        * retype is a website you do not visit.
        *
        * There is no email here because Google does not have one — the Places
        * API returns a phone number and a site and nothing else, so the only
        * way to an address would be to go and read the site, which is not
        * something this app should be doing on anyone's behalf.
        */}
      {phone || website ? (
        <div className="facts-contact">
          {phone ? (
            <a className="btn sm" href={`tel:${dial || phone}`} data-tip="Call">
              <Phone size={14} aria-hidden="true" /> {phone}
            </a>
          ) : null}
          {website ? (
            <a className="btn sm" href={website} target="_blank" rel="noreferrer"
              data-tip="Open the website">
              <Globe size={14} aria-hidden="true" /> {host(website)}
            </a>
          ) : null}
        </div>
      ) : null}

      {list.length ? (
        <ul className="facts-reviews">
          {list.map((r) => (
            <li key={r.id}>
              <div className="facts-who">
                <span className="avatar sm" style={{ background: colorFor(r.author), marginLeft: 0 }}>
                  {initials(r.author)}
                </span>
                <span className="facts-name">
                  {r.authorUri ? (
                    <a href={r.authorUri} target="_blank" rel="noreferrer">{r.author}</a>
                  ) : r.author}
                </span>
                {r.rating != null ? <Stars value={r.rating} size={11} /> : null}
                {r.when ? <span className="tiny dim">{r.when}</span> : null}
              </div>
              <p className="facts-text">{r.text}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {reviews.length > SHOWN ? (
        <button type="button" className="linkbtn facts-more" onClick={() => setAll((v) => !v)}>
          {all ? 'Fewer reviews' : `All ${reviews.length} reviews`}
        </button>
      ) : null}

      {reviews.length ? <p className="tiny dim facts-by">Reviews from Google</p> : null}
    </div>
  );
}
