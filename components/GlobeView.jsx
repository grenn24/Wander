'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  Search, X, Star, Check, Trash2, BookOpen, Earth, Sparkles, ArrowRight,
} from 'lucide-react';
import TopBar from '@/components/TopBar';
import HomeNav from '@/components/HomeNav';
import PlacePhoto from '@/components/PlacePhoto';
import { useApp } from '@/components/AppProvider';
import { searchPlaces } from '@/lib/geo';
import { readWithSessionRecovery } from '@/lib/sessionRecovery';
import {
  tripPoints, savedPoints, ideaPoints, overviewCamera, focusCamera, groupCamera, globeCounts,
} from '@/lib/globe';
import { fmtRange, humanError, todayISO } from '@/lib/util';
import s from './Globe.module.css';

const GlobeCanvas = dynamic(() => import('./GlobeCanvas'), {
  ssr: false,
  loading: () => <div className={s.hold} />,
});

const IDEAS_KEY = 'wander:globe-ideas';
const KIND = { been: 'Been', planned: 'Planned', want: 'Want to go', idea: 'Journey idea', preview: 'New place' };

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
 * stops puts its towns on the globe, past ones as "been" and the rest as
 * "planned". Saved places cover what Wander never saw — the trips before it,
 * and the places you mean to get to — and journeys sit on the globe as ideas,
 * which is what turns looking back into planning the next one.
 */
