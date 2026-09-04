'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, Loader2, TriangleAlert, RotateCw, MapPin, Wallet, CalendarDays, Check,
  ImageOff, X,
} from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import { SHOT_KEY } from '@/components/PlanPrompt';
import { handleMessageEnter } from '@/lib/messageKeyboard';
import Loading from '@/components/Loading';
import { activityIcon } from '@/lib/icons';
import { lodgingPayload } from '@/lib/lodging';
import {
  addDays, todayISO, nextSortOrder, categoryOf, fmtTime, money,
} from '@/lib/util';

export default function PlanPage() {
  return (
    <AppProvider>
      <Suspense fallback={<div className="gate"><Loading label="Warming up" /></div>}>
        <Planner />
      </Suspense>
    </AppProvider>
  );
}

function Planner() {
  const params = useSearchParams();
  const router = useRouter();
  const { supabase, user, fail } = useApp();
  const query = (params.get('q') || '').trim();
  /*
   * The pictures, if there are any, read once on mount and held for the life
   * of this page. Held rather than consumed, because "try again" has to work
   * and pictures already cleared cannot be tried again.
   */
  const [shots] = useState(() => {
    if (params.get('shots') !== '1' || typeof sessionStorage === 'undefined') return [];
    try {
      const raw = JSON.parse(sessionStorage.getItem(SHOT_KEY) || '[]');
      return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string' && u) : [];
    } catch (e) { return []; }
  });

  const [meta, setMeta] = useState(null);
  const [days, setDays] = useState([]); // [{ index, theme, activities: [] }]
  // start | reading | clarifying | streaming | locating | reviewing | saving | error
  const [phase, setPhase] = useState('start');
  const [briefCheck, setBriefCheck] = useState(null);
  const [placeReview, setPlaceReview] = useState(null);
  const [error, setError] = useState('');
  const [noKey, setNoKey] = useState(false);
  // What the picture turned out to be, said back so nobody has to guess which
  // part of it was understood.
  const [read, setRead] = useState('');
  const [unreadable, setUnreadable] = useState(false);
  const started = useRef(false);
  const liveRef = useRef(null);
  const lastBrief = useRef('');
  const abortRef = useRef(null);
  const cancelledRef = useRef(false);
  const pendingTripRef = useRef(null);
  const placeReviewResolveRef = useRef(null);

  const discardPendingTrip = useCallback(async () => {
    const tripId = pendingTripRef.current;
    if (!tripId || !supabase) return;
    const { error: discardErr } = await supabase.from('trips').delete().eq('id', tripId);
    if (discardErr) {
      console.error('[planner] could not discard cancelled trip:', discardErr.message);
      return;
    }
    if (pendingTripRef.current === tripId) pendingTripRef.current = null;
  }, [supabase]);

  const cancelPlanning = useCallback(() => {
    cancelledRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    if (placeReviewResolveRef.current) {
      placeReviewResolveRef.current(null);
      placeReviewResolveRef.current = null;
    }
    try { sessionStorage.removeItem(SHOT_KEY); } catch (e) { /* storage may be unavailable */ }
    discardPendingTrip();
    router.replace('/trips');
  }, [discardPendingTrip, router]);

  const upsertDay = useCallback((i, patch) => {
    setDays((prev) => {
      const next = prev.slice();
      const at = next.findIndex((d) => d.index === i);
      if (at === -1) next.push({ index: i, theme: '', activities: [], ...patch });
      else next[at] = { ...next[at], ...patch };
      next.sort((a, b) => a.index - b.index);
      return next;
    });
  }, []);

  const run = useCallback(async (preparedBrief = '') => {
    if (!supabase || !user || (!query && !shots.length)) return;
    cancelledRef.current = false;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(''); setNoKey(false); setMeta(null); setDays([]);
    setUnreadable(false);
    setBriefCheck(null);
    setPlaceReview(null);
    if (!preparedBrief) setRead('');

    /*
     * The picture is read before anything is planned, so "I cannot make a trip
     * out of this" arrives on an empty screen rather than halfway down a
     * half-written itinerary.
     */
    let brief = preparedBrief || query;
    let saw = '';
    if (shots.length && !preparedBrief) {
      setPhase('reading');
      let seen;
      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images: shots, said: query }),
          signal: controller.signal,
        });
        seen = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (seen.code === 'no_key') setNoKey(true);
          if (seen.code === 'unreadable') setUnreadable(true);
          setRead(seen.read || '');
          setError(seen.error
            || `${shots.length === 1 ? 'That picture' : 'Those pictures'} could not be read.`);
          setPhase('error');
          return;
        }
      } catch (e) {
        if (cancelledRef.current || e.name === 'AbortError') return;
        setError('The connection dropped while reading. Try again.');
        setPhase('error');
        return;
      }
      saw = seen.read || '';
      setRead(saw);
      const from = shots.length === 1
        ? 'From a picture the traveller attached:'
        : `From ${shots.length} pictures the traveller attached:`;
      brief = query
        ? `${query}\n\n${from}\n${seen.brief}`
        : `${from}\n${seen.brief}`;
    }

    if (!preparedBrief) {
      setPhase('clarifying');
      try {
        const res = await fetch('/api/plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'clarify', prompt: brief, today: todayISO() }),
          signal: controller.signal,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (body.code === 'no_key') setNoKey(true);
          setError(body.error || 'Could not check the trip details.');
          setPhase('error');
          return;
        }
        if (body.questions && body.questions.length) {
          setBriefCheck({ brief, questions: body.questions, answers: {} });
          return;
        }
      } catch (e) {
        if (cancelledRef.current || e.name === 'AbortError') return;
        setError('The connection dropped while checking the trip details. Try again.');
        setPhase('error');
        return;
      }
    }

    lastBrief.current = brief;
    setPhase('streaming');

    let plan = null;
    try {
      /*
       * Signed, so the planner can look at the calendar.
       *
       * Without this the route has no idea who is asking and cannot fetch
       * anything on their behalf — which is exactly why the first version of
       * this planned around a calendar it had never seen.
       */
      const { data: sess } = await supabase.auth.getSession();
      const token = sess && sess.session ? sess.session.access_token : '';

      const res = await fetch('/api/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ prompt: brief, today: todayISO() }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.code === 'no_key') setNoKey(true);
        setError(body.error || 'Planning failed.');
        setPhase('error');
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      for (;;) {
        // eslint-disable-next-line no-await-in-loop
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt;
          try { evt = JSON.parse(line); } catch (e) { continue; }
          if (evt.t === 'meta') setMeta(evt);
          else if (evt.t === 'day') upsertDay(evt.i, { theme: evt.theme });
          else if (evt.t === 'act') {
            setDays((prev) => {
              const next = prev.slice();
              const at = next.findIndex((d) => d.index === evt.d);
              if (at === -1) next.push({ index: evt.d, theme: '', activities: [evt.a] });
              else next[at] = { ...next[at], activities: [...next[at].activities, evt.a] };
              next.sort((a, b) => a.index - b.index);
              return next;
            });
          } else if (evt.t === 'error') { setError(evt.error); setPhase('error'); return; }
          else if (evt.t === 'done') plan = evt.plan;
        }
      }
    } catch (e) {
      if (cancelledRef.current || e.name === 'AbortError') return;
      setError('The connection dropped while planning. Try again.');
      setPhase('error');
      return;
    }

    if (!plan) { setError('The plan did not finish. Try again.'); setPhase('error'); return; }

    const start = plan.start_date || addDays(todayISO(), 21);
    const end = addDays(start, Math.max(0, plan.duration_days - 1));

    const rows = [];
    plan.days.forEach((d) => {
      const day = addDays(start, d.day_index - 1);
      if (day > end) return;
      d.activities.forEach((a) => {
        rows.push({
          day,
          title: a.title,
          start_time: a.start_time,
          end_time: a.end_time || null,
          category: a.category,
          subtype: a.subtype || null,
          details: a.details || {},
          ...lodgingPayload({ ...a, day }),
          location: a.location,
          cost: a.cost,
          booking_ref: a.booking_ref || '',
          notes: a.notes,
          sort_order: nextSortOrder(rows, day),
        });
      });
    });

    // Resolve every stop in one batch before writing, so the map is already
    // populated the first time it is opened rather than filling in stop by stop.
    if (rows.length) {
      setPhase('locating');
      const targets = rows
        .map((r, i) => ({
          id: String(i), query: r.location, title: r.title, category: r.category, day: r.day,
        }))
        .filter((t) => t.query);
      if (targets.length) {
        try {
          const res = await fetch('/api/places/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              items: targets, bias: plan.destination, reviewAmbiguous: true,
            }),
            signal: controller.signal,
          });
          if (res.ok) {
            const { results } = await res.json();
            const uncertain = [];
            (results || []).forEach((r) => {
              if (!r.found) return;
              const row = rows[Number(r.id)];
              if (!row) return;
              if (r.ambiguous && Array.isArray(r.candidates) && r.candidates.length) {
                uncertain.push({
                  id: r.id,
                  rowIndex: Number(r.id),
                  title: row.title,
                  query: row.location,
                  reason: r.resolution_reason || '',
                  candidates: r.candidates,
                });
                return;
              }
              row.lat = r.lat;
              row.lng = r.lng;
              if (r.place_id) row.place_id = r.place_id;
              if (r.photo_ref) row.photo_ref = r.photo_ref;
              if (r.label) row.location = r.label;
            });

            if (uncertain.length) {
              const choices = await new Promise((resolve) => {
                placeReviewResolveRef.current = resolve;
                setPlaceReview({ items: uncertain, selected: {} });
                setPhase('reviewing');
              });
              placeReviewResolveRef.current = null;
              if (!choices || cancelledRef.current) return;
              choices.forEach(({ rowIndex, candidate }) => {
                if (!candidate) return;
                const row = rows[rowIndex];
                if (!row) return;
                row.lat = candidate.lat;
                row.lng = candidate.lng;
                row.place_id = candidate.place_id || null;
                row.photo_ref = candidate.photo_ref || null;
                row.location = candidate.label || row.location;
              });
              setPlaceReview(null);
            }
          }
        } catch (e) {
          if (cancelledRef.current || e.name === 'AbortError') return;
          // The map can still resolve these later.
        }
      }
    }

    if (cancelledRef.current) return;
    setPhase('saving');

    // Nothing is written until the itinerary and its locations are ready.
    const { data: trip, error: tripErr } = await supabase.from('trips').insert({
      owner_id: user.id,
      name: plan.name,
      destination: plan.destination,
      start_date: start,
      end_date: end,
      currency: plan.currency,
      notes: '',
    }).select().single();

    if (tripErr || !trip) {
      if (cancelledRef.current) return;
      fail(tripErr || new Error('Could not create the trip.'));
      setError('Could not save the trip.');
      setPhase('error');
      return;
    }

    pendingTripRef.current = trip.id;
    if (cancelledRef.current) {
      await discardPendingTrip();
      return;
    }

    // The prompt belongs to the agent conversation, not to the trip's notes.
    // Saving both sides means later requests can refer to an earlier choice.
    const { error: historyErr } = await supabase.from('trip_agent_messages').insert([
      {
        trip_id: trip.id, user_id: user.id, role: 'user', kind: 'initial_prompt',
        content: brief.slice(0, 4000), meta: { pictures: shots.length },
      },
      {
        trip_id: trip.id, user_id: user.id, role: 'assistant', kind: 'initial_plan',
        content: String(plan.summary || 'Initial itinerary created.').slice(0, 4000),
        meta: { name: plan.name, destination: plan.destination, duration_days: plan.duration_days },
      },
    ]);
    if (historyErr) console.error('[agent history] could not save initial brief:', historyErr.message);
    if (cancelledRef.current) {
      await discardPendingTrip();
      return;
    }

    const cover = rows.find((r) => r.photo_ref);
    if (cover) {
      // The first recognisable stop becomes the trip thumbnail. The trips
      // page still falls back to its first photographed activity for older
      // plans that predate cover_ref.
      await supabase.from('trips').update({ cover_ref: cover.photo_ref }).eq('id', trip.id);
    }

    if (cancelledRef.current) {
      await discardPendingTrip();
      return;
    }

    if (rows.length) {
      rows.forEach((row) => { row.trip_id = trip.id; });
      const { error: actErr } = await supabase.from('activities').insert(rows);
      if (actErr && !cancelledRef.current) fail(actErr);
    }

    if (cancelledRef.current) {
      await discardPendingTrip();
      return;
    }
    pendingTripRef.current = null;
    try { sessionStorage.removeItem(SHOT_KEY); } catch (e) { /* storage may be unavailable */ }
    router.replace(`/trips/${trip.id}/itinerary`);
  }, [supabase, user, query, shots, router, fail, upsertDay, discardPendingTrip]);

  useEffect(() => {
    if (started.current || !supabase || !user) return;
    started.current = true;
    run();
  }, [supabase, user, run]);

  // Follow the newest day as it lands, without yanking the whole page.
  useEffect(() => {
    const el = liveRef.current;
    if (!el || phase !== 'streaming') return;
    el.scrollTop = el.scrollHeight;
  }, [days, phase]);

  function answerBrief(id, value) {
    setBriefCheck((current) => (current ? {
      ...current,
      answers: { ...current.answers, [id]: value },
    } : current));
  }

  function continuePlanning(skip = false) {
    if (!briefCheck) return;
    const details = skip ? [] : briefCheck.questions.map((q) => {
      const answer = String(briefCheck.answers[q.id] || '').trim();
      return answer ? `${q.ask}\n${answer}` : '';
    }).filter(Boolean);
    const full = details.length
      ? `${briefCheck.brief}\n\nTraveller answers:\n${details.join('\n\n')}`
      : briefCheck.brief;
    run(full);
  }

  function chooseResolvedPlace(itemId, placeId) {
    setPlaceReview((current) => (current ? {
      ...current,
      selected: { ...current.selected, [itemId]: placeId },
    } : current));
  }

  function continueAfterPlaceReview() {
    if (!placeReview || !placeReviewResolveRef.current) return;
    const choices = placeReview.items.map((item) => {
      const placeId = placeReview.selected[item.id];
      return {
        rowIndex: item.rowIndex,
        candidate: placeId === '__none'
          ? null
          : item.candidates.find((candidate) => candidate.place_id === placeId) || null,
      };
    });
    const resume = placeReviewResolveRef.current;
    placeReviewResolveRef.current = null;
    resume(choices);
  }

  if (!query && !shots.length) {
    return (
      <div className="shell">
        <TopBar />
        <main className="main main-plain">
          <div className="wrap">
            <div className="empty empty-lg">
              <p className="empty-title">Nothing to plan</p>
              <p className="small muted" style={{ marginTop: 0 }}>
                Describe a trip and Wander will lay out the days.
              </p>
              <Link className="btn primary" href="/trips">Go to your trips</Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const totalActs = days.reduce((s, d) => s + d.activities.length, 0);
  const expected = meta && meta.duration_days ? meta.duration_days : 0;
  const answeredBrief = briefCheck
    ? briefCheck.questions.every((q) => String(briefCheck.answers[q.id] || '').trim())
    : false;
  const reviewedPlaces = placeReview
    ? placeReview.items.every((item) => !!placeReview.selected[item.id])
    : false;

  return (
    <div className="shell">
      <TopBar />
      <main className="main main-plain">
        <div className="wrap planwrap">

          <div className="planhead">
            {shots.length ? (
              <span className="planhead-shots">
                {shots.map((u, i) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <img className="planhead-shot" src={u} alt="" key={i} />
                ))}
              </span>
            ) : null}
            <span className="planning-ico" aria-hidden="true">
              {phase === 'error'
                ? (unreadable ? <ImageOff size={18} /> : <TriangleAlert size={18} />)
                : <Sparkles size={18} />}
            </span>
            <div className="planhead-copy">
              <h2 style={{ fontSize: 18 }}>
                {phase === 'error'
                  ? (unreadable
                    ? `I could not read ${shots.length === 1 ? 'that picture' : 'those pictures'}`
                    : 'That did not work')
                  : phase === 'clarifying'
                    ? (briefCheck ? 'A few details first' : 'Checking your trip brief')
                  : phase === 'reviewing'
                    ? 'Check these locations'
                  : meta && meta.name ? meta.name
                    : phase === 'reading'
                      ? `Reading your picture${shots.length === 1 ? '' : 's'}`
                      : 'Planning your trip'}
              </h2>
              <p className="small muted planning-q">
                {query ? <>&ldquo;{query}&rdquo;</> : null}
                {query && read ? ' · ' : null}
                {read || (shots.length && !query
                  ? `From your picture${shots.length === 1 ? '' : 's'}` : null)}
              </p>
            </div>
            <button className="btn ghost plan-cancel" type="button" onClick={cancelPlanning}
              aria-label="Cancel planning and discard this trip">
              <X size={15} /> <span>Cancel</span>
            </button>
          </div>

          {phase === 'clarifying' ? (
            briefCheck ? (
              <form className="card planquestions"
                onSubmit={(e) => { e.preventDefault(); if (answeredBrief) continuePlanning(); }}>
                <p className="small muted planquestions-intro">
                  These answers affect the route enough that guessing would produce the wrong trip.
                </p>
                {briefCheck.questions.map((q, i) => (
                  <fieldset className="planq" key={q.id}>
                    <legend><span>{i + 1}</span>{q.ask}</legend>
                    {q.kind === 'choice' ? (
                      <div className="cmdq-opts">
                        {q.options.map((option) => {
                          const selected = briefCheck.answers[q.id] === option;
                          return (
                            <button type="button" key={option}
                              className={`cmdq-opt${selected ? ' is-on' : ''}`}
                              aria-pressed={selected}
                              onClick={() => answerBrief(q.id, option)}>
                              <span className="cmdq-opt-label">{option}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea className="textarea planq-text" rows={2} enterKeyHint="enter"
                        value={briefCheck.answers[q.id] || ''}
                        placeholder="Type your answer"
                        onKeyDown={(e) => handleMessageEnter(e, () => { if (answeredBrief) continuePlanning(); })}
                        onChange={(e) => answerBrief(q.id, e.target.value)} />
                    )}
                  </fieldset>
                ))}
                <div className="planquestions-actions">
                  <button className="btn" type="button" onClick={() => continuePlanning(true)}>
                    Skip for now
                  </button>
                  <button className="btn primary" type="submit" disabled={!answeredBrief}>
                    Plan my trip
                  </button>
                </div>
              </form>
            ) : (
              <div className="card planning-check">
                <Loader2 size={16} className="spin" /> Checking the details that shape the trip…
              </div>
            )
          ) : phase === 'reviewing' && placeReview ? (
            <form className="card planquestions place-review"
              onSubmit={(e) => { e.preventDefault(); if (reviewedPlaces) continueAfterPlaceReview(); }}>
              <p className="small muted planquestions-intro">
                I found more than one plausible match. Choose the right branch before I save the trip.
              </p>
              {placeReview.items.map((item, i) => (
                <fieldset className="planq" key={item.id}>
                  <legend><span>{i + 1}</span>{item.title}</legend>
                  <p className="tiny dim place-review-query">Requested location: {item.query}</p>
                  <div className="place-review-options">
                    {item.candidates.map((candidate) => {
                      const selected = placeReview.selected[item.id] === candidate.place_id;
                      return (
                        <button type="button" className={`place-review-option${selected ? ' is-on' : ''}`}
                          key={candidate.place_id} aria-pressed={selected}
                          onClick={() => chooseResolvedPlace(item.id, candidate.place_id)}>
                          <MapPin size={15} aria-hidden="true" />
                          <span>
                            <strong>{candidate.name || candidate.label}</strong>
                            <small>{candidate.label}</small>
                          </span>
                        </button>
                      );
                    })}
                    <button type="button"
                      className={`place-review-option${placeReview.selected[item.id] === '__none' ? ' is-on' : ''}`}
                      aria-pressed={placeReview.selected[item.id] === '__none'}
                      onClick={() => chooseResolvedPlace(item.id, '__none')}>
                      <MapPin size={15} aria-hidden="true" />
                      <span>
                        <strong>None of these</strong>
                        <small>Keep the location text without placing a pin.</small>
                      </span>
                    </button>
                  </div>
                </fieldset>
              ))}
              <div className="planquestions-actions">
                <button className="btn primary" type="submit" disabled={!reviewedPlaces}>
                  Continue planning
                </button>
              </div>
            </form>
          ) : phase === 'error' ? (
            <div className="card">
              <div className="planning-err">
                {unreadable ? <ImageOff size={16} /> : <TriangleAlert size={16} />}
                <span>{error}</span>
              </div>
              {noKey ? (
                <p className="small muted">
                  Add <code>OPENAI_API_KEY</code> to <code>.env.local</code> and restart the dev
                  server. Everything else in Wander works without it — you can still build this
                  trip by hand.
                </p>
              ) : null}
              <div className="chiprow" style={{ marginTop: 14 }}>
                {/* Reading the same picture again gets the same answer, so when
                    the picture is the problem the way forward is another one. */}
                {!noKey && !unreadable ? (
                  <button className="btn primary" onClick={() => run(lastBrief.current)}>
                    <RotateCw size={15} /> Try again
                  </button>
                ) : null}
                {unreadable ? (
                  <Link className="btn primary" href="/trips">Try other pictures</Link>
                ) : null}
                <Link className="btn" href="/trips">Build it by hand instead</Link>
              </div>
            </div>
          ) : (
            <>
              {meta && (meta.destination || meta.currency || expected) ? (
                <div className="planmeta">
                  {meta.destination ? (
                    <span><MapPin size={13} /> {meta.destination}</span>
                  ) : null}
                  {expected ? (
                    <span><CalendarDays size={13} /> {expected} day{expected === 1 ? '' : 's'}</span>
                  ) : null}
                  {meta.currency ? <span><Wallet size={13} /> {meta.currency}</span> : null}
                </div>
              ) : null}

              {meta && meta.summary ? (
                <p className="small muted planning-summary">{meta.summary}</p>
              ) : null}

              <div className="planlive" ref={liveRef}>
                {days.length === 0 ? (
                  <div className="planskel">
                    <div className="skel skel-head" />
                    <div className="skel skel-row" />
                    <div className="skel skel-row" />
                  </div>
                ) : null}

                {days.map((d) => (
                  <section className="planday" key={d.index}>
                    <div className="planday-head">
                      <span className="day-num">Day {d.index}</span>
                      <span className="planday-theme">{d.theme}</span>
                    </div>
                    {d.activities.map((a, k) => {
                      const cat = categoryOf(a.category);
                      const Icon = activityIcon(a);
                      return (
                        <div className="planact" key={`${d.index}-${k}`}>
                          <span className="planact-time mono">
                            {a.start_time ? fmtTime(a.start_time) : '—'}
                          </span>
                          <span className={`catico cat-${cat.id}`} aria-hidden="true">
                            <Icon size={13} />
                          </span>
                          <span className="planact-body">
                            <span className="planact-title">{a.title}</span>
                            {a.location ? <span className="tiny dim">{a.location}</span> : null}
                          </span>
                          {a.cost > 0 ? (
                            <span className="planact-cost mono">
                              {money(a.cost, meta ? meta.currency : '')}
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </section>
                ))}
              </div>

              <div className="planfoot">
                {phase === 'reading' ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    Looking at your picture{shots.length === 1 ? '' : 's'}…
                  </>
                ) : phase === 'locating' ? (
                  <>
                    <Loader2 size={15} className="spin" />
                    Finding {totalActs} stop{totalActs === 1 ? '' : 's'} on the map…
                  </>
                ) : phase === 'saving' ? (
                  <>
                    <Check size={15} /> {totalActs} activit{totalActs === 1 ? 'y' : 'ies'} planned
                    {' '}— saving your trip…
                  </>
                ) : (
                  <>
                    <Loader2 size={15} className="spin" />
                    {days.length === 0 ? 'Thinking about where to send you…'
                      : `Day ${days[days.length - 1].index}${expected ? ` of ${expected}` : ''}`
                        + ` · ${totalActs} activit${totalActs === 1 ? 'y' : 'ies'} so far`}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
