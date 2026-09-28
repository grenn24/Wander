'use client';

import { useCallback, useRef } from 'react';
import { X } from 'lucide-react';
import { useModalChrome } from '@/lib/useModal';
import useSheetDismiss from '@/components/useSheetDismiss';

export default function ConfirmModal({
  title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onClose, leaving = false,
}) {
  const confirm = useCallback(() => onConfirm(), [onConfirm]);
  useModalChrome({ onEscape: onClose, onSubmit: confirm });
  const box = useRef(null);
  // On a phone it is a sheet: pulling it down is the same as saying no.
  const pull = useSheetDismiss({ ref: box, onClose });

  return (
    <div className="backdrop confirm-backdrop" data-state={leaving ? 'exit' : undefined}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={box} {...pull} className="modal confirm-modal" role="alertdialog" aria-modal="true"
        aria-labelledby="confirm-title">
        <div className="modal-head">
          <h3 id="confirm-title">{title}</h3>
          <button className="btn ghost sm icon-btn" type="button"
            onClick={onClose} aria-label="Close"><X size={15} /></button>
        </div>
        <div className="modal-body confirm-copy">{children}</div>
        <div className="modal-foot">
          <button className="btn" type="button" onClick={onClose} autoFocus>{cancelLabel}</button>
          <button className="btn danger-solid" type="button" onClick={confirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
