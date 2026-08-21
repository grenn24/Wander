'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, Trash2, LogOut } from 'lucide-react';
import { colorFor, initials } from '@/lib/util';

export default function People({
  members, online, user, isOwner, displayName, onRename,
  shareUrl, onRemove, onDeleteTrip, onLeaveTrip,
}) {
  const [name, setName] = useState(displayName || '');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const onlineIds = online.map((o) => o.id);

  useEffect(() => { setName(displayName || ''); }, [displayName]);

  function submitName(e) {
    e.preventDefault();
    onRename(name);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      const el = document.getElementById('shareurl');
      if (el) { el.select(); }
    }
  }

  return (
    <div>
      <div className="page-head">
        <h2>People</h2>
        <div className="small muted">Anyone with the link edits this trip live — no account needed</div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <label className="label" htmlFor="shareurl">Share link</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="shareurl" className="input mono small" readOnly value={shareUrl}
            onFocus={(e) => e.target.select()} />
          <button className="btn primary" type="button" onClick={copy}>
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          Send this to anyone. Opening it drops them into this trip as an editor. Treat it like a
          password — anyone holding it can edit the trip.
        </p>
      </div>

      <form className="card" style={{ marginBottom: 16 }} onSubmit={submitName}>
        <label className="label" htmlFor="dn">Your display name</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input id="dn" className="input" value={name} maxLength={40}
            placeholder="Guest 1234" onChange={(e) => setName(e.target.value)} />
          <button className="btn">{saved ? 'Saved' : 'Save'}</button>
        </div>
        <p className="tiny dim" style={{ marginBottom: 0 }}>
          This is what everyone else sees next to your edits.
        </p>
      </form>

      <h3 style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '.04em',
        color: 'var(--text-3)', marginBottom: 8 }}>On this trip</h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {members.map((m) => {
          const label = m.display_name || m.email || 'Guest';
          const isMe = !!(user && m.user_id === user.id);
          return (
            <div className="person" key={m.user_id}>
              <span className="avatar" style={{ background: colorFor(label), marginLeft: 0 }}>
                {initials(label)}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {label}{isMe ? ' (you)' : ''}
                </div>
                <div className="tiny dim">
                  {m.role}{onlineIds.includes(m.user_id) ? ' · online now' : ''}
                </div>
              </div>
              {onlineIds.includes(m.user_id) ? <span className="pulse" title="Online now" /> : null}
              {isOwner && !isMe ? (
                <button className="btn ghost sm" onClick={() => onRemove(m.user_id)}>Remove</button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Keep your access</h3>
        <p className="small muted" style={{ margin: 0 }}>
          You are signed in as a guest on this browser. Clearing site data, or switching to another
          device or browser, starts a fresh guest — so keep the share link if you want to get back in.
        </p>
      </div>

      <div className="card">
        <h3 style={{ fontSize: 15, marginBottom: 6 }}>Danger zone</h3>
        {isOwner ? (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              Deleting the trip removes its activities, packing list and members for everyone.
            </p>
            {confirmDelete ? (
              <div className="chiprow">
                <button className="btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
                <button className="btn danger-solid" onClick={onDeleteTrip}>Yes, delete this trip</button>
              </div>
            ) : (
              <button className="btn danger" onClick={() => setConfirmDelete(true)}><Trash2 size={15} /> Delete trip</button>
            )}
          </>
        ) : (
          <>
            <p className="small muted" style={{ marginTop: 0 }}>
              Leaving hides this trip from you. Others keep it, and the share link still works.
            </p>
            <button className="btn danger" onClick={onLeaveTrip}><LogOut size={15} /> Leave trip</button>
          </>
        )}
      </div>
    </div>
  );
}
