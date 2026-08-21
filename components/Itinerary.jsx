'use client';
import { useEffect, useRef, useState } from 'react';
import { MoreHorizontal, MapPin, Printer, Settings, LocateFixed, Copy, Trash2, Sparkles } from 'lucide-react';
import AiSuggest from '@/components/AiSuggest';
import { categoryOf, fmtDay, fmtDayTiny, fmtTime, money, sortActs, todayISO } from '@/lib/util';
import { categoryIcon } from '@/lib/icons';
import PlacePhoto from '@/components/PlacePhoto';

export default function Itinerary({
  trip, days, activities, onAdd, onEdit, onMove, onDuplicate, onDelete,
  onQuickAdd, onEditTrip, onPrint, onAddMany,
}) {
  const today = todayISO();
  const todayIndex = days.indexOf(today);
  const [menuFor, setMenuFor] = useState(null);
  const [activeDay, setActiveDay] = useState(null);
  const [suggestFor, setSuggestFor] = useState(null);
  const jumpedFor = useRef(null);
  const stripRef = useRef(null);
  // A click picks a day deliberately; the spy must not argue with it until the
  // reader scrolls for themselves. Near the page bottom several short days are
  // on screen at once, so without this the choice gets overridden immediately.
  const pinned = useRef(false);

  const hasStrip = days.length > 3;

  /** Where content stops being hidden behind the sticky topbar and day strip. */
  function stickyOffset() {
    const bar = document.querySelector('.topbar');
    return (bar ? bar.getBoundingClientRect().height : 0)
      + (stripRef.current ? stripRef.current.getBoundingClientRect().height : 0);
  }

  // Follow the scroll position: whichever day has passed under the strip is
  // the one you are looking at.
  useEffect(() => {
    if (!days.length) return undefined;
    let raf = 0;
    const update = () => {
      raf = 0;
      if (pinned.current) return;
      const doc = document.documentElement;
      // The last days are too short to ever reach the top of the viewport, so
      // once the page bottoms out, credit the final day.
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
    // Only genuine input releases the pin — a programmatic scroll must not.
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

  // Keep the highlighted chip within the strip, without nudging the page.
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activeDay) return;
    const chip = strip.querySelector(`[data-day="${activeDay}"]`);
    if (!chip) return;
    const left = chip.offsetLeft;
    const right = left + chip.offsetWidth;
    const pad = 10;
    if (left < strip.scrollLeft + pad) {
      strip.scrollTo({ left: left - pad, behavior: 'smooth' });
    } else if (right > strip.scrollLeft + strip.clientWidth - pad) {
      strip.scrollTo({ left: right - strip.clientWidth + pad, behavior: 'smooth' });
    }
  }, [activeDay]);

  useEffect(() => {
    if (!menuFor) return undefined;
    const close = (e) => {
      if (!e.target.closest || !e.target.closest('.act-menu-wrap')) setMenuFor(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setMenuFor(null); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuFor]);

  // Opening a trip that is already under way should land on today, not on day 1.
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

  return (
    <div className={`itin${hasStrip ? ' has-strip' : ''}`}>
      <div className="page-head spread">
        <div>
          <h2>{trip.name}</h2>
          <div className="small muted">
            {trip.destination ? `${trip.destination} · ` : ''}{days.length} day{days.length === 1 ? '' : 's'}
            {' · '}{activities.length} activit{activities.length === 1 ? 'y' : 'ies'}
            {' · '}{money(total, trip.currency)} planned
          </div>
        </div>
        <div className="chiprow">
          {todayIndex >= 0 ? (
            <button className="btn sm primary" onClick={() => jumpTo(today)}>
              <LocateFixed size={15} /> Today · Day {todayIndex + 1}
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
                + `${d === today ? ' today' : ''}${d < today ? ' done' : ''}`}>
              <span className="daychip-n">Day {i + 1}</span>
              <span className="daychip-d">{fmtDayTiny(d)}</span>
            </button>
          ))}
        </div>
      ) : null}

      {days.map((d, i) => {
        const list = (byDay[d] || []).slice().sort(sortActs);
        const dayTotal = list.reduce((s, a) => s + Number(a.cost || 0), 0);
        return (
          <section className="day" key={d} id={`day-${d}`}>
            <div className={`day-head${d === today ? ' is-today' : ''}`}>
              <span className="day-num">Day {i + 1}</span>
              <span className="day-date">{fmtDay(d)}</span>
              {d === today ? <span className="today-badge">Today</span> : null}
              {dayTotal > 0 ? <span className="day-total mono">{money(dayTotal, trip.currency)}</span> : null}
            </div>
            <div className="acts">
              {list.map((a) => {
                const cat = categoryOf(a.category);
                const CatIcon = categoryIcon(cat.id);
                return (
                  <div className="act" key={a.id} role="button" tabIndex={0}
                    onClick={() => onEdit(a)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onEdit(a); }}>
                    <div className="act-time mono">
                      {a.start_time ? fmtTime(a.start_time) : <span className="dim">—</span>}
                      {a.end_time ? <div className="dim tiny">{fmtTime(a.end_time)}</div> : null}
                    </div>
                    <PlacePhoto photoRef={a.photo_ref} category={cat.id} size={42} alt="" />
                    <div className="act-body">
                      <div className="act-title">
                        <span>{a.title}</span>
                      </div>
                      <div className="act-meta">
                        {cat.label}
                        {a.location ? ` · ${a.location}` : ''}
                        {a.booking_ref ? ` · ref ${a.booking_ref}` : ''}
                        {a.lat != null && a.lng != null ? (
                          <MapPin size={12} className="meta-ico" aria-label="Pinned on the map" />
                        ) : null}
                      </div>
                    </div>
                    {Number(a.cost) > 0 ? (
                      <div className="act-cost mono">{money(a.cost, trip.currency)}</div>
                    ) : null}
                    <div className="act-menu-wrap"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" type="button"
                        aria-label={`Actions for ${a.title}`} aria-expanded={menuFor === a.id}
                        onClick={() => setMenuFor(menuFor === a.id ? null : a.id)}>
                        <MoreHorizontal size={16} />
                      </button>
                      {menuFor === a.id ? (
                        <div className="act-menu">
                          <label className="act-menu-row">
                            <span>Move to</span>
                            <select value={a.day} aria-label={`Move ${a.title} to another day`}
                              onChange={(e) => { onMove(a, e.target.value); setMenuFor(null); }}>
                              {days.map((dd, di) => (
                                <option key={dd} value={dd}>Day {di + 1} — {fmtDayTiny(dd)}</option>
                              ))}
                            </select>
                          </label>
                          <button type="button"
                            onClick={() => { onDuplicate(a); setMenuFor(null); }}>
                            <Copy size={15} /> Duplicate
                          </button>
                          <button type="button" className="danger"
                            onClick={() => { onDelete(a); setMenuFor(null); }}>
                            <Trash2 size={15} /> Delete
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <QuickAdd day={d} label={fmtDay(d)} onQuickAdd={onQuickAdd} onDetails={onAdd}
              onIdeas={onAddMany ? () => setSuggestFor(suggestFor === d ? null : d) : null}
              ideasOpen={suggestFor === d} />
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
                <div className="act-time mono small">{fmtDayTiny(a.day)}</div>
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

function QuickAdd({ day, label, onQuickAdd, onDetails, onIdeas, ideasOpen }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);

  async function submit(e) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    await onQuickAdd(day, t);
    if (inputRef.current) inputRef.current.focus(); // keep going down the day
  }

  return (
    <form className="quickadd" onSubmit={submit}>
      <input ref={inputRef} className="quickadd-in" value={text}
        aria-label={`Add an activity to ${label}`}
        placeholder={`Add to ${label} — try "9am Senso-ji"`}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setText(''); e.currentTarget.blur(); } }} />
      <button className="btn sm" type="submit" disabled={!text.trim()}>Add</button>
      <button className="btn ghost sm" type="button" title="Add with times, cost and a map pin"
        onClick={() => { onDetails(day, text.trim()); setText(''); }}>Details…</button>
      {onIdeas ? (
        <button className="btn ghost sm icon-btn ideas-btn" type="button" aria-pressed={ideasOpen}
          title={`Suggest activities for ${label}`} onClick={onIdeas}>
          <Sparkles size={15} />
        </button>
      ) : null}
    </form>
  );
}