export default function GlobeView() {
  const { supabase, user, sessionRevision, fail, pushToast } = useApp();
  const [trips, setTrips] = useState([]);
  const [acts, setActs] = useState([]);
  const [saved, setSaved] = useState([]);
  const [journeys, setJourneys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [noTable, setNoTable] = useState(false);
  const [layers, setLayers] = useState({ been: true, planned: true, want: true, idea: true });
  const [selected, setSelected] = useState(null);
  const [preview, setPreview] = useState(null);
  const [aim, setAim] = useState(() => ({ camera: overviewCamera([]), key: 0, instant: true }));
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [open, setOpen] = useState(false); // the phone sheet, pulled up
  const [busy, setBusy] = useState(false);
  const aimed = useRef(false);
  const wanted = useRef(false);

  const load = useCallback(async () => {
    if (!supabase || !user) return;
    setLoading(true);
    setLoadError('');
    try {
      const { data: t, error: tErr } = await readWithSessionRecovery(supabase, () =>
        supabase.from('trips').select('id, name, destination, start_date, end_date, cover_ref'));
      if (tErr) throw tErr;
      const ids = (t || []).map((x) => x.id);
      let a = [];
      if (ids.length) {
        const { data, error } = await supabase.from('activities')
          .select('trip_id, lat, lng, location, category, photo_ref')
          .in('trip_id', ids)
          .not('lat', 'is', null)
          .limit(5000);
        if (error) throw error;
        a = data || [];
      }
      const { data: rows, error: sErr } = await supabase.from('saved_places')
        .select('*').order('created_at', { ascending: true });
      if (sErr) {
        if (!missingTable(sErr)) throw sErr;
        setNoTable(true);
      }
      setTrips(t || []);
      setActs(a);
      setSaved(rows || []);
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
    fetch('/api/journeys')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setJourneys((d && d.journeys) || []); })
      .catch(() => {});
    try {
      if (localStorage.getItem(IDEAS_KEY) === 'off') setLayers((l) => ({ ...l, idea: false }));
    } catch (e) { /* storage off: ideas stay on */ }
    return () => { alive = false; };
  }, []);

  const today = useMemo(() => todayISO(), []);
  const all = useMemo(() => [
    ...tripPoints(trips, acts, today),
    ...savedPoints(saved),
    ...ideaPoints(journeys, saved),
  ], [trips, acts, saved, journeys, today]);
  const shown = useMemo(() => {
    const list = all.filter((p) => layers[p.kind]);
    return preview ? [...list, preview] : list;
  }, [all, layers, preview]);
  const counts = useMemo(() => globeCounts(all), [all]);
  const point = selected === 'preview' ? preview : all.find((p) => p.id === selected) || null;

  const tripRows = useMemo(() => {
    const by = new Map();
    all.filter((p) => p.tripId).forEach((p) => {
      if (!by.has(p.tripId)) by.set(p.tripId, []);
      by.get(p.tripId).push(p);
    });
    return [...by.values()].map((pins) => ({ id: pins[0].tripId, kind: pins[0].kind, trip: pins[0].trip, pins }));
  }, [all]);

  // Once the places are known, turn the globe to face them.
  useEffect(() => {
    if (loading || aimed.current) return;
    aimed.current = true;
    setAim({ camera: overviewCamera(all), key: Date.now() });
  }, [loading, all]);

  function fly(camera) { setAim({ camera, key: Date.now() }); }

  function select(p) {
    if (!p) { setSelected(null); setPreview(null); return; }
    setSelected(p.id);
    if (p.id !== 'preview') setPreview(null);
    fly(focusCamera(p));
    setOpen(false);
  }

  function onCanvasSelect(id) {
    if (!id) { setSelected(null); setPreview(null); return; }
    const p = id === 'preview' ? preview : all.find((x) => x.id === id);
    if (p) select(p);
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
    const dup = saved.find((r) => (row.place_id && r.place_id === row.place_id)
      || (row.journey && r.journey === row.journey));
    if (dup) return dup.kind === row.kind ? dup : changeKind(dup, row.kind);
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
      journey: row.journey || null,
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

  async function changeKind(row, kind) {
    setBusy(true);
    const { data, error } = await supabase.from('saved_places')
      .update({ kind }).eq('id', row.id).select().single();
    setBusy(false);
    if (error) { fail(error); return null; }
    setSaved((prev) => prev.map((r) => (r.id === row.id ? data : r)));
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

  async function keepPreview(kind) {
    if (!preview) return;
    const row = await save({ ...preview, kind });
    if (!row) return;
    setPreview(null);
    setSelected(`saved:${row.id}`);
    pushToast(kind === 'want' ? `${row.name} is on your want-to-go list.` : `${row.name} is marked as been.`);
  }

  async function saveJourney(slug) {
    const j = journeys.find((x) => x.slug === slug);
    if (!j) return;
    const row = await save({
      kind: 'want',
      name: j.place === j.country ? j.country : j.place,
      label: j.title,
      lat: j.center.lat,
      lng: j.center.lng,
      photo_ref: j.cover_ref,
      journey: j.slug,
    });
    if (!row) return;
    setSelected(`saved:${row.id}`);
    fly(focusCamera({ kind: 'idea', lat: row.lat, lng: row.lng }));
    pushToast(`${j.title} is on your want-to-go list.`);
  }

  // Arriving from a journey's "Save to my globe".
  useEffect(() => {
    if (loading || wanted.current || !journeys.length) return;
    const slug = new URLSearchParams(window.location.search).get('want');
    if (!slug) return;
    wanted.current = true;
    window.history.replaceState(window.history.state, '', '/globe');
    aimed.current = true;
    saveJourney(slug);
  }, [loading, journeys]); // eslint-disable-line react-hooks/exhaustive-deps

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
    fly(focusCamera(p));
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { setSelected(null); setPreview(null); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const own = counts.been + counts.planned + counts.want;
  const row = point && point.savedId ? saved.find((r) => r.id === point.savedId) : null;
  const ideaJourney = point && point.kind === 'idea' ? journeys.find((j) => j.slug === point.journey) : null;

  const plannedTrips = tripRows.filter((t) => t.kind === 'planned')
    .sort((a, b) => String(a.trip.start_date || '').localeCompare(String(b.trip.start_date || '')));
  const beenTrips = tripRows.filter((t) => t.kind === 'been')
    .sort((a, b) => String(b.trip.start_date || '').localeCompare(String(a.trip.start_date || '')));
  const savedBeen = saved.filter((r) => r.kind === 'been');
  const savedWant = saved.filter((r) => r.kind === 'want');

  const tripItem = (t) => {
    const active = point && point.tripId === t.id;
    return (
      <li key={t.id}>
        <button type="button" className={s.item} aria-current={active ? 'true' : undefined}
          onClick={() => { setSelected(t.pins[0].id); setPreview(null); setOpen(false); fly(groupCamera(t.pins)); }}>
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
      <main className={s.stage}>
        <div className={s.canvas}>
          <GlobeCanvas points={shown} selectedId={selected} aim={aim} onSelect={onCanvasSelect} />
        </div>

        <button type="button" className={`btn ${s.overview}`} data-tip="Whole globe"
          aria-label="Show the whole globe" onClick={() => { setSelected(null); setPreview(null); fly(overviewCamera(all)); }}>
          <Earth size={18} />
        </button>

        <aside className={s.panel} data-open={open ? '' : undefined} aria-label="Your places">
          <button type="button" className={s.grip} aria-expanded={open}
            aria-label={open ? 'Show less' : 'Show all your places'} onClick={() => setOpen((o) => !o)}>
            <span />
          </button>
          <div className={s.top}>
            <h1 className={s.title}>Your globe</h1>
            <div className={s.layers} role="group" aria-label="Show on the globe">
              {['been', 'planned', 'want'].map((k) => (
                <button key={k} type="button" className={s.layer} aria-pressed={layers[k]} onClick={() => toggle(k)}>
                  <span className={s.layerN}>{loading ? '–' : counts[k]}</span>
                  <span className={s.layerL}><i className={s.dot} data-kind={k} /> {KIND[k]}</span>
                </button>
              ))}
            </div>
            <button type="button" role="switch" aria-checked={layers.idea} className={s.ideas}
              onClick={() => toggle('idea')}>
              <span className={s.layerL}><i className={s.dot} data-kind="idea" /> Journey ideas</span>
              <span className={s.switch} aria-hidden="true" />
            </button>
            <div>
              <label className={s.search}>
                <Search size={16} aria-hidden="true" />
                <input value={query} maxLength={120}
                  placeholder="Add a place"
                  aria-label="Add a place you have been or want to go"
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
                <p>Your trips land here by themselves. Search to add places you’ve been, or want to go.</p>
              </div>
            ) : (
              <>
                {layers.planned && plannedTrips.length ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="planned" /> Planned</h2>
                    <ul className={s.items}>{plannedTrips.map(tripItem)}</ul>
                  </section>
                ) : null}
                {layers.want && savedWant.length ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="want" /> Want to go</h2>
                    <ul className={s.items}>{savedWant.map(savedItem)}</ul>
                  </section>
                ) : null}
                {layers.been && (beenTrips.length || savedBeen.length) ? (
                  <section className={s.group}>
                    <h2 className={s.groupTitle}><i className={s.dot} data-kind="been" /> Been</h2>
                    <ul className={s.items}>{beenTrips.map(tripItem)}{savedBeen.map(savedItem)}</ul>
                  </section>
                ) : null}
              </>
            )}
            {!loading && !loadError ? (
              <Link href="/journeys" className={s.browse}>
                <BookOpen size={15} aria-hidden="true" /> Find somewhere new
              </Link>
            ) : null}
          </div>
        </aside>

        {point ? (
          <div className={s.detail} role="region" aria-label={point.name} key={point.id}>
            <button type="button" className={s.detailX} aria-label="Close" onClick={() => select(null)}>
              <X size={16} />
            </button>
            {point.photo_ref ? <img className={s.detailImg} src={photoURL(point.photo_ref, 680)} alt="" /> : null}
            <div className={s.detailBody}>
              <span className={s.kind}><i className={s.dot} data-kind={point.kind} /> {KIND[point.kind]}</span>
              <h2 className={s.detailTitle}>{point.name}</h2>
              {point.tripId ? (
                <>
                  <p className={s.detailMeta}>
                    {[point.trip.name, fmtRange(point.trip.start_date, point.trip.end_date),
                      `${point.stops} ${point.stops === 1 ? 'stop' : 'stops'}`].filter(Boolean).join(' · ')}
                  </p>
                  <div className={s.acts}>
                    <Link className="btn primary" href={`/trips/${point.tripId}/itinerary`}>
                      Open trip <ArrowRight size={15} />
                    </Link>
                  </div>
                </>
              ) : point.kind === 'preview' ? (
                <>
                  {point.label ? <p className={s.detailMeta}>{point.label}</p> : null}
                  <div className={s.acts}>
                    <button type="button" className="btn primary" disabled={busy} onClick={() => keepPreview('want')}>
                      <Star size={15} /> Want to go
                    </button>
                    <button type="button" className="btn" disabled={busy} onClick={() => keepPreview('been')}>
                      <Check size={15} /> I’ve been
                    </button>
                  </div>
                </>
              ) : point.kind === 'idea' ? (
                <>
                  <p className={s.detailMeta}>
                    {[point.label, ideaJourney ? `${ideaJourney.days[0]}–${ideaJourney.days[1]} days` : '']
                      .filter(Boolean).join(' · ')}
                  </p>
                  <div className={s.acts}>
                    <Link className="btn primary" href={`/journeys/${point.journey}`}>
                      <BookOpen size={15} /> Read the journey
                    </Link>
                    <button type="button" className="btn" disabled={busy} onClick={() => saveJourney(point.journey)}>
                      <Star size={15} /> Want to go
                    </button>
                  </div>
                </>
              ) : row ? (
                <>
                  {row.label ? (
                    <p className={s.detailMeta}>{row.journey ? `From the journey “${row.label}”` : row.label}</p>
                  ) : null}
                  <div className={s.acts}>
                    {row.journey ? (
                      <Link className="btn primary" href={`/journeys/${row.journey}`}>
                        <BookOpen size={15} /> Open the journey
                      </Link>
                    ) : (
                      <Link className="btn primary"
                        href={`/plan?q=${encodeURIComponent(`${row.kind === 'been' ? 'Another trip' : 'A trip'} to ${row.name}`)}`}>
                        <Sparkles size={15} /> {row.kind === 'been' ? 'Plan a return' : 'Plan a trip here'}
                      </Link>
                    )}
                    {row.kind === 'want' ? (
                      <button type="button" className="btn" disabled={busy} onClick={() => changeKind(row, 'been')}>
                        <Check size={15} /> I’ve been
                      </button>
                    ) : null}
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

        {noTable && !loading ? (
          <p className={s.setup} role="status">
            Trips show here now. Saving your own places needs the latest database update.
          </p>
        ) : null}
      </main>
    </div>
  );
}
