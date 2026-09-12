'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Plus, Sparkles, Loader2 } from 'lucide-react';
import Select from '@/components/Select';
import TravelArt from '@/components/TravelArt';
import { cap } from '@/lib/util';

const GROUPS = ['general', 'clothes', 'tech', 'documents', 'toiletries', 'meds'];

export default function Packing({
  items, onAdd, onUpdate, onDelete, trip, days, activities, onAddMany,
  focusAdd, onFocused,
}) {
  const addRef = useRef(null);

  // Arrived here to add something, so the cursor is already in the box.
  useEffect(() => {
    if (!focusAdd || !addRef.current) return;
    addRef.current.focus();
    addRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    if (onFocused) onFocused();
  }, [focusAdd, onFocused]);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState('');
  /*
   * What the trip cannot say for itself.
   *
   * Dates and stops give the weather and the length; they do not say you are
   * travelling hand luggage only, that you feel the cold, or that the baby is
   * coming. Optional, and empty is the ordinary case — the button works the
   * same whether or not anyone types here.
   */
  const [note, setNote] = useState('');

  async function generate() {
    setAiBusy(true); setAiErr('');
    try {
      const res = await fetch('/api/packing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destination: (trip && (trip.destination || trip.name)) || '',
          dates: trip ? `${trip.start_date} to ${trip.end_date}` : '',
          days: days ? days.length : 1,
          existing: items.map((i) => i.label),
          themes: (activities || []).map((a) => a.title).slice(0, 30),
          note: note.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) { setAiErr(body.error || 'Could not build a list.'); return; }
      setNote('');
      const fresh = (body.items || []).filter(
        (i) => !items.some((e) => e.label.toLowerCase() === i.label.toLowerCase()),
      );
      if (!fresh.length) { setAiErr('Nothing new to add — your list already covers it.'); return; }
      await onAddMany(fresh);
    } catch (e) {
      setAiErr('Something went wrong. Please try again later.');
    } finally {
      setAiBusy(false);
    }
  }

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
      <div className="page-head spread">
        <div>
          <h2>Packing list</h2>
          <div className="small muted">{packed} of {items.length} packed</div>
        </div>
      </div>

      {onAddMany ? (
        <form className="pack-ask" onSubmit={(e) => { e.preventDefault(); generate(); }}>
          <input
            className="input" value={note} disabled={aiBusy}
            aria-label="Anything the list should account for"
            placeholder={items.length
              ? 'More of something? Colder nights, a hike, formal dinner…'
              : 'Anything special? Hand luggage only, hiking, travelling with a baby…'}
            onChange={(e) => setNote(e.target.value)}
          />
          <button className="btn sm" type="submit" disabled={aiBusy}
            data-tip={note.trim() ? 'Build with this in mind' : 'Build from the trip'}>
            {aiBusy ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {items.length ? ' Suggest more' : ' Build the list'}
          </button>
        </form>
      ) : null}
      {aiErr ? <div className="err" style={{ marginTop: -8, marginBottom: 12 }}>{aiErr}</div> : null}

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
            <input id="pl" ref={addRef} className="input" value={label} placeholder="Passport"
              onChange={(e) => setLabel(e.target.value)} />
          </div>
          <div style={{ flex: '1 1 120px' }}>
            <label className="label" htmlFor="pc">Group</label>
            <Select
              id="pc" label="Group"
              value={category}
              onChange={setCategory}
              options={GROUPS.map((g) => ({ value: g, label: cap(g) }))}
            />
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
        <div className="empty">
          <TravelArt kind="packing" />
          <p className="empty-title">Nothing on the list yet</p>
          <p className="small muted" style={{ margin: 0 }}>
            Add items above, or have one built from where you are going and how long for.
          </p>
        </div>
      ) : (
        Object.keys(grouped).map((g) => (
          <section key={g} style={{ marginBottom: 16 }}>
            <h3 className="pack-group">{cap(g)}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {grouped[g].map((i) => (
                <div className={`pack-item${i.packed ? ' done' : ''}`} key={i.id}>
                  <input type="checkbox" checked={!!i.packed} aria-label={`Packed: ${i.label}`}
                    onChange={(e) => onUpdate(i.id, { packed: e.target.checked })} />
                  <span className="pack-label">{i.label}</span>
                  {i.qty > 1 ? <span className="tag mono">×{i.qty}</span> : null}
                  <button className="btn ghost sm icon-btn"
                    data-tip="Remove" aria-label={`Remove ${i.label}`}
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
