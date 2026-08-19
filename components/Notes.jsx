'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDay } from '@/lib/util';

export default function Notes({ trip, activities, onSave }) {
  const [text, setText] = useState(trip.notes || '');
  const [status, setStatus] = useState('');
  const timer = useRef(null);
  const tripId = trip.id;

  useEffect(() => { setText(trip.notes || ''); }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  function change(v) {
    setText(v);
    setStatus('Saving…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave(v);
      setStatus('Saved');
      setTimeout(() => setStatus(''), 1500);
    }, 700);
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const refs = activities.filter((a) => (a.booking_ref || '').trim());
  const withNotes = activities.filter((a) => (a.notes || '').trim());

  return (
    <div>
      <div className="page-head spread">
        <div>
          <h2>Notes</h2>
          <div className="small muted">Shared with everyone on this trip</div>
        </div>
        <span className="small dim">{status}</span>
      </div>

      <textarea className="textarea" style={{ minHeight: 220 }} value={text}
        placeholder="Visa notes, transit passes, restaurant shortlist, who is paying for what…"
        onChange={(e) => change(e.target.value)} />

      {refs.length ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Booking references</h3>
          <table className="data">
            <thead><tr><th>Item</th><th>Day</th><th>Reference</th></tr></thead>
            <tbody>
              {refs.map((a) => (
                <tr key={a.id}>
                  <td>{a.title}</td>
                  <td className="muted">{fmtDay(a.day)}</td>
                  <td className="mono">{a.booking_ref}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {withNotes.length ? (
        <div className="card" style={{ marginTop: 14 }}>
          <h3 style={{ fontSize: 15, marginBottom: 10 }}>Activity notes</h3>
          {withNotes.map((a) => (
            <div key={a.id} style={{ marginBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {a.title} <span className="dim tiny">{fmtDay(a.day)}</span>
              </div>
              <div className="small muted" style={{ whiteSpace: 'pre-wrap' }}>{a.notes}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
