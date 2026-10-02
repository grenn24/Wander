'use client';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check, ImageOff, ImageUp, Sparkles, Trash2, Image as ImageIcon, LoaderCircle } from 'lucide-react';
import { useApp } from '@/components/AppProvider';
import ConfirmModal from '@/components/ConfirmModal';
import TripCoverViewer from '@/components/TripCoverViewer';
import useKept from '@/components/useKept';
import {
  COVER_BUCKET, COVER_LIBRARY_FULL, COVER_LIBRARY_MAX, coverEntries, coverPathFor, coversFrom, coverURL,
} from '@/lib/tripCover';
import { coverProblem, prepareCover } from '@/lib/coverImage';
import CoverStyle from '@/components/CoverStyle';
import s from './TripCover.module.css';

/*
 * The picture at the head of a trip, and every picture it has had, changed from
 * the trip's own settings.
 *
 * Unlike the fields around it this saves as you go: an upload is already in
 * the bucket and a drawn cover was drawn on the server, so there is nothing
 * sensible for Cancel to undo. The dialog is told about the change anyway, so
 * the trip it holds and the one in the database stay the same trip.
 *
 * A cover that is replaced is not thrown away. Every upload and every drawing
 * stays in the trip's folder and is listed under the picture, to be chosen again
 * or deleted for good — that is the only thing that deletes one. The trip holds
 * just which is showing.
 *
 * The style typed for a drawn cover belongs to drawing alone and is not saved
 * with the trip. It stays in the field between draws, so another try can be
 * another take on the same look.
 */
const KIND = { drawn: 'drawn', upload: 'uploaded' };
const when = (at) => (at ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '');
/** "drawn 30 Sep": how it came to be and when, for a tooltip and for a screen reader. */
const how = (cover) => [KIND[cover.kind] || 'added', when(cover.at)].filter(Boolean).join(' ');
const sentence = (text) => text.charAt(0).toUpperCase() + text.slice(1);

