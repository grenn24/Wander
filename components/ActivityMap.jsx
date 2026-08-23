'use client';
import { useEffect, useState } from 'react';
import { MapPin, Loader2, Crosshair, Search } from 'lucide-react';
import GoogleMap, { googleMapsAvailable, catColor, useMapScheme } from '@/components/GoogleMap';
import ActivityPhotos from '@/components/ActivityPhotos';
import { searchPlaces, reverseGeocode } from '@/lib/geo';

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
 *   pinned      — an exact spot is saved with the activity.
 *   best guess  — only words are saved; this is where they land, offered
 *                 rather than assumed, because a name can match two places.
 *   nothing     — no location yet.
 *
 * Clicking the map moves the pin, which is the only way to correct a spot that
 * is nearly right without deleting the words and starting the search again.
 */
export default function ActivityMap({ draft, onPick, compact = false }) {
  const [probe, setProbe] = useState(null); // best guess for text with no pin
  const [busy, setBusy] = useState(false);
  const [mapErr, setMapErr] = useState('');
  const scheme = useMapScheme();

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

  if (!googleMapsAvailable()) return null;

  const at = pinned ? { lat, lng } : probe ? { lat: probe.lat, lng: probe.lng } : null;

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

  return (
    <div className={`amap${compact ? ' is-compact' : ''}`}>
      {at ? (
        <>
          <div className="amap-el">
            <GoogleMap
              key={scheme}
              stops={[{
                id: 'draft',
                lat: at.lat,
                lng: at.lng,
                day: draft.day || 'draft',
                title: draft.title || 'This activity',
                location: pinned ? text : (probe && probe.label) || text,
                category: draft.category || 'sightseeing',
              }]}
              places={[]}
              focused={null}
              focusedPlace={null}
              dayColours={() => catColor(draft.category || 'sightseeing')}
              onDropPin={dropAt}
              /* Beside the form the map owns its column, so it can take the
                 wheel and a one-finger drag. Under the location field it is a
                 band in a scrolling form, where doing that would trap the
                 page. */
              gestures={compact ? 'cooperative' : 'greedy'}
              onError={setMapErr}
            />
          </div>

          {mapErr ? <p className="tiny dim amap-note">{mapErr}</p> : null}

          {pinned ? (
            <p className="amap-note">
              <Crosshair size={13} aria-hidden="true" />
              {/* Two fingers pan under the form, one finger scrolls it — so
                  do not tell a phone to drag. */}
              <span className="tiny dim">
                {compact
                  ? 'Tap the map to move the pin.'
                  : 'Drag to look around; click the map to move the pin.'}
              </span>
            </p>
          ) : (
            <div className="amap-guess">
              <p className="amap-note">
                <Search size={13} aria-hidden="true" />
                {/* The name, not the address: the address is already in the
                    field an inch away, and repeating it there says nothing. */}
                <span className="tiny dim">
                  Best match{probe.name ? ` — ${probe.name}` : ' for what you wrote'}
                </span>
              </p>
              <button className="btn sm" type="button"
                onClick={() => onPick({
                  location: probe.label,
                  lat: probe.lat,
                  lng: probe.lng,
                  place_id: probe.place_id || null,
                  photo_ref: probe.photo_ref || null,
                })}>
                <MapPin size={14} /> Pin here
              </button>
            </div>
          )}

          <ActivityPhotos
            title={draft.title}
            {...(pinned
              ? { placeId: draft.place_id, photoRef: draft.photo_ref }
              : { given: (probe && probe.photos) || NO_PHOTOS })}
          />
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
