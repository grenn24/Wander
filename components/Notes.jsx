'use client';
import { useEffect, useRef, useState } from 'react';
import { fmtDay } from '@/lib/util';
import { createNotesSync } from '@/lib/notesSync';

export default function Notes({ trip, activities, onSave }) {
  const [{ text, status, incoming }, setState] = useState({ text: trip.notes || '', status: '', incoming: null });
  const sync = useRef(null);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;
  const tripId = trip.id;

  useEffect(() => {
    setState({ text: trip.notes || '', status: '', incoming: null });
    const editor = createNotesSync(trip.notes || '', { save: (value) => saveRef.current(value), publish: setState });
    sync.current = editor;
    return () => editor.dispose();
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    sync.current?.receive(trip.notes || '');
  }, [tripId, trip.notes]);

  const refs = activities.filter((a) => (a.booking_ref || '').trim());

  return (
    <div>
      <div className="page-head spread">
        <div>
          <h2>Notes</h2>
          <div className="small muted">Shared with everyone on this trip</div>
        </div>
        <div className="chiprow"><span className="small dim" role="status">{status}</span>
          {status === 'Could not save' && <button className="btn sm" onClick={() => sync.current?.retry()}>Retry</button>}
        </div>
      </div>

      {incoming !== null ? (
        <div className="card notice" style={{ marginBottom: 12 }}>
          <div className="spread">
            <span className="small">Someone else edited these notes while you were typing.</span>
            <div className="chiprow">
              <button className="btn sm" onClick={() => sync.current?.useTheirs()}>Use theirs</button>
              <button className="btn sm" onClick={() => sync.current?.keepMine()}>Keep mine</button>
            </div>
          </div>
        </div>
      ) : null}

      <textarea className="textarea" style={{ minHeight: 220 }} value={text}
        placeholder="Visa notes, transit passes, restaurant shortlist, who is paying for what…"
        aria-label="Trip notes" onChange={(e) => sync.current?.change(e.target.value)} />

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

    </div>
  );
}
