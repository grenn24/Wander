'use client';
import { useMemo, useState } from 'react';
import { X, Plus } from 'lucide-react';

const GROUPS = ['general', 'clothes', 'tech', 'documents', 'toiletries', 'meds'];

export default function Packing({ items, onAdd, onUpdate, onDelete }) {
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('general');
  const [qty, setQty] = useState(1);

  const packed = items.filter((i) => i.packed).length;
  const pct = items.length ? Math.round((packed / items.length) * 100) : 0;

  const grouped = useMemo(() => {
    const map = {};
    items.forEach((i) => {
      const k = i.category || 'general';
      if (!map[k]) map[k] = [];
      map[k].push(i);
    });
    return map;
  }, [items]);

  function submit(e) {
    e.preventDefault();
    const t = label.trim();
    if (!t) return;
    onAdd({ label: t, category, qty: Number(qty) || 1 });
    setLabel(''); setQty(1);
  }

  return (
    <div>
      <div className="page-head">
        <h2>Packing list</h2>
        <div className="small muted">{packed} of {items.length} packed</div>
      </div>

      {items.length ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread" style={{ marginBottom: 8 }}>
            <span className="small muted">Progress</span><span className="small mono">{pct}%</span>
          </div>
          <div className="meter"><div style={{ width: `${pct}%` }} /></div>
        </div>
      ) : null}

      <form className="card" style={{ marginBottom: 14 }} onSubmit={submit}>
        <div className="row">
          <div style={{ flex: '3 1 200px' }}>
            <label className="label" htmlFor="pl">Item</label>
            <input id="pl" className="input" value={label} placeholder="Passport"
              onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label className="label" htmlFor="pc">Group</label>
            <select id="pc" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
              {GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
          <div style={{ flex: '0 1 90px' }}>
            <label className="label" htmlFor="pq">Qty</label>
            <input id="pq" className="input mono" inputMode="numeric" value={qty}
              onChange={(e) => setQty(e.target.value)} />
          </div>
          <div style={{ flex: '0 1 100px', display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn primary" style={{ width: '100%' }}><Plus size={16} /> Add</button>
          </div>
        </div>
      </form>

      {items.length === 0 ? (
        <div className="empty">Nothing on the list yet.</div>
      ) : (
        Object.keys(grouped).map((g) => (
          <section key={g} style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em',
              color: 'var(--text-3)', marginBottom: 8 }}>{g}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {grouped[g].map((i) => (
                <div className={`pack-item${i.packed ? ' done' : ''}`} key={i.id}>
                  <input type="checkbox" checked={!!i.packed} aria-label={`Packed: ${i.label}`}
                    onChange={(e) => onUpdate(i.id, { packed: e.target.checked })} />
                  <span className="pack-label">{i.label}</span>
                  {i.qty > 1 ? <span className="tag mono">×{i.qty}</span> : null}
                  <button className="btn ghost sm icon-btn" aria-label={`Remove ${i.label}`}
                    onClick={() => onDelete(i.id)}><X size={15} /></button>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
