'use client';
import { useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
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

  const { rating, ratings, reviews = [], mapsUri } = details;
  if (rating == null && !reviews.length) return null;

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
