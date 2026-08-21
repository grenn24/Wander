'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDay } from '@/lib/util';

export default function Notes({ trip, activities, onSave }) {
  const [text, setText] = useState(trip.notes || '');
  const [status, setStatus] = useState('');
  const [incoming, setIncoming] = useState(null); // a remote edit we did not apply
  const timer = useRef(null);
  const base = useRef(trip.notes || ''); // last value we know the server holds
  const tripId = trip.id;

  useEffect(() => {
    base.current = trip.notes || '';
    setText(trip.notes || '');
    setIncoming(null);
    setStatus('');
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime edits from other people used to be invisible until you switched
  // trips. Apply them when the box is untouched; otherwise offer the choice
  // rather than clobbering either side.
  useEffect(() => {
    const remote = trip.notes || '';
    if (remote === base.current) return;
    const localDirty = text !== base.current || timer.current;
    if (localDirty) {
      setIncoming(remote);
    } else {
      base.current = remote;
      setText(remote);
      setIncoming(null);
    }
  }, [trip.notes]); // eslint-disable-line react-hooks/exhaustive-deps

  function change(v) {
    setText(v);
    setStatus('Saving…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await onSave(v);
      base.current = v;
      timer.current = null;
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

      {incoming !== null ? (
        <div className="card notice" style={{ marginBottom: 12 }}>
          <div className="spread">
            <span className="small">Someone else edited these notes while you were typing.</span>
            <div className="chiprow">
              <button className="btn sm" onClick={() => {
                base.current = incoming; setText(incoming); setIncoming(null);
              }}>Use theirs</button>
              <button className="btn sm" onClick={() => {
                base.current = incoming; setIncoming(null);
              }}>Keep mine</button>
            </div>
          </div>
        </div>
      ) : null}

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
