'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Sparkles, TriangleAlert, RotateCw, MapPin, Wallet, CalendarDays,
  ImageOff, X, Check, Loader2,
} from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import { SHOT_KEY } from '@/components/PlanPrompt';
import { BRIEF_KEY } from '@/lib/planBrief';
import { tickAnswer, isAnswered, answerText } from '@/lib/briefAnswers';
import { handleMessageEnter } from '@/lib/messageKeyboard';
import Loading from '@/components/Loading';
import PlanningJourney from '@/components/PlanningJourney';
import { PlaceChoices } from '@/components/PlaceReview';
import { planningProgress } from '@/lib/planningProgress';
import {
  readPlan, resumePoint, resumeBrief, mergeResumed, RESUME_LIMIT,
} from '@/lib/planResume';
import { followDraft } from '@/lib/planDraft';
import { activityIcon, tripHome } from '@/lib/icons';
import { lodgingPayload } from '@/lib/lodging';
import { authHeader } from '@/lib/supabase';
import { transportLine } from '@/lib/transport';
import { cleanHome, homeName } from '@/lib/home';
import { dayIndexOf, fixedFlights } from '@/lib/flightPlan';
import { flightGroups } from '@/lib/pinPlaces';
import { sortPlaces, withChosenPlaces } from '@/lib/tripChanges';
import { pinFields } from '@/lib/geo';
import {
  addDays, todayISO, nextSortOrder, categoryOf, fmtTime, money, sortActs,
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

  /*
   * A long brief, when the page that sent us wrote one — a guide someone has
   * made their own. The address holds only its title, which is what the
   * planning screen shows back; this is what the planner is actually given.
   */
  const [longBrief] = useState(() => {
    if (params.get('brief') !== '1' || typeof sessionStorage === 'undefined') return '';
    try { return sessionStorage.getItem(BRIEF_KEY) || ''; } catch (e) { return ''; }
  });

  const [meta, setMeta] = useState(null);
  const [days, setDays] = useState([]); // [{ index, theme, activities: [] }]
  /*
   * The flights there and home, found before the plan (app/api/flights): the
   * legs as activities, and the day the trip starts, which places them.
   */
  const [travel, setTravel] = useState(null); // { start, legs: [] }
  // start | reading | clarifying | flights | streaming | matching | locating | reviewing | saving | error
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
  // The server's copy of the plan being written (lib/planDraft.js).
  const draftRef = useRef(null);
  // The trip being written, while it is: a cancel waits for it, to delete it.
  const savingRef = useRef(null);
  const leavingRef = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const placeReviewResolveRef = useRef(null);

  // Cancel and the save it interrupts both ask for this; they share one delete.
  const discardingRef = useRef(null);
  const discardPendingTrip = useCallback(() => {
    if (discardingRef.current) return discardingRef.current;
    const tripId = pendingTripRef.current;
    if (!tripId || !supabase) return Promise.resolve();
    discardingRef.current = (async () => {
      const { error: discardErr } = await supabase.rpc('delete_trip', { p_trip: tripId });
      if (discardErr) {
        console.error('[planner] could not discard cancelled trip:', discardErr.message);
        return;
      }
      if (pendingTripRef.current === tripId) pendingTripRef.current = null;
    })().finally(() => { discardingRef.current = null; });
    return discardingRef.current;
  }, [supabase]);

  /*
   * Cancel ends on the trips page, without the trip.
   *
   * A trip that is already written, or being written, is deleted before the
   * page changes, so the list it lands on cannot still show it. That wait is
   * capped: a delete that never answers must not keep anyone here. Nothing
   * needs deleting before the save starts, so Cancel leaves at once.
   */
  const cancelPlanning = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setLeaving(true);
    cancelledRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    /*
     * The server goes on writing a plan when the connection to it closes,
     * because that is usually a tab gone to sleep. Cancel is the one time it
     * should stop, and this is how it hears: its next save finds the draft no
     * longer running and stops the model.
     */
    if (draftRef.current && supabase) {
      supabase.from('plan_drafts').update({ status: 'cancelled' })
        .eq('id', draftRef.current).eq('status', 'running')
        .then(() => {}, () => {});
      draftRef.current = null;
    }
    if (placeReviewResolveRef.current) {
      placeReviewResolveRef.current(null);
      placeReviewResolveRef.current = null;
    }
    try { sessionStorage.removeItem(SHOT_KEY); } catch (e) { /* storage may be unavailable */ }
    if (savingRef.current || pendingTripRef.current) {
      const discard = async () => {
        if (savingRef.current) await savingRef.current.catch(() => {});
        await discardPendingTrip();
      };
      await Promise.race([discard(), new Promise((done) => { setTimeout(done, 4000); })]);
    }
    router.replace('/trips');
  }, [discardPendingTrip, router]);

  const run = useCallback(async (preparedBrief = '') => {
    if (!supabase || !user || (!query && !shots.length)) return;
    cancelledRef.current = false;
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(''); setNoKey(false); setMeta(null); setDays([]); setTravel(null);
    setUnreadable(false);
    setBriefCheck(null);
    setPlaceReview(null);
    if (!preparedBrief) setRead('');

    /*
     * The picture is read before anything is planned, so "I cannot make a trip
     * out of this" arrives on an empty screen rather than halfway down a
     * half-written itinerary.
     */
    let brief = preparedBrief || longBrief || query;
    let saw = '';
    if (shots.length && !preparedBrief) {
      setPhase('reading');
      let seen;
      try {
        const res = await fetch('/api/vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
        if (cancelledRef.current || abortRef.current !== controller) return;
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
          headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
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
        if (cancelledRef.current || abortRef.current !== controller) return;
        setError('The connection dropped while checking the trip details. Try again.');
        setPhase('error');
        return;
      }
    }

    // A check whose answer was cut off by Cancel reads as "no questions".
    if (cancelledRef.current) return;
    lastBrief.current = brief;

    /*
     * The flights there and home, before a single day is written: when they
     * land and leave is what the first and last days can hold. Never in the
     * way of a plan — a failure here plans the trip without them.
     */
    setPhase('flights');
    let fixed = null;
    let homeLegs = [];
    try {
      const res = await fetch('/api/flights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
        body: JSON.stringify({ mode: 'trip', prompt: brief, today: todayISO() }),
        signal: controller.signal,
      });
      const found = res.ok ? await res.json().catch(() => ({})) : {};
      const home = cleanHome(found.origin);
      // Asked once and kept: the next trip starts from here without asking.
      if (found.remember && home) {
        supabase.auth.updateUser({ data: { home } }).then(({ error: homeErr }) => {
          if (homeErr) console.error('[planner] could not keep the home:', homeErr.message);
        }, () => {});
      }
      const flights = Array.isArray(found.flights) ? found.flights : [];
      if (found.dates && flights.length && home) {
        fixed = {
          ...found.dates,
          currency: found.currency || null,
          home: homeName(home),
          home_airports: home.airports,
          flights: fixedFlights(flights),
        };
        homeLegs = flights.flatMap((f) => f.legs || []);
        setTravel({ start: found.dates.start_date, legs: homeLegs });
      }
    } catch (e) {
      if (cancelledRef.current || abortRef.current !== controller) return;
      // Planned without flights, as every trip was before.
    }
    if (cancelledRef.current) return;
    setPhase('streaming');

    /*
     * What has arrived, held here as well as in state, because picking a plan
     * up is built from it and state cannot be read from inside this function.
     */
    const drafted = new Map(); // index -> { index, theme, activities }
    let firstMeta = null;
    const show = () => setDays([...drafted.values()]
      .sort((a, b) => a.index - b.index)
      .map((d) => ({ ...d, activities: d.activities.slice() })));
    const dayOf = (i) => {
      if (!drafted.has(i)) drafted.set(i, { index: i, theme: '', activities: [] });
      return drafted.get(i);
    };
    let resume = null; // { from, kept } while picking up a plan that stopped
    const onEvent = (evt) => {
      if (evt.t === 'job') {
        // Where this answer is being kept, should the connection to it be lost.
        draftRef.current = evt.id;
      } else if (evt.t === 'meta') {
        // The trip as first described stays put while later days are asked for.
        if (!resume || !firstMeta || !firstMeta.name) { firstMeta = evt; setMeta(evt); }
      } else if (evt.t === 'day') {
        dayOf(evt.i).theme = evt.theme;
        show();
      } else if (evt.t === 'act') {
        dayOf(evt.d).activities.push(evt.a);
        show();
      }
    };

    let plan = null;
    let attempts = 0;
    let lastFrom = 0;
    let stuck = 0;
    for (;;) {
      attempts += 1;
      draftRef.current = null;
      let out;
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
          body: JSON.stringify({
            prompt: brief,
            today: todayISO(),
            ...(fixed ? { fixed } : {}),
            ...(resume ? { resume: resumeBrief(firstMeta, resume.kept, resume.from) } : {}),
          }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          if (body.code === 'no_key') setNoKey(true);
          setError(body.error || 'Planning failed.');
          setPhase('error');
          return;
        }
        out = await readPlan(res.body, { onEvent, signal: controller.signal });
      } catch (e) {
        // Only Cancel, or a newer run, stops this one quietly. Anything else
        // that ends the stream is the connection, and the plan is picked up.
        if (cancelledRef.current || abortRef.current !== controller) return;
        out = { cut: 'dropped' };
      }

      if (out.error) { setError(out.error); setPhase('error'); return; }

      /*
       * The connection was lost, but the server goes on writing the plan and
       * keeping it, so it is read from there — usually finished by the time a
       * tab that fell asleep is looked at again — rather than paid for twice.
       */
      const job = draftRef.current;
      if (!out.plan && job) {
        const from = resume ? resume.from : 1;
        try {
          // eslint-disable-next-line no-await-in-loop
          const kept = await followDraft({
            read: async () => {
              const { data, error: readErr } = await supabase.from('plan_drafts')
                .select('status, plan, updated_at, created_at').eq('id', job).maybeSingle();
              if (readErr) throw readErr;
              return data;
            },
            onDraft: (saved) => {
              if (!firstMeta && saved.name) { firstMeta = saved; setMeta(saved); }
              (saved.days || []).forEach((d) => {
                if (Number(d.day_index) < from) return;
                drafted.set(d.day_index, {
                  index: d.day_index, theme: d.theme || '', activities: (d.activities || []).slice(),
                });
              });
              show();
            },
            signal: controller.signal,
          });
          if (kept.plan) out = { plan: kept.plan };
          else console.warn(`[planner] the kept plan cannot be used (${kept.fallback})`);
        } catch (e) {
          if (cancelledRef.current || abortRef.current !== controller) return;
        }
      }

      if (out.plan) {
        plan = resume ? mergeResumed(firstMeta, resume.kept, out.plan, resume.from) : out.plan;
        break;
      }

      /*
       * The stream stopped before the plan was finished: on production a
       * connection carrying a fourteen-day plan was lost at day 5, and at day
       * 12. Keep what arrived, and ask for the rest from the last day — which
       * is drafted again, since it may have been cut off half way.
       */
      const point = resumePoint([...drafted.values()]);
      stuck = point.from > lastFrom ? 0 : stuck + 1;
      lastFrom = point.from;
      if (attempts >= RESUME_LIMIT || stuck >= 2) {
        setError('The plan kept stopping part way through. Try again.');
        setPhase('error');
        return;
      }
      console.warn(`[planner] the plan stopped (${out.cut}); picking it up at day ${point.from}`);
      for (const i of [...drafted.keys()]) if (i >= point.from) drafted.delete(i);
      show();
      resume = point;
    }

    const start = plan.start_date || addDays(todayISO(), 21);
    let end = addDays(start, Math.max(0, plan.duration_days - 1));

    let rows = [];
    // Beside the rows, not on them: they are inserted as they are. Whether the
    // traveller named each venue, or the planner picked it.
    let named = [];
    plan.days.forEach((d) => {
      const day = addDays(start, d.day_index - 1);
      if (day > end) return;
      d.activities.forEach((a) => {
        named.push(a.named_place === true);
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

    /*
     * The flights the planner put inside the trip (Tokyo to Sapporo) made
     * real, by the service every way of making entries shares
     * (lib/flightMatch.js): the real flight nearest the time it planned
     * around, or the one the traveller named. One that cannot be matched
     * stays as the planner wrote it.
     */
    if (rows.some((r) => r.category === 'transport' && r.subtype === 'flight')) {
      setPhase('matching');
      try {
        const groups = await flightGroups(rows, {
          said: brief, currency: plan.currency, signal: controller.signal,
        });
        const nextRows = [];
        const nextNamed = [];
        groups.forEach((legs, i) => legs.forEach((leg, k) => {
          nextRows.push({ ...leg, sort_order: nextSortOrder(nextRows, leg.day) });
          nextNamed.push(k === 0 ? named[i] : false);
        }));
        rows = nextRows;
        named = nextNamed;
      } catch (e) {
        if (cancelledRef.current || abortRef.current !== controller) return;
        // The planner's flights stand as written.
      }
    }

    // The way there and home, as the real legs. A connection home can leave
    // the day after the last one, and the trip runs until it does.
    homeLegs.forEach((leg) => {
      rows.push({ ...leg, sort_order: nextSortOrder(rows, leg.day) });
      named.push(false);
      if (leg.day > end) end = leg.day;
    });

    // Resolve every stop in one batch before writing, so the map is already
    // populated the first time it is opened rather than filling in stop by stop.
    // A flight is already pinned at its airport.
    if (rows.length) {
      setPhase('locating');
      const targets = rows
        .map((r, i) => ({
          id: String(i), query: r.location, title: r.title, category: r.category, day: r.day,
          named: named[i],
        }))
        .filter((t, i) => t.query && !Number.isFinite(rows[i].lat));
      if (targets.length) {
        try {
          const res = await fetch('/api/places/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
            body: JSON.stringify({
              items: targets, bias: plan.destination, reviewAmbiguous: true,
            }),
            signal: controller.signal,
          });
          if (res.ok) {
            const { results } = await res.json();
            /*
             * Sorted as the command bar and the Assistant sort theirs
             * (lib/tripChanges.js): which branch is a question only for a
             * place the traveller named; the planner's own picks take the
             * best-ranked match, or keep their words when none was trusted.
             */
            const sorted = sortPlaces(results, targets);
            let { resolved } = sorted;
            if (sorted.uncertain.length) {
              const selected = await new Promise((resolve) => {
                placeReviewResolveRef.current = resolve;
                setPlaceReview({ items: sorted.uncertain, selected: {} });
                setPhase('reviewing');
              });
              placeReviewResolveRef.current = null;
              if (!selected || cancelledRef.current) return;
              resolved = withChosenPlaces(resolved, sorted.uncertain, selected);
              setPlaceReview(null);
            }
            Object.entries(resolved).forEach(([id, place]) => {
              const row = rows[Number(id)];
              if (row && place) Object.assign(row, pinFields(place, row.location));
            });
          }
        } catch (e) {
          if (cancelledRef.current || abortRef.current !== controller) return;
          // The map can still resolve these later.
        }
      }
    }

    if (cancelledRef.current) return;
    setPhase('saving');

    // Nothing is written until the itinerary and its locations are ready.
    // Promise.resolve runs the insert once: the query is a thenable that
    // would insert again for every `await` on it, and a cancel awaits it too.
    const saving = Promise.resolve(supabase.from('trips').insert({
      owner_id: user.id,
      name: plan.name,
      destination: plan.destination,
      start_date: start,
      end_date: end,
      currency: plan.currency,
      timezone: plan.timezone || null,
      notes: '',
    }).select().single()).then((out) => {
      if (out.data) pendingTripRef.current = out.data.id;
      return out;
    });
    savingRef.current = saving;
    const { data: trip, error: tripErr } = await saving;

    if (tripErr || !trip) {
      if (cancelledRef.current) return;
      fail(tripErr || new Error('Could not create the trip.'));
      setError('Could not save the trip.');
      setPhase('error');
      return;
    }

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
    /*
     * The trip stays pending until this page is gone. Opening it takes a
     * moment, and this screen and its Cancel are still up for that moment;
     * clearing it here meant a Cancel then went to the trips page and left
     * the trip in the list.
     */
    try { sessionStorage.removeItem(SHOT_KEY); } catch (e) { /* storage may be unavailable */ }
    router.replace(tripHome(trip.id));
  }, [supabase, user, query, longBrief, shots, router, fail, discardPendingTrip]);

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

  function tickBrief(id, option) {
    setBriefCheck((current) => (current ? {
      ...current,
      answers: { ...current.answers, [id]: tickAnswer(current.answers[id], option) },
    } : current));
  }

  function continuePlanning(skip = false) {
    if (!briefCheck) return;
    const details = skip ? [] : briefCheck.questions.map((q) => {
      const answer = answerText(briefCheck.answers[q.id]);
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
    const resume = placeReviewResolveRef.current;
    placeReviewResolveRef.current = null;
    resume(placeReview.selected);
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

  const expected = meta && meta.duration_days ? meta.duration_days : 0;
  /*
   * The days as they will be saved: the planner's, with the flights there and
   * home in their places. A flight's day shows once the plan has reached it,
   * so the way home does not sit at the foot of a plan still on day 2.
   */
  const reached = days.reduce((n, d) => Math.max(n, d.index), 1);
  const shownDays = (() => {
    if (!travel || !travel.legs.length) return days;
    const byDay = new Map(days.map((d) => [d.index, { ...d, activities: d.activities.slice() }]));
    travel.legs.forEach((leg) => {
      const i = dayIndexOf(travel.start, leg.day);
      if (i < 1 || (phase === 'streaming' && i > reached)) return;
      if (!byDay.has(i)) byDay.set(i, { index: i, theme: '', activities: [] });
      byDay.get(i).activities.push(leg);
    });
    return [...byDay.values()].sort((a, b) => a.index - b.index)
      .map((d) => ({ ...d, activities: d.activities.slice().sort(sortActs) }));
  })();
  const progress = planningProgress({
    phase, awaitingAnswers: !!briefCheck, pictureCount: shots.length, days: shownDays, expected,
  });
  const answeredBrief = briefCheck
    ? briefCheck.questions.every((q) => isAnswered(briefCheck.answers[q.id]))
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
              disabled={leaving} aria-busy={leaving}
              aria-label={leaving ? 'Cancelling' : 'Cancel planning and discard this trip'}>
              {leaving
                ? <><Loader2 size={15} className="spin" /> <span>Cancelling</span></>
                : <><X size={15} /> <span>Cancel</span></>}
            </button>
          </div>

          {progress ? <PlanningJourney status={progress} /> : null}

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
                    {q.kind === 'choice' || q.kind === 'multi' ? (
                      <div className="cmdq-opts">
                        {q.options.map((option) => {
                          const multi = q.kind === 'multi';
                          const answer = briefCheck.answers[q.id];
                          const selected = multi
                            ? Array.isArray(answer) && answer.includes(option)
                            : answer === option;
                          return (
                            <button type="button" key={option}
                              className={`cmdq-opt${selected ? ' is-on' : ''}`}
                              aria-pressed={selected}
                              onClick={() => (multi ? tickBrief(q.id, option) : answerBrief(q.id, option))}>
                              {multi ? (
                                <span className="cmdq-box" aria-hidden="true">
                                  {selected ? <Check size={12} /> : null}
                                </span>
                              ) : null}
                              <span className="cmdq-opt-label">{option}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <textarea className="textarea planq-text" rows={2} enterKeyHint="enter"
                        value={briefCheck.answers[q.id] || ''}
                        placeholder={q.id === 'origin' ? 'Town, city or airport' : 'Type your answer'}
                        onKeyDown={(e) => handleMessageEnter(e, () => { if (answeredBrief) continuePlanning(); })}
                        onChange={(e) => answerBrief(q.id, e.target.value)} />
                    )}
                    {q.id === 'origin' ? (
                      <p className="tiny dim planq-hint">
                        For the flights there and back. Wander keeps it as your home for
                        later trips; change it in Account.
                      </p>
                    ) : null}
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
            ) : null
          ) : phase === 'reviewing' && placeReview ? (
            <form className="card planquestions place-review"
              onSubmit={(e) => { e.preventDefault(); if (reviewedPlaces) continueAfterPlaceReview(); }}>
              <p className="small muted planquestions-intro">
                You named {placeReview.items.length === 1 ? 'a place' : 'places'} I found in
                more than one spot. Choose the one you meant before I save the trip.
              </p>
              <PlaceChoices items={placeReview.items} selected={placeReview.selected}
                onChoose={chooseResolvedPlace} />
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
                {shownDays.length === 0 ? (
                  <div className="planskel">
                    <div className="skel skel-head" />
                    <div className="skel skel-row" />
                    <div className="skel skel-row" />
                  </div>
                ) : null}

                {shownDays.map((d) => (
                  <section className="planday" key={d.index}>
                    <div className="planday-head">
                      <span className="day-num">Day {d.index}</span>
                      <span className="planday-theme">{d.theme}</span>
                    </div>
                    {d.activities.map((a, k) => {
                      const cat = categoryOf(a.category);
                      const Icon = activityIcon(a);
                      // A flight is its number and airports, not the terminal it is pinned at.
                      const line = a.category === 'transport' ? transportLine(a.subtype, a.details) : '';
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
                            {line || a.location
                              ? <span className="tiny dim">{line || a.location}</span> : null}
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


            </>
          )}
        </div>
      </main>
    </div>
  );
}
