'use client';
import { useEffect, useMemo, useState } from 'react';
import { MapPin, Loader2, Crosshair, Maximize2 } from 'lucide-react';
import GoogleMap, { googleMapsAvailable, catColor } from '@/components/GoogleMap';
import StaticActivityMap from '@/components/StaticActivityMap';
import ActivityPhotos from '@/components/ActivityPhotos';
import PlaceFacts from '@/components/PlaceFacts';
import { searchPlaces, reverseGeocode, placeDetails, cachedDetails } from '@/lib/geo';

/* Shared, so "no photos" is the same array every render and does not restart
   the effect that reads it. */
const NO_PHOTOS = [];

/**
 * Where this activity is, shown while you are editing it.
 *
 * The location field could only ever be checked by leaving the editor for the
 * map tab and finding the stop again — so a pin on the wrong side of the city
 * survived every edit that was not specifically looking for it. A map next to
 * the field answers the question where it is asked.
 *
 * Three states, and it says which one it is in:
 *   pinned      — an exact spot is saved with the activity. A marker, and only
 *                 here: a pin is the map saying "this one, exactly", and it
 *                 must never say that about a guess nobody has agreed to.
 *   best guess  — only words are saved. The map goes to where they land and
 *                 draws nothing. What it found, and the button that would make
 *                 it true, belong beside the field that asked — repeating them
 *                 under the map was the same sentence twice.
 *   nothing     — no location yet.
 *
 * Double-clicking the map moves the pin, which is the only way to correct a
 * spot that is nearly right without deleting the words and starting again.
 */
