'use client';

import { useCallback } from 'react';
import { X } from 'lucide-react';
import { useModalChrome } from '@/lib/useModal';

export default function ConfirmModal({
  title, children, confirmLabel = 'Confirm', cancelLabel = 'Cancel', onConfirm, onClose,
}) {
  const confirm = useCallback(() => onConfirm(), [onConfirm]);
  useModalChrome({ onEscape: onClose, onSubmit: confirm });

  return (
    <div className="backdrop confirm-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal confirm-modal" role="alertdialog" aria-modal="true"
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
