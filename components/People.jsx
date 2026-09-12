'use client';
import { useEffect, useState } from 'react';
import { Copy, Check, Trash2, LogOut, Share2, Link2, Users } from 'lucide-react';
import { colorFor, initials } from '@/lib/util';
import ConfirmModal from '@/components/ConfirmModal';

/**
 * Trip settings: who can reach this trip, who is on it, and how to get rid of
 * it. Every block is the same shape — a heading, a line saying what it is for,
 * then the controls — because they used to be a mix of cards and bare headings
 * and read as a pile rather than a page.
 *
 * There is no display-name field any more. Names come from the account, so an
 * editable copy here was a second answer to a question already settled at
 * sign-up, free to disagree with the one on every other screen.
 */

function Section({ title, icon: Icon, hint, children }) {
  return (
    <section className="card tset">
      <h3 className="tset-h">{Icon ? <Icon size={15} aria-hidden="true" /> : null}{title}</h3>
      {hint ? <p className="tset-hint">{hint}</p> : null}
      {children}
    </section>
  );
}

export default function People({
  members, online, user, isOwner, shareUrl, onRemove, onDeleteTrip, onLeaveTrip, compact = false,
}) {
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);
  const [pending, setPending] = useState(null);
  const onlineIds = online.map((o) => o.id);

  // Asked after mount: navigator.share does not exist on the server, and on
  // desktop it usually does not exist at all.
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.share); }, []);

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) {
      // Clipboard access can be refused; selecting the text leaves it one
      // keystroke away rather than failing silently.
      const el = document.getElementById('shareurl');
      if (el) el.select();
    }
  }

  async function share() {
    try {
      await navigator.share({ title: 'Join my trip on Wander', url: shareUrl });
    } catch (e) {
      // Dismissing the sheet throws too, so there is nothing to report here.
    }
  }

  return (
    <div>
      {!compact ? <div className="page-head">
        <h2>Trip settings</h2>
        <div className="small muted">Sharing, who is on the trip, and removing it</div>
      </div> : null}

      <Section
        title="Share this trip"
        icon={Link2}
        hint="Anyone you send this to can open the trip and edit it. They sign in first, so
              you will see who they are."
      >
        <div className="tset-row">
          <input id="shareurl" className="input mono small" readOnly value={shareUrl}
            onFocus={(e) => e.target.select()} />
          {canShare ? (
            <button className="btn primary" type="button" onClick={share}>
              <Share2 size={15} /> Share
            </button>
          ) : null}
          <button className={`btn${canShare ? '' : ' primary'}`} type="button" onClick={copy}>
            {copied ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy</>}
          </button>
        </div>
        <p className="tiny dim tset-foot">
          Treat it like a password: holding the link is what grants access, so anyone it is
          forwarded to can edit the trip as well.
        </p>
      </Section>

      <Section
        title="On this trip"
        icon={Users}
        hint={`${members.length} ${members.length === 1 ? 'person has' : 'people have'} access.`}
      >
        <div className="tset-people">
          {members.map((m) => {
            const label = m.display_name || m.email || 'Traveller';
            const isMe = !!(user && m.user_id === user.id);
            const here = onlineIds.includes(m.user_id);
            return (
              <div className="person" key={m.user_id}>
                <span className="avatar" style={{ background: colorFor(label), marginLeft: 0 }}>
                  {initials(label)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="person-name">{label}{isMe ? ' (you)' : ''}</div>
                  <div className="tiny dim">
                    {m.role}
                    {m.email && m.email !== label ? ` · ${m.email}` : ''}
                    {here ? ' · online now' : ''}
                  </div>
                </div>
                {here ? <span className="pulse" data-tip="Online now" /> : null}
                {isOwner && !isMe ? (
                  <button className="btn ghost sm"
                    onClick={() => setPending({ kind: 'member', uid: m.user_id, label })}>
                    Remove
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </Section>

      {/* Named for what it does rather than how it feels. "Danger zone" tells
          you to be careful without telling you what happens. */}
      {isOwner ? (
        <Section
          title="Delete this trip"
          icon={Trash2}
          hint="Removes the itinerary, packing list and everyone's access. This cannot be undone."
        >
          <button className="btn danger" onClick={() => setPending({ kind: 'trip' })}>
            <Trash2 size={15} /> Delete trip
          </button>
        </Section>
      ) : (
        <Section
          title="Leave this trip"
          icon={LogOut}
          hint="Removes it from your trips. Everyone else keeps it, and the share link still works."
        >
          <button className="btn danger" onClick={() => setPending({ kind: 'leave' })}>
            <LogOut size={15} /> Leave trip
          </button>
        </Section>
      )}

      {pending ? (
        <ConfirmModal
          title={pending.kind === 'trip' ? 'Delete trip?'
            : pending.kind === 'leave' ? 'Leave this trip?' : 'Remove traveller?'}
          confirmLabel={pending.kind === 'trip' ? 'Delete trip'
            : pending.kind === 'leave' ? 'Leave trip' : 'Remove access'}
          onClose={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            setPending(null);
            if (action.kind === 'trip') onDeleteTrip();
            else if (action.kind === 'leave') onLeaveTrip();
            else onRemove(action.uid);
          }}>
          <p>
            {pending.kind === 'trip'
              ? "This removes the itinerary, packing list, conversation history, and everyone's access. It cannot be undone."
              : pending.kind === 'leave'
                ? 'The trip disappears from your account. Everyone else keeps access.'
                : `Remove ${pending.label} from this trip? They can rejoin with the share link.`}
          </p>
        </ConfirmModal>
      ) : null}
    </div>
  );
}
