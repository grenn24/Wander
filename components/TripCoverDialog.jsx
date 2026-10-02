'use client';
import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import TripCover from '@/components/TripCover';
import { useModalChrome } from '@/lib/useModal';
import useSheetDismiss from '@/components/useSheetDismiss';

/*
 * A trip's cover and the ones it has had, on their own.
 *
 * The same field the trip's settings hold, opened directly from the trip's
 * pages so changing a picture is not a trip through a form of dates and
 * currencies. Nothing here waits for a Save — the cover saves as you go — so
 * the only button is the one that puts the dialog away.
 */
export default function TripCoverDialog({ trip, onChange, onClose, leaving = false }) {
  const dialog = useRef(null);
  // Deleting a picture asks first, and that question owns Escape and ⌘↵ until it is answered.
  const asking = () => !!(dialog.current && dialog.current.querySelector('[role="alertdialog"]'));
  useModalChrome({
    onEscape: () => { if (!asking()) onClose(); },
    onSubmit: () => { if (!asking()) onClose(); },
  });
  // On a phone this is a sheet, and a sheet can be pushed away.
  const pull = useSheetDismiss({ ref: dialog, onClose });
  // Hand focus to the dialog so a screen reader starts at its title, not behind it.
  useEffect(() => { if (dialog.current) dialog.current.focus({ preventScroll: true }); }, []);

  return (
    <div className="backdrop" data-state={leaving ? 'exit' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} {...pull} className="modal" role="dialog" aria-modal="true"
        aria-label="Trip cover" tabIndex={-1} style={{ outline: 'none' }}>
        <div className="modal-head">
          <h3>Trip cover</h3>
          <button className="btn ghost sm" type="button" onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div className="modal-body">
          <TripCover trip={trip} onChange={onChange} bare />
        </div>
        <div className="modal-foot">
          <button className="btn primary" type="button" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