export default function ActivityMap({
  draft, onPick, onGuess, compact = false, expanded = false, onExpand,
}) {
  const [probe, setProbe] = useState(null); // best guess for text with no pin
  const [busy, setBusy] = useState(false);
  const [mapErr, setMapErr] = useState('');
  // Seeded from the cache rather than fetched into it: the editor is opened
  // with the place already asked for, so by the time this mounts the answer is
  // usually sitting there and the panel can be right the first time.
  const [facts, setFacts] = useState(() => cachedDetails(draft.place_id));

  const lat = Number(draft.lat);
  const lng = Number(draft.lng);
  const pinned = draft.lat != null && draft.lat !== '' && draft.lng != null
    && Number.isFinite(lat) && Number.isFinite(lng);
  const text = (draft.location || '').trim();

  /*
   * Words with no pin still have a place on the map. The lookup is the same one
   * the field's suggestions use and shares its cache, so while someone is
   * typing this costs nothing beyond the search already being made.
   */
  useEffect(() => {
    if (pinned || text.length < 3) { setProbe(null); setBusy(false); return undefined; }
    let alive = true;
    setBusy(true);
    const timer = setTimeout(() => {
      searchPlaces(text)
        .then((r) => { if (alive) setProbe(r[0] || null); })
        .catch(() => { if (alive) setProbe(null); })
        .finally(() => { if (alive) setBusy(false); });
    }, 420);
    return () => { alive = false; clearTimeout(timer); };
  }, [text, pinned]);

  /*
   * One request for the photographs, the rating and the reviews together —
   * they all come back from the same Place Details call, which is billed by
   * the request rather than by the field.
   */
  useEffect(() => {
    const known = cachedDetails(draft.place_id);
    setFacts(known);
    if (!draft.place_id || known) return undefined;
    let alive = true;
    placeDetails(draft.place_id)
      .then((d) => { if (alive) setFacts(d); })
      .catch(() => { /* the saved photo and the pin are still worth showing */ });
    return () => { alive = false; };
  }, [draft.place_id]);

  /* The field an inch away asks the same question this panel answers, so it
     is told rather than left to look it up a second time. */
  useEffect(() => {
    if (!onGuess) return;
    onGuess({ busy, place: probe || null });
  }, [onGuess, busy, probe]);

  const at = pinned ? { lat, lng } : probe ? { lat: probe.lat, lng: probe.lng } : null;

  /*
   * The saved reference is only there to put something on screen before the
   * details land. It is not the same string Google returns for the same
   * picture a second time, so it is replaced rather than merged.
   */
  const shots = useMemo(() => {
    /*
     * One picture for a place nobody has chosen yet.
     *
     * The references come back with the search and cost nothing, but every
     * thumbnail actually drawn is a photo request — and a guess's references
     * carry a fresh token each time, so they miss the cache that makes a saved
     * activity's photos free. One is enough to recognise a place by, which is
     * the only job it has before you have picked it; the rest arrive with the
     * ratings and reviews once you have.
     */
    if (!pinned) return probe && probe.photos ? probe.photos.slice(0, 1) : NO_PHOTOS;
    if (facts && facts.photos && facts.photos.length) return facts.photos;
    return draft.photo_ref
      ? [{ ref: draft.photo_ref, author: '', authorUri: '' }] : NO_PHOTOS;
    // Memoised because the fallback builds a fresh array: handed straight to a
    // child that watches the prop by identity, a new one every render is an
    // endless round of resets.
  }, [pinned, probe, facts, draft.photo_ref]);

  /**
   * A click on the map is someone saying "there", exactly.
   *
   * Only the point moves. The name and the photos belong to the place, not to
   * the coordinate — nudging a pin off a building's centroid should not wipe
   * what you already knew about it, and retyping the location is what clears
   * all three together.
   */
  async function dropAt(la, ln) {
    onPick({ lat: la, lng: ln });
    // Somewhere with no name yet is worth naming, though.
    if (text) return;
    try {
      const found = await reverseGeocode(la, ln);
      if (found && found.label) onPick({ lat: la, lng: ln, location: found.label });
    } catch (e) {
      // A pin with no name is still a pin; nothing to report.
    }
  }

  if (!googleMapsAvailable()) return null;

  return (
    <div className={`amap${compact ? ' is-compact' : ''}${expanded ? ' is-expanded' : ''}`}>
      {at ? (
        <>
          <div className={`amap-el${onExpand ? ' can-expand' : ''}`}>
            {!expanded ? <StaticActivityMap at={at} pinned={pinned}
              category={draft.category || 'sightseeing'} compact={compact} title={draft.title} /> : <GoogleMap
              showAppearance={!onExpand}
              /* A marker means a decision has been made. Until one has, the
                 map only goes to the neighbourhood. */
              stops={pinned ? [{
                id: 'draft',
                lat: at.lat,
                lng: at.lng,
                day: draft.day || 'draft',
                title: draft.title || 'This activity',
                location: text,
                category: draft.category || 'sightseeing',
              }] : []}
              look={pinned ? undefined : at}
              places={[]}
              focused={null}
              focusedPlace={null}
              stopColour={() => catColor(draft.category || 'sightseeing')}
              onDropPin={dropAt}
              /* Beside the form the map owns its column, so it can take the
                 wheel and a one-finger drag. Under the location field it is a
                 band in a scrolling form, where doing that would trap the
                 page. */
              gestures={expanded || !compact ? 'greedy' : 'cooperative'}
              onError={setMapErr}
            />}
            {onExpand ? (
              <button className="amap-expand-hit" type="button" onClick={onExpand}
                aria-label="Expand map">
                <span><Maximize2 size={14} /> Expand map</span>
              </button>
            ) : null}
          </div>

          {mapErr ? <p className="tiny dim amap-note">{mapErr}</p> : null}

          {pinned ? (
            <p className="amap-note">
              <Crosshair size={13} aria-hidden="true" />
              {/* Two fingers pan under the form, one finger scrolls it — so
                  do not tell a phone to drag. */}
              <span className="tiny dim">
                {onExpand
                  ? 'Open the map to move the pin.'
                  : compact
                    ? 'Drag to look around; double-tap to move the pin.'
                    : 'Drag to look around; double-click to move the pin.'}
              </span>
            </p>
          ) : null}

          {!expanded ? (
            <>
              <ActivityPhotos title={draft.title} photos={shots} preview={!pinned} />
              {pinned ? <PlaceFacts details={facts} /> : null}
            </>
          ) : null}
        </>
      ) : (
        <div className="amap-blank">
          {busy ? (
            <><Loader2 size={16} className="spin" /> <span>Looking that up…</span></>
          ) : (
            <><MapPin size={16} /> <span>Add a location and it appears here.</span></>
          )}
        </div>
      )}
    </div>
  );
}
