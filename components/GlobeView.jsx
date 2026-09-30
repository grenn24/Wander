'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, X, Check, Trash2, BookOpen, Earth, Sparkles, PanelLeftClose, PanelLeftOpen,
  ChevronDown, ChevronUp,
} from 'lucide-react';
import TopBar from '@/components/TopBar';
import HomeNav from '@/components/HomeNav';
import Loading from '@/components/Loading';
import Lightbox from '@/components/Lightbox';
import PlacePhoto from '@/components/PlacePhoto';
import FavouriteButton from '@/components/FavouriteButton';
import {
  readFavourites, setFavourite, withFavourite, noFavourites, favouritesMissing,
} from '@/lib/favourites';
import { useApp } from '@/components/AppProvider';
import useSheetDrag from '@/components/useSheetDrag';
import { coverURL } from '@/lib/tripCover';
import { dayColor } from '@/components/GoogleMap';
import { inkOn } from '@/components/mapPin';
import { searchPlaces, placeDetails } from '@/lib/geo';
import { readWithSessionRecovery } from '@/lib/sessionRecovery';
import { retryImport } from '@/lib/chunkRetry';
import {
  tripPoints, savedPoints, ideaPoints, overviewCamera, focusCamera, groupCamera, globeCounts,
  tripRoute, routeLegs, stopsNear,
} from '@/lib/globe';
import { fmtRange, fmtDay, fmtTime, humanError, todayISO, shortPlace } from '@/lib/util';
import s from './Globe.module.css';

const GlobeCanvas = dynamic(() => retryImport(() => import('./GlobeCanvas')), {
  ssr: false,
  loading: () => <div className={s.hold} />,
});

const IDEAS_KEY = 'wander:globe-ideas';
const PANEL_KEY = 'wander:globe-panel';
const PHOTOS_KEY = 'wander:globe-photos';
// A found photograph is remembered for a month, then looked up again.
const PHOTO_DAYS = 30;

function rememberedPhotos() {
  try {
    const all = JSON.parse(localStorage.getItem(PHOTOS_KEY) || '{}');
    const fresh = Date.now() - PHOTO_DAYS * 86400000;
    return Object.fromEntries(Object.entries(all).filter(([, v]) => v && v.at > fresh));
  } catch (e) {
    return {};
  }
}

function rememberPhotos(found) {
  try { localStorage.setItem(PHOTOS_KEY, JSON.stringify(found)); } catch (e) { /* not remembered */ }
}
// What each kind is called on screen. Inside, a completed trip is still 'been'
// and an upcoming one 'planned', the names saved places are stored under.
const KIND = { been: 'Completed', planned: 'Upcoming', favourite: 'Favourite', idea: 'Guide idea', preview: 'New place' };
const LAYER = { been: 'Completed', planned: 'Upcoming', favourite: 'Favourites' };
// What puts a place under each count, shown when the count is pointed at.
const KIND_TIP = {
  been: 'Trips that have finished, and places you marked as been',
  planned: 'Trips still to come or under way, and trips without dates yet',
  favourite: 'Trips and guides you’ve favourited',
};

// The table arrives with a migration; a database that has not had it yet
// should still show trips, and say plainly why saving is off.
function missingTable(e) {
  return /42P01|PGRST205|saved_places/.test(`${e && e.code} ${e && e.message}`);
}

const photoURL = (ref, w) => `/api/places/photo?ref=${encodeURIComponent(ref)}&w=${w}`;

/**
 * Where you have been and where you might go, on a globe.
 *
 * Nothing here has to be entered by hand to be useful: every trip with located
 * stops puts its towns on the globe, finished trips as completed and the rest
 * as upcoming. Favourites are the trips and guides you have hearted, kept
 * together whatever their dates. Places saved as been cover what Wander never
 * saw, and guides sit on the globe as ideas, which is what turns looking back
 * into planning the next one.
 */
