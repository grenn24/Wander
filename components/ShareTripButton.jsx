'use client';

import { useEffect, useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { useApp } from '@/components/AppProvider';

/*
 * Sharing a trip, one tap from the trip itself.
 *
 * The link used to live three levels down (Edit trip → Travellers), which is
 * nowhere anyone looks for it. On a phone this opens the system share sheet;
 * elsewhere it copies the link. If neither is possible, it opens the
 * Travellers panel where the link can be selected by hand.
 */
export default function ShareTripButton({ trip, onFallback }) {
  const { pushToast } = useApp();
  const [canShare, setCanShare] = useState(false);
  const [copied, setCopied] = useState(false);

  // navigator.share does not exist on the server, and rarely on desktop.
  useEffect(() => { setCanShare(typeof navigator !== 'undefined' && !!navigator.share); }, []);

  const url = trip?.share_code && typeof window !== 'undefined'
    ? `${window.location.origin}/join/${trip.share_code}`
    : '';

  async function onClick() {
    if (!url) { onFallback?.(); return; }
    if (canShare) {
      try {
        await navigator.share({ title: trip.name ? `Join ${trip.name} on Wander` : 'Join my trip on Wander', url });
        return;
      } catch (e) {
        // Dismissing the sheet throws as well; that is not a failure to report.
        if (e && e.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      pushToast?.('Share link copied. Anyone with it can join and edit this trip.');
    } catch (e) {
      onFallback?.();
    }
  }

  return (
    <button type="button" className="btn sm" onClick={onClick}
      data-tip="Invite people to this trip" aria-label="Share trip">
      {copied ? <><Check size={15} /> Copied</> : <><Share2 size={15} /> Share</>}
    </button>
  );
}
