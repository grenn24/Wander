'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import Lightbox from '@/components/Lightbox';
import { coverCaption, coverEntries, coverSlides, coversFrom } from '@/lib/tripCover';

const when = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');

/*
 * A trip's cover full size — and every other cover it has had, a step away.
 *
 * It opens on the default (the cover showing) at once, from what the trip already
 * holds, so there is nothing to wait for; the rest of the covers are fetched while it
 * is open, and arrive as thumbnails and as the photos the arrows step through. A
 * caller that already has the list (the cover dialog) hands it in instead.
 */
export default function TripCoverViewer({ trip, covers: given = null, onClose }) {
  const { supabase } = useApp();
  const [listed, setListed] = useState(null);
  const [at, setAt] = useState(0);
  const moved = useRef(false);

  useEffect(() => {
    if (given || !supabase) return undefined;
    let live = true;
    coverEntries(supabase, trip.id)
      .then((entries) => { if (live) setListed(coversFrom(trip.id, entries, trip.cover_path)); })
      .catch(() => { /* the default alone is still worth showing */ });
    return () => { live = false; };
  }, [given, supabase, trip.id, trip.cover_path]);

  const slides = useMemo(
    () => coverSlides(trip, given || listed || coversFrom(trip.id, [], trip.cover_path)),
    [trip, given, listed],
  );
  const photos = useMemo(() => slides.map((slide, i) => ({
    url: slide.url,
    ref: slide.ref,
    caption: coverCaption(slide, i, slides.length, when(slide.at)),
    badge: slide.isDefault ? 'Default cover' : '',
  })), [slides]);

  // The list lands after the viewer is open: stay on the default until the person moves.
  const home = Math.max(0, slides.findIndex((slide) => slide.isDefault));
  useEffect(() => { if (!moved.current) setAt(home); }, [home, slides.length]);

  if (!photos.length) return null;
  return (
    <Lightbox photos={photos} index={Math.min(at, photos.length - 1)} strip
      alt={`Covers of ${trip.name || 'this trip'}`}
      onIndex={(i) => { moved.current = true; setAt(i); }} onClose={onClose} />
  );
}
