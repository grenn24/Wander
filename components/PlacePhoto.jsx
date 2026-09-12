'use client';
import { useState } from 'react';
import { categoryIcon } from '@/lib/icons';

/**
 * A photo of a stop, fetched through our own route so the Places key stays on
 * the server. Falls back to the category glyph — which is also what every stop
 * looks like when no Places key is configured, so the layout never shifts.
 */
export default function PlacePhoto(props) {
  // A failure belongs to one image request. Changing the place or requested
  // size starts fresh, including when returning to a previously failed photo.
  return <PhotoContent key={`${props.photoRef || ''}:${props.size ?? 44}`} {...props} />;
}

function PhotoContent({
  photoRef, category = 'other', icon, size = 44, alt = '', rounded = 10,
}) {
  const [failed, setFailed] = useState(false);
  // A caller that knows better than the category — a flight, say — can say so.
  const Icon = icon || categoryIcon(category);
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
