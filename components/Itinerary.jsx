'use client';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  MoreHorizontal, MapPin, Printer, Settings, LocateFixed, Copy, Trash2, Clock,
  CalendarClock, Plus,
} from 'lucide-react';
import AiSuggest from '@/components/AiSuggest';
import QuickAdd from '@/components/QuickAdd';
import PlacePhoto from '@/components/PlacePhoto';
import Select from '@/components/Select';
import Popover from '@/components/Popover';
import {
  categoryOf, fmtDay, fmtDayTiny, fmtTime, money, sortActs, todayISO,
  shortPlace, minutesBetween, fmtDuration,
} from '@/lib/util';
import { transportLine } from '@/lib/transport';
import { nowMinutes, readDay } from '@/lib/day';
import useCommitments from '@/lib/useCommitments';
import { useApp } from '@/components/AppProvider';
import { activityIcon } from '@/lib/icons';

/** Structural stops anchor a day; everything else sits between them. */
/*
 * Rows that get an edge down their left side.
 *
 * Transport used to be one of them and no longer is: a flight already carries
 * its own tag, its own icon and a line of flight numbers, and a coloured rule
 * beside all that was a fourth voice saying the same thing. Where you sleep is
 * the one fact a day is actually pinned to, so that keeps its edge.
 */
const ANCHORS = new Set(['lodging']);

/*
 * What kind of thing a calendar entry is.
 *
 * Only ever a guess, and a shallow one — but "Other" for every single import
 * was worse than a guess: it made a hotel booking indistinguishable from a
 * dentist's appointment, and left the planner free to invent a second,
 * vaguer version of the same stay.
 */
const KINDS = [
  [/(hotel|hostel|airbnb|ryokan|resort|stay|check[- ]?in|check[- ]?out|inn|lodge)/i, 'lodging'],
  [/(flight|airport|terminal|train|shinkansen|bus|ferry|transfer|pick[- ]?up|drop[- ]?off)/i, 'transport'],
  [/(lunch|dinner|breakfast|brunch|restaurant|cafe|café|bar|reservation|omakase|table)/i, 'food'],
  [/(museum|temple|shrine|gallery|tour|park|garden|zoo|palace|castle)/i, 'sightseeing'],
];

function guessKind(e) {
  const hay = `${e.title || ''} ${e.where || ''}`;
  const hit = KINDS.find(([re]) => re.test(hay));
  return hit ? hit[1] : 'other';
}