export default function TripCover({ trip, onChange, bare = false }) {
  const { supabase, pushToast, fail } = useApp();
  const uid = useId();
  const labelId = `${uid}-label`;
  const titleId = `${uid}-covers`;
  const styleId = `${uid}-style`;
  const [entries, setEntries] = useState(null); // what the folder held when last asked; null until then
  const [listFailed, setListFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [style, setStyle] = useState('');
  const [asking, setAsking] = useState(null); // the cover being asked about deleting
  const [viewing, setViewing] = useState(false); // the cover showing, full size
  const askShown = useKept(asking); // on screen while it plays its way out
  const file = useRef(null);
  /*
   * A drawing takes half a minute, in which time the dialog's other fields may
   * have been typed into. Reporting the change through the handler from the
   * moment the button was pressed would hand back the dialog as it was then.
   */
  const latest = useRef({ trip, onChange });
  latest.current = { trip, onChange };
  // A drawing outlives the dialog it was asked for in, and a reason it failed
  // has nowhere to be written once that is closed.
  const here = useRef(true);
  useEffect(() => { here.current = true; return () => { here.current = false; }; }, []);

  const url = coverURL(trip, 720);
  const covers = coversFrom(trip.id, entries || [], trip.cover_path);
  const full = entries !== null && covers.length >= COVER_LIBRARY_MAX;
  const working = !!busy;

  const load = useCallback(async () => {
    if (!supabase) return;
    try { setEntries(await coverEntries(supabase, trip.id)); setListFailed(false); }
    catch { setListFailed(true); }
  }, [supabase, trip.id]);
  useEffect(() => { load(); }, [load]);

  function trouble(error) {
    if (error && error.gentle) {
      if (here.current) setProblem(error.message); else pushToast(error.message);
      return;
    }
    setProblem('That cover could not be saved.');
    fail(error);
  }

  /** Point the trip at a cover (or at none), and tell the dialog. */
  async function keep(patch) {
    const { error } = await supabase.from('trips')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', trip.id);
    if (error) throw error;
    latest.current.onChange(patch);
  }

  async function use(path) {
    if (working || (path && path === latest.current.trip.cover_path)) return;
    setProblem(''); setBusy('use');
    try {
      await keep({ cover_path: path, cover_ref: null });
      if (!path) pushToast('Cover taken off.');
    } catch (error) { trouble(error); } finally { setBusy(''); }
  }

  async function chosen(event) {
    const picked = event.target.files && event.target.files[0];
    // Let go of the file input so choosing the same picture again still counts.
    event.target.value = '';
    if (!picked || working) return;
    if (full) { setProblem(COVER_LIBRARY_FULL); return; }
    setProblem(''); setBusy('upload');
    try {
      const { blob, type, extension } = await prepareCover(picked);
      const path = coverPathFor(trip.id, extension, 'upload');
      const { error } = await supabase.storage.from(COVER_BUCKET)
        .upload(path, blob, { contentType: type, upsert: false });
      if (error) throw error;
      // Even if the trip cannot be pointed at it, it is in the list now and can be tried again.
      await keep({ cover_path: path, cover_ref: null });
      pushToast('Cover added.');
    } catch (error) { trouble(error); } finally { setBusy(''); load(); }
  }

  /*
   * Drawn on the server, which holds the key and puts the picture in the
   * bucket itself — so unlike an upload there is nothing to save here
   * afterwards, only the trip in hand to bring up to date.
   */
  async function draw() {
    if (working) return;
    // The style field can start a drawing too (Enter in it); a full library has no room for one.
    if (full) { setProblem(COVER_LIBRARY_FULL); return; }
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
      latest.current.onChange({ cover_path: answer.cover_path, cover_ref: null });
      pushToast('Cover drawn.');
    } catch (error) { trouble(error); } finally { setBusy(''); load(); }
  }

  /*
   * The only thing that deletes a picture. If it is the one showing, the trip
   * stops pointing at it first: a failure between the two then leaves a cover in
   * the list to try again, never a header holding a link to nothing.
   */
  async function drop(cover) {
    if (working) return;
    setAsking(null); setProblem(''); setBusy('delete');
    try {
      if (latest.current.trip.cover_path === cover.path) await keep({ cover_path: null, cover_ref: null });
      const { error } = await supabase.storage.from(COVER_BUCKET).remove([cover.path]);
      if (error) throw error;
      pushToast('Cover deleted.');
    } catch (error) { trouble(error); } finally { setBusy(''); load(); }
  }

  return (
    // Alone in a dialog there is no next field for the usual gap to separate from.
    <div className="field" style={bare ? { marginBottom: 0 } : undefined}>
      <span className={`label${bare ? ` ${s.sronly}` : ''}`} id={labelId}>Cover</span>
      <div className={s.wrap} role="group" aria-labelledby={labelId}>
        <div className={`${s.shot}${url ? '' : ` ${s.empty}`}`}>
          {url ? (
            <button className={s.view} type="button" onClick={() => setViewing(true)}
              data-tip="Full size" aria-label="View the cover full size">
              <img src={url} alt="" />
            </button>
          ) : (
            <span className={s.none}><ImageIcon size={18} aria-hidden="true" />No cover yet</span>
          )}
          {working ? (
            <span className={s.busy}>
              <LoaderCircle size={18} className={s.spin} aria-hidden="true" />
              {{ draw: 'Drawing…', delete: 'Deleting…', upload: 'Saving…', use: 'Changing…' }[busy]}
            </span>
          ) : null}
        </div>
        <div className={s.acts}>
          <button className="btn sm" type="button" disabled={working || full}
            onClick={() => file.current && file.current.click()}>
            <ImageUp size={14} aria-hidden="true" /> Upload
          </button>
          <button className="btn sm" type="button" disabled={working || full} onClick={draw}>
            <Sparkles size={14} aria-hidden="true" /> {covers.length ? 'Draw another' : 'Draw one'}
          </button>
          {url ? (
            <button className="btn ghost sm" type="button" disabled={working} onClick={() => use(null)}>
              <ImageOff size={14} aria-hidden="true" /> No cover
            </button>
          ) : null}
          <input ref={file} type="file" accept="image/jpeg,image/png,image/webp"
            className={s.file} tabIndex={-1} aria-hidden="true" onChange={chosen} />
        </div>
        <div className={s.look}>
          <label className="small muted" htmlFor={styleId}>Style for drawn covers (optional)</label>
          <CoverStyle id={styleId} value={style} onChange={setStyle} onDraw={draw} />
        </div>

        {full ? <p className="tiny dim">{COVER_LIBRARY_FULL}</p> : null}

        {covers.length ? (
          <div className={s.library}>
            <div className={s.head}>
              <span className={s.title} id={titleId}>Your covers</span>
              {entries ? <span className="tiny dim">{covers.length} of {COVER_LIBRARY_MAX}</span> : null}
            </div>
            <ul className={s.grid} aria-labelledby={titleId}>
              {covers.map((cover) => {
                const on = cover.path === trip.cover_path;
                return (
                  <li key={cover.path} className={s.tile}>
                    <button className={s.pick} type="button" aria-pressed={on} disabled={working}
                      title={sentence(how(cover))}
                      aria-label={on ? `Cover ${how(cover)}, showing now` : `Use the cover ${how(cover)}`}
                      onClick={() => use(cover.path)}>
                      <img src={cover.url} alt="" loading="lazy" decoding="async" />
                    </button>
                    {cover.kind === 'drawn' ? (
                      <span className={s.kind} aria-hidden="true"><Sparkles size={11} /></span>
                    ) : null}
                    {on ? <span className={s.tick} aria-hidden="true"><Check size={12} strokeWidth={3} /></span> : null}
                    <button className={s.trash} type="button" disabled={working}
                      aria-label={`Delete the cover ${how(cover)}`}
                      onClick={() => setAsking(cover)}>
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {problem ? <p className={`tiny ${s.problem}`}>{problem}</p> : listFailed ? (
          <p className="tiny dim">
            The covers this trip has had could not be loaded.{' '}
            <button className={s.retry} type="button" onClick={load}>Try again</button>
          </p>
        ) : (
          <p className="tiny dim">
            Your own picture, or one drawn from the trip’s name, where it goes and the style you give it.
            Each is kept here until you delete it. Saved as you go.
          </p>
        )}
      </div>

      {viewing && url ? (
        <TripCoverViewer trip={trip} covers={entries ? covers : null} onClose={() => setViewing(false)} />
      ) : null}

      {askShown.value ? (
        <ConfirmModal title="Delete this cover?" confirmLabel="Delete cover" leaving={askShown.leaving}
          onClose={() => setAsking(null)} onConfirm={() => drop(askShown.value)}>
          <img className={s.confirmShot} src={askShown.value.url} alt="" />
          <p>
            {askShown.value.path === trip.cover_path
              ? 'It is this trip’s cover, so the trip will have none. '
              : ''}
            The picture is deleted for good and cannot be brought back.
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
