'use client';
import { useState } from 'react';
import { CATEGORIES, categoryOf, fmtDay, money } from '@/lib/util';

export default function Budget({ trip, days, activities }) {
  const [view, setView] = useState('chart');
  const currency = trip.currency || 'SGD';
  const total = activities.reduce((s, a) => s + Number(a.cost || 0), 0);
  const budget = trip.budget == null ? null : Number(trip.budget);
  const perDay = days.length ? total / days.length : 0;
  const remaining = budget == null ? null : budget - total;

  const byCat = CATEGORIES.map((c) => ({
    id: c.id,
    label: c.label,
    value: activities.filter((a) => a.category === c.id).reduce((s, a) => s + Number(a.cost || 0), 0),
  })).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);

  const byDay = days.map((d, i) => ({
    id: d,
    label: `Day ${i + 1}`,
    sub: fmtDay(d),
    value: activities.filter((a) => a.day === d).reduce((s, a) => s + Number(a.cost || 0), 0),
  }));

  const maxCat = Math.max(1, ...byCat.map((r) => r.value));
  const maxDay = Math.max(1, ...byDay.map((r) => r.value));
  const priced = activities.filter((a) => Number(a.cost || 0) > 0).length;

  return (
    <div>
      <div className="page-head spread">
        <div>
          <h2>Budget</h2>
          <div className="small muted">
            {priced} of {activities.length} activities have a cost
            {budget == null ? ' · no budget set (add one in trip settings)' : ''}
          </div>
        </div>
        <div className="chiprow">
          <button className="btn sm" aria-pressed={view === 'chart'}
            onClick={() => setView('chart')}>Chart</button>
          <button className="btn sm" aria-pressed={view === 'table'}
            onClick={() => setView('table')}>Table</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi">
          <div className="kpi-label">TOTAL PLANNED</div>
          <div className="kpi-value mono">{money(total, currency)}</div>
          <div className="kpi-sub">across {days.length} day{days.length === 1 ? '' : 's'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">PER DAY</div>
          <div className="kpi-value mono">{money(perDay, currency)}</div>
          <div className="kpi-sub">average</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{budget == null ? 'BUDGET' : remaining >= 0 ? 'LEFT TO SPEND' : 'OVER BUDGET'}</div>
          <div className="kpi-value mono"
            style={remaining != null && remaining < 0 ? { color: 'var(--danger)' } : undefined}>
            {budget == null ? '—' : money(Math.abs(remaining), currency)}
          </div>
          <div className="kpi-sub">
            {budget == null ? 'set one in trip settings' : `of ${money(budget, currency)}`}
          </div>
        </div>
      </div>

      {budget != null && budget > 0 ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="small muted">Budget used</span>
            <span className="small mono">{Math.round((total / budget) * 100)}%</span>
          </div>
          <div className="meter">
            <div style={{
              width: `${Math.min(100, (total / budget) * 100)}%`,
              background: total > budget ? 'var(--danger)' : 'var(--good)',
            }} />
          </div>
        </div>
      ) : null}

      {view === 'chart' ? (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Spend by type</h3>
            {byCat.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>No costs entered yet.</p>
            ) : (
              <div className="bars">
                {byCat.map((r) => (
                  <div className="bar-row" key={r.id}>
                    <div className="bar-label">
                      <span className={`dot cat-${r.id}`} aria-hidden="true" />{r.label}
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(r.value / maxCat) * 100}%` }} />
                    </div>
                    <div className="bar-val">{money(r.value, currency)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ fontSize: 15, marginBottom: 12 }}>Spend by day</h3>
            <div className="bars">
              {byDay.map((r) => (
                <div className="bar-row" key={r.id}>
                  <div className="bar-label">{r.label} <span className="dim tiny">{r.sub}</span></div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(r.value / maxDay) * 100}%` }} />
                  </div>
                  <div className="bar-val">{r.value ? money(r.value, currency) : <span className="dim">—</span>}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="card" style={{ marginTop: 14 }}>
          <table className="data">
            <thead>
              <tr><th>Activity</th><th>Day</th><th>Type</th><th className="num">Cost</th></tr>
            </thead>
            <tbody>
              {activities.filter((a) => Number(a.cost || 0) > 0).map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td className="muted">{fmtDay(a.day)}</td>
                  <td className="muted">{categoryOf(a.category).label}</td>
                  <td className="num">{money(a.cost, currency)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} style={{ fontWeight: 600 }}>Total</td>
                <td className="num" style={{ fontWeight: 600 }}>{money(total, currency)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
