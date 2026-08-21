'use client';
import { useState } from 'react';
import { categoryIcon } from '@/lib/icons';

/**
 * A photo of a stop, fetched through our own route so the Places key stays on
 * the server. Falls back to the category glyph — which is also what every stop
 * looks like when no Places key is configured, so the layout never shifts.
 */
export default function PlacePhoto({ photoRef, category = 'other', size = 44, alt = '', rounded = 10 }) {
  const [failed, setFailed] = useState(false);
  const Icon = categoryIcon(category);
  const style = { width: size, height: size, borderRadius: rounded };

  if (!photoRef || failed) {
    return (
      <span className={`photo photo-fallback catico cat-${category}`} style={style} aria-hidden="true">
        <Icon size={Math.round(size * 0.42)} />
      </span>
    );
  }

  return (
    <span className="photo" style={style}>
      <img
        src={`/api/places/photo?ref=${encodeURIComponent(photoRef)}&w=${size * 2}`}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