export default function Itinerary({
  trip, days, activities, onAdd, onEdit, onMove, onDuplicate, onDelete,
  onEditTrip, onPrint, onAddMany, focus, onFocused,
  // Which row is waiting on its place before the editor can open. A click that
  // does nothing visible for half a second reads as a click that missed.
  opening = '',
}) {
  const today = todayISO();
  const todayIndex = days.indexOf(today);
  /*
   * Whatever is already in your own calendar on these dates. Shown at the head
   * of the day rather than mixed into the plan: it is not part of the trip and
   * nothing here can move it — it is the shape of the day you have to fit the
   * trip around.
   */
  const { supabase } = useApp();
  const commitments = useCommitments(supabase, trip);
  const params = useSearchParams();
  const pathname = usePathname();
  // Two ways in: the search bar asks through the trip, and a link from outside
  // carries it in the address.
  const urlFocus = params.get('focus');
  const [flash, setFlash] = useState(null);
  // Re-read on a timer so the marked row moves with the day rather than with
  // whenever the page last happened to render.
  const [clock, setClock] = useState(nowMinutes);
  const [menuFor, setMenuFor] = useState(null);
  const [menuEl, setMenuEl] = useState(null);
  const lastMenuAct = useRef(null);
  const [activeDay, setActiveDay] = useState(null);
  const [suggestFor, setSuggestFor] = useState(null);
  const [suggestSeed, setSuggestSeed] = useState('');
  const jumpedFor = useRef(null);
  // Which focus request has already been carried out, so the same one is not
  // served twice while the address still names it.
  const took = useRef(null);
  const actsRef = useRef(activities);
  actsRef.current = activities;
  const stripRef = useRef(null);
  // A click picks a day deliberately; the spy must not argue with it until the
  // reader scrolls for themselves.
  const pinned = useRef(false);

  const hasStrip = days.length > 3;

  /*
   * What is happening right now, if today is one of the trip's days. Marked on
   * the itinerary as well as shown in Traveller mode, from the same reading —
   * two screens disagreeing about where you are would be worse than neither
   * saying anything.
   */
  const onToday = days.includes(today);
  const live = onToday
    ? readDay(activities.filter((a) => a.day === today), clock).now : null;
  const liveId = live ? String(live.id) : null;

  const wantId = (focus && focus.id) || urlFocus || null;
  // The key is what makes a repeat request a new one: the same activity asked
  // for twice has the same id and two different timestamps.
  const wantKey = focus ? `r${focus.at}` : urlFocus ? `u${urlFocus}` : null;
  // A boolean, not the array: it flips once, when the wanted activity arrives.
  const focusHere = !!wantId && activities.some((a) => String(a.id) === String(wantId));

  function stickyOffset() {
    const bar = document.querySelector('.topbar');
    return (bar ? bar.getBoundingClientRect().height : 0)
      + (stripRef.current ? stripRef.current.getBoundingClientRect().height : 0);
  }

  useEffect(() => {
    if (!days.length) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (pinned.current) return;
      const doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        setActiveDay(days[days.length - 1]);
        return;
      }
      const line = stickyOffset() + 16;
      let current = days[0];
      for (let i = 0; i < days.length; i += 1) {
        const el = document.getElementById(`day-${days[i]}`);
        if (!el) continue;
        if (el.getBoundingClientRect().top - line > 0) break;
        current = days[i];
      }
      setActiveDay(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const release = () => { pinned.current = false; };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', release, { passive: true });
    window.addEventListener('touchmove', release, { passive: true });
    window.addEventListener('keydown', release);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', release);
      window.removeEventListener('touchmove', release);
      window.removeEventListener('keydown', release);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [days]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeDay) return;
    const chip = strip.querySelector(`[data-day="${activeDay}"]`);
    if (!chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    if (left < strip.scrollLeft + 10) strip.scrollTo({ left: left - 10, behavior: 'smooth' });
    else if (right > strip.scrollLeft + strip.clientWidth - 10) {
      strip.scrollTo({ left: right - strip.clientWidth + 10, behavior: 'smooth' });
    }
  }, [activeDay]);

  /*
   * The strip's real height drives where the day headers stick and where a
   * jumped-to day lands. A hard-coded constant drifts the moment anything
   * changes that row — a wrapped chip, a different font, or the scrollbar this
   * used to draw — and the symptom is a header sitting over the card below it.
   */
  useEffect(() => {
    const strip = stripRef.current;
    const root = strip && strip.parentElement;
    if (!strip || !root || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--strip-h', `${Math.round(strip.getBoundingClientRect().height)}px`);
    });
    ro.observe(strip);
    return () => ro.disconnect();
  }, [hasStrip]);

  /*
   * Arriving from search: go to the activity, then open it.
   *
   * The id travels in the address, so this works from any tab and from a link.
   * It is an instruction rather than a state, so it is carried out once and
   * then wiped — otherwise searching for the same activity a second time
   * changes nothing in the address, the effect never re-runs, and the search
   * appears to have done nothing at all.
   *
   * Waiting on the data rather than polling the DOM is what makes the rest of
   * the edge cases go away: the old version gave up after two and a half
   * seconds, which is a race a slow trip load wins.
   *
   * What it depends on matters as much as what it does. Depending on the
   * activities themselves meant any unrelated update — someone else's presence,
   * a save landing — replaced the array, tore this down mid-scroll, and then
   * declined to start again because it had already been claimed. So it turns on
   * whether the activity is *there*, which changes exactly once.
   */
  useEffect(() => {
    // Not asked for, not here yet, or already dealt with.
    if (!wantKey || !focusHere || took.current === wantKey) return undefined;
    const act = actsRef.current.find((a) => String(a.id) === String(wantId));
    if (!act) return undefined;

    took.current = wantKey;
    pinned.current = true;
    // Claim the one-time jump to today as well, or it lands an instant scroll
    // on top of this one and the reader ends up somewhere they did not ask for.
    jumpedFor.current = trip.id;

    let alive = true;
    let done = false;
    let frames = 0;
    const run = () => {
      if (!alive) return;
      const el = document.getElementById(`act-${wantId}`);
      // The row can be a paint behind the data it came from.
      if (!el) { frames += 1; if (frames < 20) requestAnimationFrame(run); return; }
      setFlash(String(wantId));
      setTimeout(() => { if (alive) setFlash(null); }, 2600);
      scrollToRow(el, stickyOffset()).then(() => {
        if (!alive) return;
        done = true;
        onEdit(act);
        if (onFocused) onFocused();
        // Take it out of the address by hand. router.replace would do it as a
        // navigation, and the remount that comes with one closes the editor
        // this just opened.
        if (urlFocus && window.history && window.history.replaceState) {
          window.history.replaceState(null, '', pathname);
        }
      });
    };
    requestAnimationFrame(run);
    /*
     * Give the request back if this run did not finish it. React mounts,
     * unmounts and remounts every component once in development, so a claim
     * that outlived its own run left the second attempt with nothing to do —
     * and the request silently disappeared.
     */
    return () => { alive = false; if (!done) took.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantKey, focusHere]);

  useEffect(() => {
    if (!onToday) return undefined;
    const t = setInterval(() => setClock(nowMinutes()), 30000);
    return () => clearInterval(t);
  }, [onToday]);

  /*
   * Opening a trip already under way should land where the day has got to, not
   * on day one and not at the top of today — the useful thing is the row you
   * are in the middle of. Falls back to the day when nothing is running.
   *
   * Once per trip, but the claim is only made once there is something to aim
   * at: staking it on the first render meant staking it before the activities
   * had arrived, and by the time they did, the one shot had been spent on an
   * empty page. It also stands down entirely when a focus request is in
   * flight, because somebody asking for a particular activity beats a guess
   * about the time of day.
   */
  useEffect(() => {
    if (jumpedFor.current === trip.id || wantKey) return undefined;
    if (!onToday && todayIndex <= 0) return undefined;
    if (!activities.length) return undefined;

    let alive = true;
    let tries = 0;
    const go = () => {
      if (!alive) return;
      const row = liveId ? document.getElementById(`act-${liveId}`) : null;
      const dayEl = document.getElementById(`day-${today}`);
      const target = row || dayEl;
      // The rows can be a paint behind the data they came from.
      if (!target) { tries += 1; if (tries < 20) requestAnimationFrame(go); return; }
      jumpedFor.current = trip.id;
      pinned.current = true;
      target.scrollIntoView(row
        ? { behavior: 'smooth', block: 'center' } : { block: 'start' });
    };
    requestAnimationFrame(go);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id, todayIndex, today, liveId, onToday, activities.length, wantKey]);

  function jumpTo(day) {
    const el = document.getElementById(`day-${day}`);
    if (!el) return;
    pinned.current = true;
    setActiveDay(day);
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  if (!days.length) {
    return (
      <div className="empty">
        <p style={{ marginTop: 0 }}>This trip has no dates yet.</p>
        <button className="btn primary" onClick={onEditTrip}>Set trip dates</button>
      </div>
    );
  }

  const byDay = {};
  days.forEach((d) => { byDay[d] = []; });
  activities.forEach((a) => { if (!byDay[a.day]) byDay[a.day] = []; byDay[a.day].push(a); });

  // Keep the last one while the menu animates shut, or its contents would
  // blink away a frame after you clicked.
  const openAct = activities.find((a) => String(a.id) === String(menuFor));
  if (openAct) lastMenuAct.current = openAct;
  const menuAct = openAct || lastMenuAct.current;

  const stray = activities.filter((a) => !days.includes(a.day));
  const total = activities.reduce((s, a) => s + Number(a.cost || 0), 0);
  const planned = days.filter((d) => (byDay[d] || []).length).length;

  return (
    <div className={`itin${hasStrip ? ' has-strip' : ''}`}>
      <div className="page-head spread">
        <div style={{ minWidth: 0 }}>
          <h2>{trip.name}</h2>
          <div className="small muted trip-facts">
            {trip.destination ? <span>{trip.destination}</span> : null}
            <span>{days.length} days</span>
            <span>{planned} planned</span>
            <span>{activities.length} activities</span>
            {total > 0 ? <span>{money(total, trip.currency)}</span> : null}
          </div>
        </div>
        <div className="chiprow">
          {todayIndex >= 0 ? (
            <button className="btn sm primary" data-tip="Jump to today"
              onClick={() => jumpTo(today)}>
              <LocateFixed size={15} /> Today
            </button>
          ) : null}
          <button className="btn sm" onClick={onPrint}
            data-tip="Print or save PDF"><Printer size={15} /> Print</button>
          <button className="btn sm" onClick={onEditTrip}
            data-tip="Dates, budget, name"><Settings size={15} /> Edit trip</button>
        </div>
      </div>

      {hasStrip ? (
        <div className="daystrip" ref={stripRef} role="navigation" aria-label="Jump to a day">
          {days.map((d, i) => (
            <button key={d} type="button" data-day={d} onClick={() => jumpTo(d)}
              aria-current={activeDay === d}
              className={`daychip${activeDay === d ? ' active' : ''}`
                + `${d === today ? ' today' : ''}${d < today ? ' done' : ''}`
                + `${(byDay[d] || []).length ? '' : ' bare'}`}>
              <span className="daychip-n">Day {i + 1}</span>
              <span className="daychip-d">{fmtDayTiny(d)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {days.map((d, i) => {
        const list = (byDay[d] || []).slice().sort(sortActs);
        const dayTotal = list.reduce((s, a) => s + Number(a.cost || 0), 0);
        const timed = list.filter((a) => a.start_time);
        const span = timed.length >= 2
          ? `${fmtTime(timed[0].start_time)} – ${fmtTime(timed[timed.length - 1].start_time)}`
          : timed.length === 1 ? `from ${fmtTime(timed[0].start_time)}` : '';

        return (
          <section className="day" key={d} id={`day-${d}`}>
            <div className={`day-head${d === today ? ' is-today' : ''}`}>
              <span className="day-num">Day {i + 1}</span>
              <span className="day-date">{fmtDay(d)}</span>
              {d === today ? <span className="today-badge">Today</span> : null}
              <span className="grow" />
              <span className="day-facts">
                {span ? <span><Clock size={12} /> {span}</span> : null}
                {list.length ? <span>{list.length} stop{list.length === 1 ? '' : 's'}</span> : null}
                {dayTotal > 0 ? <span className="mono">{money(dayTotal, trip.currency)}</span> : null}
              </span>
            </div>

            {/*
              * Things this trip does not own.
              *
              * Under the day's heading and above its plan, in the app's quiet
              * register, because they are neither activities nor editable —
              * they are the shape of the day that the trip has to fit around.
              */}
            {(commitments[d] || []).length ? (
              <div className="daybusy">
                <CalendarClock size={13} aria-hidden="true" />
                <span className="daybusy-list">
                  {(commitments[d] || []).slice(0, 4).map((e) => (
                    <span className="daybusy-one" key={e.id}>
                      <b className="mono">
                        {e.allDay ? 'All day' : fmtTime(String(e.start).slice(11, 16))}
                      </b>
                      {' '}{e.title}
                      {/*
                        * Some of what is in your calendar on these dates is
                        * the trip — the flight, the hotel, the table you
                        * booked weeks ago. One press moves it across rather
                        * than making you retype what you are looking at.
                        */}
                      <button className="daybusy-add" type="button"
                        data-tip="Add to the trip" aria-label={`Add ${e.title} to the trip`}
                        onClick={() => onAddMany([{
                          day: d,
                          title: e.title,
                          start_time: e.allDay ? null : String(e.start).slice(11, 16),
                          /* A hotel arriving as "Other" is how the same stay
                             ends up in the trip twice under two names. */
                          category: guessKind(e),
                          location: e.where || '',
                          notes: e.details || '',
                        }])}>
                        <Plus size={12} />
                      </button>
                    </span>
                  ))}
                  {(commitments[d] || []).length > 4 ? (
                    <span className="daybusy-one dim">
                      +{(commitments[d] || []).length - 4} more
                    </span>
                  ) : null}
                </span>
              </div>
            ) : null}

            <div className="acts">
              {list.map((a, k) => {
                const cat = categoryOf(a.category);
                const prev = list[k - 1];
                const gapMins = prev && prev.start_time && a.start_time
                  ? minutesBetween(prev.end_time || prev.start_time, a.start_time)
                  : null;
                const place = shortPlace(a.location);
                // A flight's gate is worth more on the row than the address of
                // the airport it leaves from.
                const leg = a.category === 'transport'
                  ? transportLine(a.subtype, a.details) : '';

                return (
                  <div key={a.id}>
                    {gapMins != null && gapMins >= 90 ? (
                      <div className="gap">{fmtDuration(gapMins)} free</div>
                    ) : null}

                    <div id={`act-${a.id}`}
                      className={`act${ANCHORS.has(cat.id) ? ' is-anchor' : ''}`
                        + `${flash === String(a.id) ? ' is-found' : ''}`
                        + `${liveId === String(a.id) ? ' is-live' : ''}`
                        + `${opening === String(a.id) ? ' is-opening' : ''}`}
                      role="button" tabIndex={0}
                      onClick={() => onEdit(a)}
                      onKeyDown={(e) => { if (e.key === 'Enter') onEdit(a); }}>
                      <div className="act-when">
                        {a.start_time ? (
                          <span className="act-t mono">{fmtTime(a.start_time)}</span>
                        ) : <span className="act-t dim">—</span>}
                        {a.end_time ? (
                          <span className="act-t2 mono">{fmtTime(a.end_time)}</span>
                        ) : null}
                      </div>

                      <PlacePhoto photoRef={a.photo_ref} category={cat.id} icon={activityIcon(a)} size={44} alt="" />

                      <div className="act-body">
                        <div className="act-title">{a.title}</div>
                        <div className="act-meta">
                          <span className={`cattag cat-${cat.id}`}>{cat.label}</span>
                          {leg ? <span className="act-leg mono">{leg}</span> : null}
                          {!leg && place ? (
                            <span className="act-place"><MapPin size={11} />{place}</span>
                          ) : null}
                          {a.booking_ref ? <span className="act-ref mono">{a.booking_ref}</span> : null}
                        </div>
                      </div>

                      {Number(a.cost) > 0 ? (
                        <div className="act-cost mono">{money(a.cost, trip.currency)}</div>
                      ) : null}

                      <div className="act-menu-wrap"
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}>
                        <button className="btn ghost sm icon-btn" type="button"
                          data-tip="Move, copy, delete"
                          aria-label={`Actions for ${a.title}`} aria-expanded={menuFor === a.id}
                          onClick={(e) => {
                            const same = menuFor === a.id;
                            setMenuEl(e.currentTarget);
                            setMenuFor(same ? null : a.id);
                          }}>
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <QuickAdd
              day={d}
              label={`Day ${i + 1}, ${fmtDay(d)}`}
              trip={trip}
              existing={list}
              onCreate={(draft) => onAddMany([draft])}
              onManual={onAdd}
              onSuggest={(seed) => {
                setSuggestSeed(seed || '');
                setSuggestFor(suggestFor === d ? null : d);
              }}
              suggestOpen={suggestFor === d}
            />

            {suggestFor === d ? (
              <AiSuggest trip={trip} day={d} dayLabel={`Day ${i + 1}, ${fmtDay(d)}`}
                seed={suggestSeed}
                commitments={commitments[d] || []}
                existing={list} onAdd={onAddMany} onClose={() => setSuggestFor(null)} />
            ) : null}
          </section>
        );
      })}

      {stray.length ? (
        <section className="day">
          <div className="day-head"><span className="day-date">Outside the trip dates</span></div>
          <p className="small muted" style={{ marginTop: 0 }}>
            These fell outside the range when the dates changed. Move them back in, or widen the
            trip dates.
          </p>
          <div className="acts">
            {stray.map((a) => (
              <div className={`act${flash === String(a.id) ? ' is-found' : ''}`} key={a.id}
                id={`act-${a.id}`}
                role="button" tabIndex={0} onClick={() => onEdit(a)}
                onKeyDown={(e) => { if (e.key === 'Enter') onEdit(a); }}>
                <div className="act-when"><span className="act-t mono">{fmtDayTiny(a.day)}</span></div>
                <div className="act-body">
                  <div className="act-title">{a.title}</div>
                  <div className="act-meta">{fmtDay(a.day)}</div>
                </div>
                <div className="act-menu-wrap" onClick={(e) => e.stopPropagation()}>
                  <button className="btn sm" type="button" onClick={() => onMove(a, days[0])}>
                    Move to Day 1
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* One menu for the list, not one per row: it is only ever open for a
          single activity, and rendering it inline meant twenty-odd day selects
          built and thrown away on every pass — and no way to animate it out,
          since the row dropped it the instant it closed. */}
      <Popover anchorEl={menuEl} open={!!menuFor} width={214}
        onClose={() => setMenuFor(null)}>
        {menuAct ? (
          <div className="act-menu">
            <div className="act-menu-row">
              <span>Move to</span>
              <Select
                value={menuAct.day}
                label={`Move ${menuAct.title} to another day`}
                options={days.map((dd, di) => ({
                  value: dd, label: `Day ${di + 1}`, hint: fmtDayTiny(dd),
                }))}
                onChange={(dd) => { onMove(menuAct, dd); setMenuFor(null); }}
              />
            </div>
            <button type="button"
              onClick={() => { onDuplicate(menuAct); setMenuFor(null); }}>
              <Copy size={15} /> Duplicate
            </button>
            <button type="button" className="danger"
              onClick={() => { onDelete(menuAct); setMenuFor(null); }}>
              <Trash2 size={15} /> Delete
            </button>
          </div>
        ) : null}
      </Popover>
    </div>
  );
}

/*
 * Put a row on screen and say when it has arrived.
 *
 * scrollIntoView with block:"center" cannot see the sticky title bar and day
 * strip, so a row near the top of the document lands underneath them; this
 * centres within the space that is actually visible instead. And the caller
 * has to know when the scrolling has stopped, because opening the editor locks
 * the page — do it too early and the scroll is frozen halfway there.
 */
function scrollToRow(el, head) {
  const box = el.getBoundingClientRect();
  const room = window.innerHeight - head;
  const want = window.scrollY + box.top - head - Math.max(12, (room - box.height) / 2);
  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollTo({ top: Math.max(0, want), behavior: still ? 'auto' : 'smooth' });

  return new Promise((done) => {
    let last = null;
    let steady = 0;
    let frames = 0;
    const watch = () => {
      const y = Math.round(window.scrollY);
      if (y === last) steady += 1; else { steady = 0; last = y; }
      frames += 1;
      // Three still frames is the end of it; the frame cap is the escape hatch
      // for a scroll that never settles, so nothing can hang here.
      if (steady >= 3 || frames > 90) { done(); return; }
      requestAnimationFrame(watch);
    };
    requestAnimationFrame(watch);
  });
}
