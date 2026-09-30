'use client';
import { useRef, useState } from 'react';
import { ImageUp, Sparkles, Trash2, Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import { COVER_BUCKET, coverPathFor, coverURL } from '@/lib/tripCover';
import { coverProblem, prepareCover } from '@/lib/coverImage';
import CoverStyle from '@/components/CoverStyle';
import s from './TripCover.module.css';

/*
 * The picture at the head of a trip, changed from the trip's own settings.
 *
 * Unlike the fields around it this saves as you go: an upload is already in
 * the bucket and a drawn cover was drawn on the server, so there is nothing
 * sensible for Cancel to undo. The dialog is told about the change anyway, so
 * the trip it holds and the one in the database stay the same trip.
 *
 * Only one picture is the trip's at a time, but a picture it used to have is
 * not thrown away: uploading or drawing another only moves the trip's pointer,
 * so every cover it has had stays in the bucket. Only Remove deletes a file,
 * because that is someone asking for the picture to go.
 *
 * The style typed for a drawn cover belongs to drawing alone and is not saved
 * with the trip. It stays in the field between draws, so another try can be
 * another take on the same look.
 */
export default function TripCover({ trip, onChange }) {
  const { supabase, pushToast, fail } = useApp();
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [style, setStyle] = useState('');
  const file = useRef(null);
  const url = coverURL(trip, 720);
  const working = !!busy;

  function trouble(error) {
    if (error && error.gentle) { setProblem(error.message); return; }
    setProblem('That cover could not be saved.');
    fail(error);
  }

  /** Point the trip at a cover, or at none. A file is removed only if `letGo` names it. */
  async function keep(patch, letGo) {
    const { error } = await supabase.from('trips')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', trip.id);
    if (error) throw error;
    onChange(patch);
    if (letGo && letGo !== patch.cover_path) {
      // Already replaced as far as anyone can see; a file left behind is not
      // worth failing over.
      try { await supabase.storage.from(COVER_BUCKET).remove([letGo]); } catch { /* left behind */ }
    }
  }

  async function chosen(event) {
    const picked = event.target.files && event.target.files[0];
    // Let go of the file input so choosing the same picture again still counts.
    event.target.value = '';
    if (!picked || working) return;
    setProblem(''); setBusy('upload');
    try {
      const { blob, type, extension } = await prepareCover(picked);
      const path = coverPathFor(trip.id, extension);
      const { error } = await supabase.storage.from(COVER_BUCKET)
        .upload(path, blob, { contentType: type, upsert: false });
      if (error) throw error;
      // The cover it had stays in the bucket; the trip just stops pointing at it.
      await keep({ cover_path: path, cover_ref: null });
      pushToast('Cover updated.');
    } catch (error) { trouble(error); } finally { setBusy(''); }
  }

  /*
   * Drawn on the server, which holds the key and puts the picture in the
   * bucket itself — so unlike an upload there is nothing to save here
   * afterwards, only the trip in hand to bring up to date.
   */
  async function draw() {
    if (working) return;
    setProblem(''); setBusy('draw');
    try {
      const { data } = await supabase.auth.getSession();
      const token = data && data.session ? data.session.access_token : '';
      if (!token) throw coverProblem('Sign in again to change this trip.');
      const res = await fetch('/api/trips/cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tripId: trip.id, style }),
      });
      const answer = await res.json().catch(() => null);
      if (!res.ok || !answer || !answer.cover_path) {
        throw coverProblem((answer && answer.error) || 'That cover could not be drawn.');
      }
      onChange({ cover_path: answer.cover_path, cover_ref: null });
      pushToast('Cover drawn.');
    } catch (error) { trouble(error); } finally { setBusy(''); }
  }

  async function clear() {
    if (working) return;
    setProblem(''); setBusy('clear');
    try {
      await keep({ cover_path: null, cover_ref: null }, trip.cover_path);
      pushToast('Cover removed.');
    } catch (error) { trouble(error); } finally { setBusy(''); }
  }

  return (
    <div className="field">
      <span className="label" id="trip-cover-label">Cover</span>
      <div className={s.wrap} role="group" aria-labelledby="trip-cover-label">
        <div className={`${s.shot}${url ? '' : ` ${s.empty}`}`}>
          {url ? <img src={url} alt="" /> : (
            <span className={s.none}><ImageIcon size={18} aria-hidden="true" />No cover yet</span>
          )}
          {working ? (
            <span className={s.busy}>
              <LoaderCircle size={18} className={s.spin} aria-hidden="true" />
              {busy === 'draw' ? 'Drawing…' : busy === 'clear' ? 'Removing…' : 'Saving…'}
            </span>
          ) : null}
        </div>
        <div className={s.acts}>
          <button className="btn sm" type="button" disabled={working}
            onClick={() => file.current && file.current.click()}>
            <ImageUp size={14} aria-hidden="true" /> Upload
          </button>
          <button className="btn sm" type="button" disabled={working} onClick={draw}>
            <Sparkles size={14} aria-hidden="true" /> {url ? 'Redraw' : 'Draw one'}
          </button>
          {url ? (
            <button className="btn ghost sm" type="button" disabled={working} onClick={clear}>
              <Trash2 size={14} aria-hidden="true" /> Remove
            </button>
          ) : null}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp"
            className={s.file} tabIndex={-1} aria-hidden="true" onChange={chosen} />
        </div>
        <div className={s.look}>
          <label className="small muted" htmlFor="trip-cover-style">Style for drawn covers (optional)</label>
          <CoverStyle id="trip-cover-style" value={style} onChange={setStyle} onDraw={draw} />
        </div>
        {problem ? <p className={`tiny ${s.problem}`}>{problem}</p> : (
          <p className="tiny dim">
            Your own picture, or one drawn from the trip’s name, where it goes and the style you give it. Saved as you go.
          </p>
        )}
      </div>
    </div>
  );
}