export default function GlobeView() {
  const { supabase, user, sessionRevision, fail, pushToast } = useApp();
  const router = useRouter();
  const [trips, setTrips] = useState([]);
  const [acts, setActs] = useState([]);
  const [saved, setSaved] = useState([]);
  const [guides, setGuides] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [noTable, setNoTable] = useState(false);
  const [favs, setFavs] = useState(noFavourites);
  const [noFavTable, setNoFavTable] = useState(false);
  const [layers, setLayers] = useState({ been: true, planned: true, favourite: true, idea: true });
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [aim, setAim] = useState(() => ({ camera: overviewCamera([]), key: 0, instant: true }));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false); // the phone sheet, pulled up
  // The menu folded down to its title, to see more of the globe. Remembered between visits.
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  // The 3D Earth takes a few seconds to arrive, and until it does the stage is empty space.
  const [drawn, setDrawn] = useState(false);
  // Guides' stops, fetched the first time each is chosen: slug -> { stops, sections }.
  const [guideStops, setGuideStops] = useState({});
  // On an open trip: the stop chosen, and the one under a pointer, on the globe or in the list.
  const [stopIndex, setStopIndex] = useState(null);
  const [hoverStop, setHoverStop] = useState(null);
  const stopRows = useRef([]);
  const openStop = useRef(null);
  openStop.current = stopIndex;
  // Google's photographs of the stops opened so far: place ID -> photos ([] for none found).
  const [placeShots, setPlaceShots] = useState({});
  // Place IDs whose photographs took too long: their cards open without one.
  const [slowShots, setSlowShots] = useState({});
  const [viewer, setViewer] = useState(null); // { photos, index, title }
  const aimed = useRef(false);
  const arrived = useRef(false);
  const stageRef = useRef(null);
  const panelRef = useRef(null);
  const planRef = useRef(null);
  /*
   * How much of the screen an open trip's sheet takes on a phone. Its days
   * ('days'), all of them over the globe ('tall'), or its name alone with the
   * globe behind it ('name'). The grip goes up a step, and round from the top.
   */
  const PLAN_SIZES = ['name', 'days', 'tall'];
  const [planSize, setPlanSize] = useState('days');
  // And pulled to any of them, which is what a grip looks like it is for.
  const planDrag = useSheetDrag({
    ref: planRef, sizes: PLAN_SIZES, size: planSize, onSize: setPlanSize,
  });
  /*
   * The sheet of your own places pulls the same way. Its three sizes are kept
   * as two pieces of state rather than one word, so they are put on and taken
   * off the element by hand while it is being measured.
   */
  const PANEL_SIZES = ['shut', 'some', 'all'];
  const panelDrag = useSheetDrag({
    ref: panelRef,
    sizes: PANEL_SIZES,
    size: collapsed ? 'shut' : open ? 'all' : 'some',
    apply: (el, name) => {
      el.toggleAttribute('data-collapsed', name === 'shut');
      el.toggleAttribute('data-open', name === 'all');
    },
    onSize: (name) => { fold(name === 'shut'); setOpen(name === 'all'); },
  });
  /*
   * How far the cards over the globe reach in from its top and foot, so it can
   * aim a place into what is left rather than behind them. On a phone an open
   * trip is a sheet across the foot of the screen; on a wide one the cards are
   * down the side and nothing is in the way.
   */
  const insets = useCallback(() => {
    const stage = stageRef.current;
    const card = planRef.current;
    if (!stage || !card || !card.offsetHeight) return null;
    // Where it is laid out, not where it is drawn: it may be mid-slide.
    const foot = stage.clientHeight - (card.offsetTop + card.offsetHeight);
    // Down the side of a wide screen it covers nothing the globe needs.
    if (card.offsetWidth < stage.clientWidth * 0.8) return null;
    return foot <= 2 ? { bottom: card.offsetHeight } : { top: card.offsetTop + card.offsetHeight };
  }, []);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    setLoadError('');
    try {
      /*
       * Everything the globe is made of, asked for at once.
       *
       * It used to be four reads in a line: the trips, then their stops, then
       * the places pinned by hand, then what is kept. Each waited on the one
       * before it although only the stops depend on anything, and the globe
       * stayed empty until the last of them landed. The stops come with their
       * trips now, and the other two go out beside them.
       */
      const withStops = () => supabase.from('trips')
        .select('id, name, destination, start_date, end_date, cover_ref, cover_path,'
          + ' activities(id, trip_id, title, lat, lng, location, category, photo_ref, place_id, day, start_time, sort_order)')
        .not('activities.lat', 'is', null)
        .limit(2000, { referencedTable: 'activities' });
      const [trip, place, keep] = await Promise.all([
        readWithSessionRecovery(supabase, withStops),
        supabase.from('saved_places').select('*').order('created_at', { ascending: true }),
        readFavourites(supabase).then((favs) => ({ favs })).catch((error) => ({ error })),
      ]);

      // A server that will not follow the join still gets its trips, then their stops —
      // and a database that has not been given cover_path yet fails the same way, so
      // the second attempt asks for nothing it could be missing.
      let rows = trip.data;
      let a = (rows || []).flatMap((t) => t.activities || []);
      if (trip.error) {
        const plain = await readWithSessionRecovery(supabase, () =>
          supabase.from('trips').select('id, name, destination, start_date, end_date, cover_ref'));
        if (plain.error) throw plain.error;
        rows = plain.data;
        const ids = (rows || []).map((x) => x.id);
        a = [];
        if (ids.length) {
          const { data, error } = await supabase.from('activities')
            .select('id, trip_id, title, lat, lng, location, category, photo_ref, place_id, day, start_time, sort_order')
            .in('trip_id', ids)
            .not('lat', 'is', null)
            .limit(5000);
          if (error) throw error;
          a = data || [];
        }
      }

      if (place.error) {
        if (!missingTable(place.error)) throw place.error;
        setNoTable(true);
      }
      if (keep.error) {
        if (!favouritesMissing(keep.error)) throw keep.error;
        setNoFavTable(true);
      }
      // The trips themselves, without the stops hanging off them.
      setTrips((rows || []).map(({ activities, ...t }) => t));
      setActs(a);
      setSaved(place.data || []);
      setFavs(keep.favs || noFavourites());
    } catch (e) {
      setLoadError(humanError(e));
    } finally {
      setLoading(false);
    }
  }, [supabase, user]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (loadError) load(); }, [sessionRevision]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let alive = true;
    fetch('/api/guides')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setGuides((d && d.guides) || []); })
      .catch(() => {});
    try {
      if (localStorage.getItem(IDEAS_KEY) === 'off') setLayers((l) => ({ ...l, idea: false }));
      if (localStorage.getItem(PANEL_KEY) === 'collapsed') setCollapsed(true);
    } catch (e) { /* storage off: ideas stay on, the menu starts open */ }
    return () => { alive = false; };
  }, []);

  const today = useMemo(() => todayISO(), []);
  const bare = useMemo(() => [
    ...tripPoints(trips, acts, today, favs.trips),
    ...savedPoints(saved),
    ...ideaPoints(guides, favs.guides),
  ], [trips, acts, saved, guides, today, favs]);

  /*
   * Photographs for towns that have none. A trip planned without place
   * photos — Hakone & Kyoto has one photograph across eighteen stops — would
   * otherwise show its towns as blanks, so each is looked up once by its most
   * photogenic stop. A Places search is paid for, so what is found is kept in
   * this browser for a month, and a search that finds nothing is kept too.
   */
  const [found, setFound] = useState(() => (typeof window === 'undefined' ? {} : rememberedPhotos()));
  useEffect(() => {
    const wanted = [...new Set(bare.map((p) => p.photo_query).filter((q) => q && !(q in found)))];
    if (!wanted.length) return undefined;
    let live = true;
    (async () => {
      const next = {};
      for (const q of wanted.slice(0, 12)) {
        try {
          const [hit] = (await searchPlaces(q)).filter((r) => r.photo_ref);
          next[q] = { ref: hit ? hit.photo_ref : null, at: Date.now() };
        } catch (e) {
          break; // Places unreachable or over its limit: try again next visit.
        }
      }
      if (!live || !Object.keys(next).length) return;
      setFound((prev) => {
        const merged = { ...prev, ...next };
        rememberPhotos(merged);
        return merged;
      });
    })();
    return () => { live = false; };
  }, [bare]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = useMemo(() => bare.map((p) => {
    const hit = p.photo_query && found[p.photo_query];
    return hit && hit.ref ? { ...p, photo_ref: hit.ref } : p;
  }), [bare, found]);
  // A favourite trip shows while its dates' layer or Favourites is on.
  const shown = useMemo(() => {
    const list = all.filter((p) => layers[p.kind] || (p.favourite && layers.favourite));
    return preview ? [...list, preview] : list;
  }, [all, layers, preview]);
  const counts = useMemo(() => globeCounts(all), [all]);
  const point = selected === 'preview' ? preview : all.find((p) => p.id === selected) || null;

  /*
   * The route of whatever is chosen: every stop of the trip a town belongs to,
   * in the order the trip visits them, or every stop of a guide in the
   * order its journal does. Drawn on the globe so a trip can be seen unfolding
   * day by day rather than as a pin or two.
   */
  const routeFor = useCallback((tripId) => tripRoute(acts.filter((a) => a.trip_id === tripId)), [acts]);
  const chosenGuide = point && point.guide && !point.savedId ? point.guide : null;
  useEffect(() => {
    if (!chosenGuide || guideStops[chosenGuide]) return undefined;
    let live = true;
    // `v` changes with what a stop carries, so a copy cached before it is not used.
    fetch(`/api/guides/${encodeURIComponent(chosenGuide)}/stops?v=2`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (live && d) setGuideStops((prev) => ({ ...prev, [chosenGuide]: { stops: d.stops || [], sections: d.sections || [] } }));
      })
      .catch(() => {});
    return () => { live = false; };
  }, [chosenGuide, guideStops]);
  const route = useMemo(() => {
    let stops = [];
    let key = '';
    let sections = [];
    if (point && point.tripId) {
      key = `trip:${point.tripId}`;
      stops = routeFor(point.tripId);
    } else if (chosenGuide && guideStops[chosenGuide]) {
      key = `guide:${chosenGuide}`;
      ({ stops, sections } = guideStops[chosenGuide]);
    }
    return stops.length ? { key, stops, sections, legs: routeLegs(stops) } : null;
  }, [point && point.tripId, chosenGuide, guideStops, routeFor]); // eslint-disable-line react-hooks/exhaustive-deps
  const routeKey = route ? route.key : '';
  // A different trip starts with nothing chosen along it.
  useEffect(() => { setStopIndex(null); setHoverStop(null); }, [routeKey]);
  /*
   * A stop's photograph, looked up as it is opened, the way the journal's own
   * place card does it: a guide keeps each place's Google ID and nothing
   * Google returns for it, and a trip's stop may have its ID but no photograph
   * saved. The flight in gives the lookup time to land; if it has not within a
   * moment, the card opens without it rather than keep you waiting.
   */
  const chosenStop = route && stopIndex != null ? route.stops[stopIndex] : null;
  const shotId = chosenStop && !chosenStop.photo_ref && chosenStop.place_id ? chosenStop.place_id : null;
  useEffect(() => {
    if (!shotId || placeShots[shotId]) return undefined;
    let live = true;
    const done = (photos) => { if (live) setPlaceShots((v) => ({ ...v, [shotId]: photos })); };
    placeDetails(shotId).then((d) => done((d && d.photos) || []), () => done([]));
    const late = setTimeout(() => { if (live) setSlowShots((v) => ({ ...v, [shotId]: true })); }, 1200);
    return () => { live = false; clearTimeout(late); };
  }, [shotId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Whatever is chosen on the globe comes into view in the list.
  useEffect(() => {
    const row = stopIndex != null && stopRows.current[stopIndex];
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [stopIndex]);

  const tripRows = useMemo(() => {
    const by = new Map();
    all.filter((p) => p.tripId).forEach((p) => {
      if (!by.has(p.tripId)) by.set(p.tripId, []);
      by.get(p.tripId).push(p);
    });
    return [...by.values()].map((pins) => ({
      id: pins[0].tripId, kind: pins[0].kind, favourite: pins[0].favourite, trip: pins[0].trip, pins,
    }));
  }, [all]);

  // Once the places are known, turn the globe to face them.
  useEffect(() => {
    if (loading || aimed.current) return;
    aimed.current = true;
    setAim({ camera: overviewCamera(all), key: Date.now() });
  }, [loading, all]);

  function fly(camera) { setAim({ camera, key: Date.now() }); }

  /*
   * Choosing a place flies to it, but never further out than you already are.
   * A guide is framed from 900 km, a region, and choosing the Kyoto guide
   * while looking at a street in Kyoto used to pull you all the way back out.
   */
  function select(p) {
    if (!p) { setSelected(null); setPreview(null); return; }
    setSelected(p.id);
    if (p.id !== 'preview') setPreview(null);
    // A town frames its stretch of the trip's route; everything else, its own view.
    const near = p.tripId ? stopsNear(routeFor(p.tripId), p) : [];
    const camera = near.length > 1 ? groupCamera(near) : focusCamera(p);
    setAim({ camera, key: Date.now(), closerOnly: true });
    setOpen(false);
  }

  /*
   * A filled-in country, clicked. One place in it opens that place; several
   * fly in far enough to see them all, where their pins take over from the fill.
   */
  function onRegion(region) {
    if (region.points.length === 1) { select(region.points[0]); return; }
    setSelected(null);
    setPreview(null);
    fly(groupCamera(region.points));
  }

  /*
   * A stop on the open trip, from the globe or the list: close in on it and
   * open its card over its pin. Choosing the open one again closes its card,
   * as on the trip map.
   */
  function chooseStop(i) {
    const stop = route && route.stops[i];
    if (!stop) return;
    if (openStop.current === i) { setStopIndex(null); return; }
    setStopIndex(i);
    setAim({ camera: { center: { lat: stop.lat, lng: stop.lng }, range: 2500, tilt: 55, heading: 0 }, key: Date.now() });
  }

  function onCanvasSelect(id) {
    // The ground, pressed: a stop's card closes first, and the trip after it.
    if (!id && openStop.current != null) { setStopIndex(null); return; }
    if (!id) { setSelected(null); setPreview(null); return; }
    const p = id === 'preview' ? preview : all.find((x) => x.id === id);
    if (p) select(p);
  }

  function fold(next) {
    setCollapsed(next);
    if (next) setOpen(false);
    try { localStorage.setItem(PANEL_KEY, next ? 'collapsed' : 'open'); } catch (e) { /* not remembered */ }
  }

  function toggle(kind) {
    setLayers((l) => {
      const next = { ...l, [kind]: !l[kind] };
      if (kind === 'idea') {
        try { localStorage.setItem(IDEAS_KEY, next.idea ? 'on' : 'off'); } catch (e) { /* not remembered */ }
      }
      return next;
    });
  }

  async function save(row) {
    if (!supabase || !user) return null;
    if (noTable) {
      pushToast('Saving places needs a database update first.', { kind: 'error' });
      return null;
    }
    const dup = saved.find((r) => row.place_id && r.place_id === row.place_id);
    if (dup && dup.kind === row.kind) return dup;
    if (dup) {
      // Saved once as want to go, before favourites: it becomes a place you have been.
      const { data, error } = await supabase.from('saved_places').update({ kind: row.kind }).eq('id', dup.id).select().single();
      if (error) { fail(error); return null; }
      setSaved((prev) => prev.map((r) => (r.id === dup.id ? data : r)));
      return data;
    }
    setBusy(true);
    const { data, error } = await supabase.from('saved_places').insert({
      user_id: user.id,
      kind: row.kind,
      name: String(row.name || 'Somewhere').slice(0, 200),
      label: String(row.label || '').slice(0, 300),
      lat: row.lat,
      lng: row.lng,
      place_id: row.place_id || null,
      photo_ref: row.photo_ref || null,
      guide: row.guide || null,
    }).select().single();
    setBusy(false);
    if (error) {
      if (missingTable(error)) setNoTable(true);
      fail(error);
      return null;
    }
    setSaved((prev) => [...prev, data]);
    return data;
  }


  async function unsave(row) {
    setBusy(true);
    const { error } = await supabase.from('saved_places').delete().eq('id', row.id);
    setBusy(false);
    if (error) { fail(error); return; }
    setSaved((prev) => prev.filter((r) => r.id !== row.id));
    setSelected(null);
    pushToast(`Removed ${row.name}.`);
  }

  async function keepPreview() {
    if (!preview) return;
    const row = await save({ ...preview, kind: 'been' });
    if (!row) return;
    setPreview(null);
    setSelected(`saved:${row.id}`);
    pushToast(`${row.name} is now under Completed.`);
  }

  /*
   * Heart a trip or a guide, or take the heart away. The globe changes at
   * once; if the database refuses, it changes back and says why.
   */
  async function favourite(target, on, name) {
    if (!supabase || !user) return;
    if (noFavTable) {
      pushToast('Favourites need a database update first.', { kind: 'error' });
      return;
    }
    const before = favs;
    setFavs(withFavourite(favs, target, on));
    try {
      await setFavourite(supabase, user.id, target, on);
      pushToast(on ? `${name} is in your favourites.` : `${name} is no longer a favourite.`);
    } catch (e) {
      setFavs(before);
      if (favouritesMissing(e)) setNoFavTable(true);
      fail(e);
    }
  }

  // Arriving from a guide's "Add to favourites" (or an older "Save to my globe" link).
  useEffect(() => {
    if (loading || arrived.current || !guides.length) return;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('favourite') || params.get('want');
    if (!slug) return;
    arrived.current = true;
    window.history.replaceState(window.history.state, '', '/globe');
    const j = guides.find((x) => x.slug === slug);
    if (!j) return;
    aimed.current = true;
    if (!favs.guides.has(slug)) favourite({ guide: slug }, true, j.title);
    const [p] = ideaPoints([j], new Set([slug]));
    if (p) { setSelected(p.id); setPreview(null); setAim({ camera: focusCamera(p), key: Date.now() }); }
  }, [loading, guides]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const q = query.trim();
    setSearchError('');
    if (q.length < 3) { setResults([]); setSearching(false); return undefined; }
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      searchPlaces(q)
        .then((r) => { if (live) setResults(r.slice(0, 6)); })
        .catch((e) => { if (live) { setResults([]); setSearchError(humanError(e)); } })
        .finally(() => { if (live) setSearching(false); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [query]);

  function pick(place) {
    setQuery('');
    setResults([]);
    const known = place.place_id && saved.find((r) => r.place_id === place.place_id);
    if (known) { select(savedPoints([known])[0]); return; }
    const p = {
      id: 'preview', kind: 'preview', lat: place.lat, lng: place.lng,
      name: place.name || place.label, label: place.label,
      place_id: place.place_id || null, photo_ref: place.photo_ref || null,
    };
    setPreview(p);
    setSelected('preview');
    setOpen(false);
    setAim({ camera: focusCamera(p), key: Date.now(), closerOnly: true });
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // A stop's card first, then the trip: the same order they were opened in.
      if (openStop.current != null) { setStopIndex(null); return; }
      setSelected(null);
      setPreview(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const own = counts.been + counts.planned + counts.favourite;
  const row = point && point.savedId ? saved.find((r) => r.id === point.savedId) : null;
  const pointGuide = point && point.guide && !point.savedId ? guides.find((j) => j.slug === point.guide) : null;

  /*
   * The itinerary beside the globe for an open trip or guide: what it is, a
   * way into it, and its places day by day, numbered and coloured as they are
   * on the globe. Opening a trip from any of its towns opens the whole trip.
   */
  const plan = (() => {
    if (!point) return null;
    const trip = point.tripId ? trips.find((t) => t.id === point.tripId) : null;
    if (!trip && !pointGuide) return null;
    const stops = route ? route.stops : [];
    const total = Math.max(1, ...stops.map((st) => st.section + 1));
    const days = [];
    stops.forEach((stop, i) => {
      let day = days[days.length - 1];
      if (!day || day.section !== stop.section) {
        const part = (route.sections || [])[stop.section];
        day = {
          section: stop.section,
          colour: dayColor(stop.section, total),
          label: trip
            ? (stop.day ? `Day ${stop.section + 1} · ${fmtDay(stop.day)}` : 'Not on a day yet')
            : (part && part.kicker) || `Part ${stop.section + 1}`,
          title: trip ? '' : (part && part.title) || '',
          stops: [],
        };
        days.push(day);
      }
      day.stops.push({ stop, i });
    });
    const count = route ? `${stops.length} ${stops.length === 1 ? 'place' : 'places'}` : '';
    const closeStop = () => setStopIndex(null);
    if (trip) {
      return {
        key: `trip:${trip.id}`,
        kind: KIND[point.kind],
        title: trip.name,
        meta: [fmtRange(trip.start_date, trip.end_date), count].filter(Boolean).join(' · '),
        image: coverURL(trip, 680) || (point.photo_ref ? photoURL(point.photo_ref, 680) : null),
        href: `/trips/${trip.id}/itinerary`,
        open: 'Open trip',
        target: { tripId: trip.id },
        days,
        sub: (stop) => [stop.time ? fmtTime(stop.time) : '', shortPlace(stop.location)].filter(Boolean).join(' · '),
        card: (stop, i) => ({
          key: `${trip.id}:${i}`,
          title: stop.name,
          meta: [stop.day ? fmtDay(stop.day) : '', stop.time ? fmtTime(stop.time) : '', shortPlace(stop.location)]
            .filter(Boolean).join(' · '),
          photoRef: stop.photo_ref,
          placeId: stop.place_id,
          action: 'Open activity',
          onAction: () => router.push(`/trips/${trip.id}/itinerary${stop.id ? `?focus=${stop.id}` : ''}`),
          onClose: closeStop,
        }),
      };
    }
    const j = pointGuide;
    return {
      key: `guide:${j.slug}`,
      kind: KIND[point.kind],
      title: j.title,
      meta: [point.label, `${j.days[0]}–${j.days[1]} days`, count].filter(Boolean).join(' · '),
      image: point.image,
      href: `/guides/${j.slug}`,
      open: 'Read the guide',
      target: { guide: j.slug },
      days,
      sub: () => '',
      card: (stop, i) => {
        const part = (route.sections || [])[stop.section];
        return {
          key: `${j.slug}:${i}`,
          title: stop.name,
          meta: part ? [part.kicker, part.title].filter(Boolean).join(' · ') : '',
          action: 'Read the guide',
          onAction: () => router.push(`/guides/${j.slug}`),
          onClose: closeStop,
        };
      },
    };
  })();

  // Each trip opens showing its days, however the last one was left.
  const planKey = plan ? plan.key : null;
  useEffect(() => { setPlanSize('days'); }, [planKey]);

  /*
   * The open stop's card, with its photograph: the one saved with it, or
   * Google's, once looked up. Held back while the lookup is under way, and
   * built again if it lands after the card has opened anyway.
   */
  const stopCard = (() => {
    if (!plan || !chosenStop) return null;
    const card = plan.card(chosenStop, stopIndex);
    const photos = shotId ? placeShots[shotId] : null;
    if (shotId && !photos && !slowShots[shotId]) return null;
    const ref = chosenStop.photo_ref || (photos && photos[0] && photos[0].ref) || null;
    const title = card.title;
    return {
      ...card,
      key: `${card.key}:${ref || ''}`,
      photoRef: ref,
      placeId: chosenStop.place_id || null,
      onPhoto: () => {
        const shots = photos && photos.length ? photos : ref ? [{ ref, author: '', authorUri: '' }] : [];
        if (shots.length) setViewer({ photos: shots, index: 0, title });
      },
    };
  })();

  const plannedTrips = tripRows.filter((t) => t.kind === 'planned')
    .sort((a, b) => String(a.trip.start_date || '').localeCompare(String(b.trip.start_date || '')));
  const favouriteTrips = tripRows.filter((t) => t.favourite);
  const favouriteGuides = all.filter((p) => p.kind === 'favourite');
  const beenTrips = tripRows.filter((t) => t.kind === 'been')
    .sort((a, b) => String(b.trip.start_date || '').localeCompare(String(a.trip.start_date || '')));
  const savedBeen = saved.filter((r) => r.kind === 'been');

  const tripItem = (t) => {
    const active = point && point.tripId === t.id;
    return (
      <li key={t.id}>
        <button type="button" className={s.item} aria-current={active ? 'true' : undefined}
          onClick={() => {
            setSelected(t.pins[0].id); setPreview(null); setOpen(false);
            // From the list, the whole trip: every stop, start to finish.
            const stops = routeFor(t.id);
            fly(groupCamera(stops.length > 1 ? stops : t.pins));
          }}>
          <span className={s.itemPic}>
            <PlacePhoto photoRef={t.pins[0].photo_ref} category="other" size={42} rounded={12} />
            <i className={`${s.dot} ${s.itemDot}`} data-kind={t.kind} />
          </span>
          <span className={s.itemText}>
            <span className={s.itemName}>{t.trip.name}</span>
            <span className={s.itemSub}>
              {[fmtRange(t.trip.start_date, t.trip.end_date), t.pins.map((p) => p.name).join(', ')]
                .filter(Boolean).join(' · ')}
            </span>
          </span>
        </button>
      </li>
    );
  };

  const guideItem = (p) => (
    <li key={p.id}>
      <button type="button" className={s.item} aria-current={selected === p.id ? 'true' : undefined}
        onClick={() => select(p)}>
        <span className={s.itemPic}>
          {p.thumb
            ? <img src={p.thumb} alt="" width={42} height={42} style={{ width: 42, height: 42, borderRadius: 12, objectFit: 'cover', display: 'block' }} />
            : <PlacePhoto photoRef={p.photo_ref} category="other" size={42} rounded={12} />}
          <i className={`${s.dot} ${s.itemDot}`} data-kind="favourite" />
        </span>
        <span className={s.itemText}>
          <span className={s.itemName}>{p.name}</span>
          <span className={s.itemSub}>{['Guide', p.label].filter(Boolean).join(' · ')}</span>
        </span>
      </button>
    </li>
  );

  const savedItem = (r) => {
    const p = savedPoints([r])[0];
    if (!p) return null;
    return (
      <li key={r.id}>
        <button type="button" className={s.item} aria-current={selected === p.id ? 'true' : undefined}
          onClick={() => select(p)}>
          <span className={s.itemPic}>
            <PlacePhoto photoRef={r.photo_ref} category="other" size={42} rounded={12} />
            <i className={`${s.dot} ${s.itemDot}`} data-kind={p.kind} />
          </span>
          <span className={s.itemText}>
            <span className={s.itemName}>{r.name}</span>
            {r.label ? <span className={s.itemSub}>{r.label}</span> : null}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="shell">
      <TopBar><HomeNav active="globe" /></TopBar>
      <main ref={stageRef} className={s.stage} data-route={route ? '' : undefined}>
        <div className={s.canvas}>
          <GlobeCanvas points={shown} selectedId={selected} aim={aim} onSelect={onCanvasSelect} onRegion={onRegion}
            route={route} focus={!!plan} stopIndex={stopIndex} hoverStop={hoverStop} insets={insets}
            stopCard={stopCard}
            onStop={chooseStop} onStopHover={setHoverStop} onDrawn={() => setDrawn(true)} />
        </div>
        <div className={s.loading} data-done={drawn ? '' : undefined} aria-hidden={drawn ? 'true' : undefined}>
          {drawn ? null : <div className={s.loadingCard}><Loading label="Loading your globe" /></div>}
        </div>

        <button type="button" className={`btn ${s.overview}`} data-tip="Whole globe"
          aria-label="Show the whole globe" onClick={() => { setSelected(null); setPreview(null); fly(overviewCamera(all)); }}>
          <Earth size={18} />
        </button>

        <aside ref={panelRef} className={s.panel} data-open={open ? '' : undefined} data-collapsed={collapsed ? '' : undefined}
          aria-label="Your places">
          <button type="button" className={s.grip} aria-expanded={open && !collapsed}
            aria-label={open && !collapsed ? 'Show less' : 'Show all your places'}
            {...panelDrag.handlers}
            onClick={() => {
              if (panelDrag.dragged()) return;
              if (collapsed) { fold(false); setOpen(true); } else setOpen((o) => !o);
            }}>
            <span />
          </button>
          <div className={s.top}>
            <div className={s.head}>
              <h1 className={s.title}>Your globe</h1>
              <button type="button" className={s.fold} aria-expanded={!collapsed} aria-controls="globe-menu"
                aria-label={collapsed ? 'Show the globe menu' : 'Hide the globe menu'}
                data-tip={collapsed ? 'Show menu' : 'Hide menu'} onClick={() => fold(!collapsed)}>
                {/* A side panel on a wide screen, a sheet from the bottom on a phone: each folds its own way. */}
                <span className={s.foldSide}>
                  {collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
                </span>
                <span className={s.foldSheet}>
                  {collapsed ? <ChevronUp size={20} aria-hidden="true" /> : <ChevronDown size={20} aria-hidden="true" />}
                </span>
              </button>
            </div>
            <div className={s.foldArea} data-folded={collapsed ? '' : undefined}
              inert={collapsed || undefined} aria-hidden={collapsed ? 'true' : undefined}>
            <div id="globe-menu" className={s.menu}>
              <div className={s.layers} role="group" aria-label="Show on the globe">
                {['been', 'planned', 'favourite'].map((k) => (
                  <button key={k} type="button" className={s.layer} aria-pressed={layers[k]} onClick={() => toggle(k)}
                    data-tip={KIND_TIP[k]}>
                    <span className={s.layerN}>{loading ? '–' : counts[k]}</span>
                    <span className={s.layerL}><i className={s.dot} data-kind={k} /> {LAYER[k]}</span>
                  </button>
                ))}
              </div>
              <button type="button" role="switch" aria-checked={layers.idea} className={s.ideas}
                onClick={() => toggle('idea')}>
                <span className={s.layerL}><i className={s.dot} data-kind="idea" /> Guide ideas</span>
                <span className={s.switch} aria-hidden="true" />
              </button>
              <div>
                <label className={s.search}>
                  <Search size={16} aria-hidden="true" />
                  <input value={query} maxLength={120}
                    placeholder="Add a place"
                    aria-label="Add a place you have been"
                    onChange={(e) => setQuery(e.target.value)}
                    onFocus={() => setOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape' && query) { e.preventDefault(); setQuery(''); }
                      if (e.key === 'Enter' && results[0]) { e.preventDefault(); pick(results[0]); }
                    }} />
                  {query ? (
                    <button type="button" className={s.clearQ} aria-label="Clear search" onClick={() => setQuery('')}>
                      <X size={15} />
                    </button>
                  ) : null}
                </label>
                {query.trim().length >= 3 ? (
                  <ul className={s.results} aria-label="Places found">
                    {!results.length ? (
                      <li className={s.note}>{searching ? 'Looking…' : searchError || 'Nothing found.'}</li>
                    ) : results.map((r) => (
                      <li key={r.place_id || `${r.lat},${r.lng}`}>
                        <button type="button" className={s.result} onClick={() => pick(r)}>
                          <PlacePhoto photoRef={r.photo_ref} category="other" size={36} rounded={10} />
                          <span className={s.resultText}>
                            <strong>{r.name || r.label}</strong>
                            <span>{r.label}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          </div>
          </div>

          <div className={`${s.foldArea} ${s.listArea}`} data-folded={collapsed ? '' : undefined}
            inert={collapsed || undefined} aria-hidden={collapsed ? 'true' : undefined}>
          <div className={s.list}>
            {loading ? (
              [0, 1, 2].map((i) => <div key={i} className={`skel ${s.skel}`} />)
            ) : loadError ? (
              <div className={s.empty} role="alert">
                <p className={s.emptyTitle}>Could not load your places</p>
                <p>{loadError}</p>
                <button type="button" className="btn sm" onClick={load}>Try again</button>
              </div>
            ) : !own ? (
              <div className={s.empty}>
                <p className={s.emptyTitle}>Nothing on your globe yet</p>
                <p>Your trips land here by themselves. Heart a trip or a guide to keep it in Favourites, or search to add places you’ve been.</p>
              </div>
            ) : (
              <>
                {layers.planned && plannedTrips.length ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="planned" /> Upcoming</h2>
                    <ul className={s.items}>{plannedTrips.map(tripItem)}</ul>
                  </section>
                ) : null}
                {layers.favourite && (favouriteTrips.length || favouriteGuides.length) ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="favourite" /> Favourites</h2>
                    <ul className={s.items}>{favouriteTrips.map(tripItem)}{favouriteGuides.map(guideItem)}</ul>
                  </section>
                ) : null}
                {layers.been && (beenTrips.length || savedBeen.length) ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="been" /> Completed</h2>
                    <ul className={s.items}>{beenTrips.map(tripItem)}{savedBeen.map(savedItem)}</ul>
                  </section>
                ) : null}
              </>
            )}
            {!loading && !loadError ? (
              <Link href="/guides" className={s.browse}>
                <BookOpen size={15} aria-hidden="true" /> Find somewhere new
              </Link>
            ) : null}
          </div>
          </div>
        </aside>

        {plan ? (
          <aside ref={planRef} className={s.plan} data-size={planSize}
            aria-label={`${plan.title}: its places`} key={plan.key}>
            <button type="button" className={s.planGrip} aria-expanded={planSize !== 'name'}
              aria-label={planSize === 'tall' ? 'Show the globe, and this trip by name'
                : planSize === 'days' ? 'Show all of this trip' : "Show this trip's days"}
              {...planDrag.handlers}
              onClick={() => {
                // A drag has already said what size it wanted.
                if (planDrag.dragged()) return;
                setPlanSize((now) => PLAN_SIZES[(PLAN_SIZES.indexOf(now) + 1) % PLAN_SIZES.length]);
              }}>
              <span />
            </button>
            <button type="button" className={s.detailX} aria-label="Close" onClick={() => select(null)}>
              <X size={16} />
            </button>
            {plan.image ? <img className={s.planImg} src={plan.image} alt="" /> : null}
            <div className={s.planHead}>
              <span className={s.kind}><i className={s.dot} data-kind={point.kind} /> {plan.kind}</span>
              <h2 className={s.detailTitle}>{plan.title}</h2>
              <p className={s.detailMeta}>{plan.meta}</p>
              <div className={s.acts}>
                <Link className="btn primary" href={plan.href}>{plan.open}</Link>
                <FavouriteButton on={!!point.favourite} name={plan.title}
                  onToggle={(on) => favourite(plan.target, on, plan.title)} />
              </div>
            </div>
            <div className={s.planList}>
              {!route ? (
                <p className={s.note}>Finding its places…</p>
              ) : plan.days.map((day) => (
                <section key={day.section} className={s.planDay}>
                  <h3 className={s.planDayTitle}>
                    <i className={s.planSwatch} style={{ background: day.colour }} />
                    <span>{day.label}</span>
                    {day.title ? <span className={s.planDaySub}>{day.title}</span> : null}
                  </h3>
                  <ol className={s.planStops}>
                    {day.stops.map(({ stop, i }) => (
                      <li key={i} ref={(el) => { stopRows.current[i] = el; }}>
                        <button type="button" className={s.planStop}
                          aria-current={i === stopIndex ? 'true' : undefined}
                          data-hover={i === hoverStop ? '' : undefined}
                          onMouseEnter={() => setHoverStop(i)} onMouseLeave={() => setHoverStop(null)}
                          onFocus={() => setHoverStop(i)} onBlur={() => setHoverStop(null)}
                          onClick={() => chooseStop(i)}>
                          <span className={s.planNum} style={{ background: day.colour, color: inkOn(day.colour) }}>{stop.n}</span>
                          <span className={s.itemText}>
                            <span className={s.itemName}>{stop.name}</span>
                            {plan.sub(stop) ? <span className={s.itemSub}>{plan.sub(stop)}</span> : null}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
          </aside>
        ) : point ? (
          <div className={s.detail} role="region" aria-label={point.name} key={point.id}>
            <button type="button" className={s.detailX} aria-label="Close" onClick={() => select(null)}>
              <X size={16} />
            </button>
            {point.image || point.photo_ref ? (
              <img className={s.detailImg} src={point.image || photoURL(point.photo_ref, 680)} alt="" />
            ) : null}
            <div className={s.detailBody}>
              <span className={s.kind}><i className={s.dot} data-kind={point.kind} /> {KIND[point.kind]}</span>
              <h2 className={s.detailTitle}>{point.name}</h2>
              {point.kind === 'preview' ? (
                <>
                  {point.label ? <p className={s.detailMeta}>{point.label}</p> : null}
                  <div className={s.acts}>
                    <button type="button" className="btn primary" disabled={busy} onClick={keepPreview}>
                      <Check size={15} /> I’ve been
                    </button>
                  </div>
                </>
              ) : row ? (
                <>
                  {row.label ? (
                    <p className={s.detailMeta}>{row.guide ? `From the guide “${row.label}”` : row.label}</p>
                  ) : null}
                  <div className={s.acts}>
                    {row.guide ? (
                      <Link className="btn primary" href={`/guides/${row.guide}`}>
                        <BookOpen size={15} /> Open the guide
                      </Link>
                    ) : (
                      <Link className="btn primary"
                        href={`/plan?q=${encodeURIComponent(`${row.kind === 'been' ? 'Another trip' : 'A trip'} to ${row.name}`)}`}>
                        <Sparkles size={15} /> {row.kind === 'been' ? 'Plan a return' : 'Plan a trip here'}
                      </Link>
                    )}
                    <button type="button" className="btn ghost" disabled={busy} data-tip="Remove"
                      aria-label={`Remove ${row.name}`} onClick={() => unsave(row)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {(noTable || noFavTable) && !loading ? (
          <p className={s.setup} role="status">
            {noFavTable
              ? 'Trips show here now. Favourites need the latest database update.'
              : 'Trips show here now. Saving your own places needs the latest database update.'}
          </p>
        ) : null}
      </main>
      {viewer ? (
        <Lightbox photos={viewer.photos} index={viewer.index} alt={viewer.title}
          onIndex={(i) => setViewer((v) => (v ? { ...v, index: i } : v))}
          onClose={() => setViewer(null)} />
      ) : null}
    </div>
  );
}
