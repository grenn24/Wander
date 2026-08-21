'use client';
import { useEffect, useRef, useState } from 'react';
import {
  MoreHorizontal, MapPin, Printer, Settings, LocateFixed, Copy, Trash2, Clock,
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

/** Structural stops anchor a day; everything else sits between them. */
const ANCHORS = new Set(['transport', 'lodging']);

export default function Itinerary({
  trip, days, activities, onAdd, onEdit, onMove, onDuplicate, onDelete,
  onEditTrip, onPrint, onAddMany,
}) {
  const today = todayISO();
  const todayIndex = days.indexOf(today);
  const [menuFor, setMenuFor] = useState(null);
  const [menuEl, setMenuEl] = useState(null);
  const [activeDay, setActiveDay] = useState(null);
  const [suggestFor, setSuggestFor] = useState(null);
  const jumpedFor = useRef(null);
  const stripRef = useRef(null);
  // A click picks a day deliberately; the spy must not argue with it until the
  // reader scrolls for themselves.
  const pinned = useRef(false);

  const hasStrip = days.length > 3;

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

  // Opening a trip already under way should land on today, not on day 1.
  useEffect(() => {
    if (jumpedFor.current === trip.id) return;
    jumpedFor.current = trip.id;
    if (todayIndex > 0) {
      const el = document.getElementById(`day-${today}`);
      if (el) el.scrollIntoView({ block: 'start' });
    }
  }, [trip.id, todayIndex, today]);

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
            <button className="btn sm primary" onClick={() => jumpTo(today)}>
              <LocateFixed size={15} /> Today
            </button>
          ) : null}
          <button className="btn sm" onClick={onPrint}><Printer size={15} /> Print</button>
          <button className="btn sm" onClick={onEditTrip}><Settings size={15} /> Edit trip</button>
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

            <div className="acts">
              {list.map((a, k) => {
                const cat = categoryOf(a.category);
                const prev = list[k - 1];
                const gapMins = prev && prev.start_time && a.start_time
                  ? minutesBetween(prev.end_time || prev.start_time, a.start_time)
                  : null;
                const place = shortPlace(a.location);

                return (
                  <div key={a.id}>
                    {gapMins != null && gapMins >= 90 ? (
                      <div className="gap">{fmtDuration(gapMins)} free</div>
                    ) : null}

                    <div className={`act${ANCHORS.has(cat.id) ? ' is-anchor' : ''}`}
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

                      <PlacePhoto photoRef={a.photo_ref} category={cat.id} size={44} alt="" />

                      <div className="act-body">
                        <div className="act-title">{a.title}</div>
                        <div className="act-meta">
                          <span className={`cattag cat-${cat.id}`}>{cat.label}</span>
                          {place ? (
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
                          aria-label={`Actions for ${a.title}`} aria-expanded={menuFor === a.id}
                          onClick={(e) => {
                            const same = menuFor === a.id;
                            setMenuEl(e.currentTarget);
                            setMenuFor(same ? null : a.id);
                          }}>
                          <MoreHorizontal size={16} />
                        </button>
                        {menuFor === a.id ? (
                          <Popover anchorEl={menuEl} open width={214}
                            onClose={() => setMenuFor(null)}>
                            <div className="act-menu">
                              <div className="act-menu-row">
                                <span>Move to</span>
                                <Select
                                  value={a.day}
                                  label={`Move ${a.title} to another day`}
                                  options={days.map((dd, di) => ({
                                    value: dd, label: `Day ${di + 1}`, hint: fmtDayTiny(dd),
                                  }))}
                                  onChange={(dd) => { onMove(a, dd); setMenuFor(null); }}
                                />
                              </div>
                              <button type="button"
                                onClick={() => { onDuplicate(a); setMenuFor(null); }}>
                                <Copy size={15} /> Duplicate
                              </button>
                              <button type="button" className="danger"
                                onClick={() => { onDelete(a); setMenuFor(null); }}>
                                <Trash2 size={15} /> Delete
                              </button>
                            </div>
                          </Popover>
                        ) : null}
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
              onSuggest={() => setSuggestFor(suggestFor === d ? null : d)}
              suggestOpen={suggestFor === d}
            />

            {suggestFor === d ? (
              <AiSuggest trip={trip} day={d} dayLabel={`Day ${i + 1}, ${fmtDay(d)}`}
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
              <div className="act" key={a.id} role="button" tabIndex={0} onClick={() => onEdit(a)}
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
    </div>
  );
}
