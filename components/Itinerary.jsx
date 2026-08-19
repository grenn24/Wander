'use client';
import { categoryOf, fmtDay, fmtTime, money, sortActs } from '@/lib/util';

export default function Itinerary({ trip, days, activities, onAdd, onEdit, onMove, onEditTrip }) {
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
    <div>
      <div className="page-head spread">
        <div>
          <h2>{trip.name}</h2>
          <div className="small muted">
            {trip.destination ? `${trip.destination} · ` : ''}{days.length} day{days.length === 1 ? '' : 's'}
            {' · '}{activities.length} activit{activities.length === 1 ? 'y' : 'ies'}
            {' · '}{money(total, trip.currency)} planned
          </div>
        </div>
        <button className="btn sm" onClick={onEditTrip}>Edit trip</button>
      </div>

      {days.map((d, i) => {
        const list = (byDay[d] || []).slice().sort(sortActs);
        const dayTotal = list.reduce((s, a) => s + Number(a.cost || 0), 0);
        return (
          <section className="day" key={d}>
            <div className="day-head">
              <span className="day-num">Day {i + 1}</span>
              <span className="day-date">{fmtDay(d)}</span>
              {dayTotal > 0 ? <span className="day-total mono">{money(dayTotal, trip.currency)}</span> : null}
            </div>
            <div className="acts">
              {list.map((a) => {
                const cat = categoryOf(a.category);
                return (
                  <div className="act" key={a.id} role="button" tabIndex={0}
                    onClick={() => onEdit(a)}
                    onKeyDown={(e) => { if (e.key === 'Enter') onEdit(a); }}>
                    <div className="act-time mono">
                      {a.start_time ? fmtTime(a.start_time) : <span className="dim">—</span>}
                      {a.end_time ? <div className="dim tiny">{fmtTime(a.end_time)}</div> : null}
                    </div>
                    <div className="act-body">
                      <div className="act-title">
                        <span className={`dot cat-${cat.id}`} aria-hidden="true" />
                        <span>{a.title}</span>
                      </div>
                      <div className="act-meta">
                        {cat.label}
                        {a.location ? ` · ${a.location}` : ''}
                        {a.booking_ref ? ` · ref ${a.booking_ref}` : ''}
                        {a.lat != null && a.lng != null ? ' · 📍' : ''}
                      </div>
                    </div>
                    {Number(a.cost) > 0 ? (
                      <div className="act-cost mono">{money(a.cost, trip.currency)}</div>
                    ) : null}
                    <div className="act-actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" title="Move to previous day"
                        disabled={i === 0} onClick={() => onMove(a, -1)}>↑</button>
                      <button className="btn ghost sm" title="Move to next day"
                        disabled={i === days.length - 1} onClick={() => onMove(a, 1)}>↓</button>
                    </div>
                  </div>
                );
              })}
            </div>
            <button className="day-add" onClick={() => onAdd(d)}>+ Add to {fmtDay(d)}</button>
          </section>
        );
      })}

      {stray.length ? (
        <section className="day">
          <div className="day-head"><span className="day-date">Outside the trip dates</span></div>
          <div className="acts">
            {stray.map((a) => (
              <div className="act" key={a.id} role="button" tabIndex={0} onClick={() => onEdit(a)}>
                <div className="act-time mono small">{a.day}</div>
                <div className="act-body"><div className="act-title">{a.title}</div>
                  <div className="act-meta">Tap to move it into range</div></div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
