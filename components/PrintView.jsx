'use client';
import { categoryOf, fmtDayLong, fmtRange, fmtTime, money, sortActs } from '@/lib/util';

/**
 * Always mounted, hidden on screen, shown only by the print stylesheet — so
 * "Print" produces the whole trip regardless of which tab is open, and
 * "Save as PDF" gives you a copy that works with no signal.
 */
export default function PrintView({ trip, days, activities, packing, members }) {
  if (!trip) return null;

  const currency = trip.currency || 'SGD';
  const total = activities.reduce((s, a) => s + Number(a.cost || 0), 0);
  const refs = activities.filter((a) => (a.booking_ref || '').trim());

  const byDay = {};
  days.forEach((d) => { byDay[d] = []; });
  activities.forEach((a) => { if (!byDay[a.day]) byDay[a.day] = []; byDay[a.day].push(a); });
  const strays = activities.filter((a) => !days.includes(a.day));

  const packGroups = {};
  packing.forEach((i) => {
    const k = i.category || 'general';
    if (!packGroups[k]) packGroups[k] = [];
    packGroups[k].push(i);
  });

  return (
    <div className="printonly">
      <header className="p-head">
        <h1>{trip.name}</h1>
        <div className="p-sub">
          {trip.destination ? `${trip.destination} · ` : ''}
          {fmtRange(trip.start_date, trip.end_date)}
          {days.length ? ` · ${days.length} day${days.length === 1 ? '' : 's'}` : ''}
          {total > 0 ? ` · ${money(total, currency)} planned` : ''}
          {trip.budget != null ? ` of ${money(trip.budget, currency)}` : ''}
        </div>
        {members && members.length ? (
          <div className="p-sub">
            Travelling: {members.map((m) => m.display_name || m.email || 'Guest').join(', ')}
          </div>
        ) : null}
      </header>

      {days.map((d, i) => {
        const list = (byDay[d] || []).slice().sort(sortActs);
        const dayTotal = list.reduce((s, a) => s + Number(a.cost || 0), 0);
        return (
          <section className="p-day" key={d}>
            <h2>
              Day {i + 1} — {fmtDayLong(d)}
              {dayTotal > 0 ? <span className="p-daytotal">{money(dayTotal, currency)}</span> : null}
            </h2>
            {list.length === 0 ? (
              <p className="p-none">Nothing planned.</p>
            ) : list.map((a) => (
              <div className="p-act" key={a.id}>
                <div className="p-time">
                  {a.start_time ? fmtTime(a.start_time) : '—'}
                  {a.end_time ? ` – ${fmtTime(a.end_time)}` : ''}
                </div>
                <div className="p-detail">
                  <div className="p-title">
                    {a.title}
                    {Number(a.cost) > 0 ? <span className="p-cost">{money(a.cost, currency)}</span> : null}
                  </div>
                  <div className="p-meta">
                    {categoryOf(a.category).label}
                    {a.location ? ` · ${a.location}` : ''}
                    {a.booking_ref ? ` · ref ${a.booking_ref}` : ''}
                  </div>
                  {(a.notes || '').trim() ? <div className="p-notes">{a.notes}</div> : null}
                </div>
              </div>
            ))}
          </section>
        );
      })}

      {strays.length ? (
        <section className="p-day">
          <h2>Outside the trip dates</h2>
          {strays.map((a) => (
            <div className="p-act" key={a.id}>
              <div className="p-time">{a.day}</div>
              <div className="p-detail"><div className="p-title">{a.title}</div></div>
            </div>
          ))}
        </section>
      ) : null}

      {refs.length ? (
        <section className="p-day">
          <h2>Booking references</h2>
          <table className="p-table">
            <thead><tr><th>Item</th><th>Day</th><th>Reference</th></tr></thead>
            <tbody>
              {refs.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td>{fmtDayLong(a.day)}</td>
                  <td>{a.booking_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {packing.length ? (
        <section className="p-day">
          <h2>Packing list</h2>
          {Object.keys(packGroups).map((g) => (
            <div className="p-packgroup" key={g}>
              <h3>{g}</h3>
              <ul className="p-pack">
                {packGroups[g].map((i) => (
                  <li key={i.id}>
                    <span className="p-box">{i.packed ? '☒' : '☐'}</span>
                    {i.label}{i.qty > 1 ? ` ×${i.qty}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      {(trip.notes || '').trim() ? (
        <section className="p-day">
          <h2>Notes</h2>
          <div className="p-notes-block">{trip.notes}</div>
        </section>
      ) : null}
    </div>
  );
}
