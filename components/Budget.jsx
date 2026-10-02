'use client';
import { useEffect, useState } from 'react';
import { BarChart3, Table2, Settings } from 'lucide-react';
import { CATEGORIES, categoryOf, fmtDay, money } from '@/lib/util';
import { splitBudget } from '@/lib/budgetSplit';
import { categoryIcon } from '@/lib/icons';

export default function Budget({ trip, days, activities, members = [], onSplitChange, onEditTrip }) {
  const [view, setView] = useState('chart');
  const [selected, setSelected] = useState(trip.budget_member_ids ?? null);
  const [saving, setSaving] = useState(false);
  const [splitMessage, setSplitMessage] = useState('');
  useEffect(() => { setSelected(trip.budget_member_ids ?? null); }, [trip.id, trip.budget_member_ids]);
  const memberIds = members.map((m) => m.user_id);
  const included = selected == null ? memberIds : selected.filter((id) => memberIds.includes(id));
  async function saveSplit() {
    setSaving(true); setSplitMessage('');
    try { const ok = await onSplitChange(selected); setSplitMessage(ok ? 'Split saved for everyone on this trip.' : 'Could not save the split. Try again.'); }
    catch { setSplitMessage('Could not save the split. Try again.'); }
    finally { setSaving(false); }
  }
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
            {budget == null ? ' · no budget set' : ''}
          </div>
        </div>
        <div className="chiprow">
          {budget == null && onEditTrip ? (
            <button className="btn sm" onClick={onEditTrip}
              data-tip="In trip settings"><Settings size={15} /> Set a budget</button>
          ) : null}
          <button className="btn sm" aria-pressed={view === 'chart'}
            data-tip="By type and day"
            onClick={() => setView('chart')}><BarChart3 size={15} /> Chart</button>
          <button className="btn sm" aria-pressed={view === 'table'}
            data-tip="Every priced item"
            onClick={() => setView('table')}><Table2 size={15} /> Table</button>
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
            {budget == null ? 'add one in trip settings' : `of ${money(budget, currency)}`}
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

      <section className="card budget-split" aria-labelledby="split-title">
        <h3 id="split-title">Split between travellers</h3>
        <p className="small muted">Divide the planned total equally among selected trip members. This is a planning estimate; payments and balances are not tracked.</p>
        <label className="split-member"><input type="checkbox" checked={selected == null} disabled={saving}
          onChange={(e) => { setSelected(e.target.checked ? null : [...included]); setSplitMessage(''); }} />
          Include everyone, including new members</label>
        <div className="split-members">
          {members.map((m) => <label key={m.user_id} className="split-member">
            <input type="checkbox" checked={included.includes(m.user_id)} disabled={saving}
              onChange={(e) => { setSelected(e.target.checked ? [...included, m.user_id] : included.filter((id) => id !== m.user_id)); setSplitMessage(''); }} />
            {m.display_name || m.email || 'Traveller'}
          </label>)}
        </div>
        {included.length ? <div className="split-shares">
          {splitBudget(total, included, currency).map(({ id, amount }) => <div className="spread" key={id}>
            <span>{members.find((m) => m.user_id === id)?.display_name || members.find((m) => m.user_id === id)?.email || 'Traveller'}</span>
            <strong className="mono">{new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount)}</strong>
          </div>)}
          <p className="tiny dim">{money(total, currency)} across {included.length} {included.length === 1 ? 'person' : 'people'}. Rounding is distributed so shares add up to the total.</p>
        </div> : <p className="small muted">Select at least one traveller to calculate a share.</p>}
        {onSplitChange ? <button className="btn" disabled={saving || !included.length} onClick={saveSplit}>{saving ? 'Saving' : 'Save split'}</button> : null}
        {splitMessage ? <p className="small muted" role="status">{splitMessage}</p> : null}
      </section>

      {view === 'chart' ? (
        <>
          <div className="card" style={{ marginTop: 14 }}>
            <h3 style={{ marginBottom: 12 }}>Spend by type</h3>
            {byCat.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>No costs entered yet.</p>
            ) : (
              <div className="bars">
                {byCat.map((r) => (
                  <div className="bar-row" key={r.id}>
                    <div className="bar-label">
                      <span className={`catico sm cat-${r.id}`} aria-hidden="true">
                        {(() => { const I = categoryIcon(r.id); return <I size={12} />; })()}
                      </span>{r.label}
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
            <h3 style={{ marginBottom: 12 }}>Spend by day</h3>
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
