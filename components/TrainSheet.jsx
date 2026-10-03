'use client';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import TrainPanel from '@/components/TrainPanel';
import s from './TrainSheet.module.css';

/**
 * The train options for a hop, over the page rather than in a panel: what
 * the itinerary opens from a train chip, where there is no side panel to
 * take over. A sheet from the right on a wide screen, from the bottom on a
 * phone; Escape or the backdrop closes it.
 */
export default function TrainSheet({ onClose, ...options }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal((
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={options.title || 'Train options'}
        onClick={(e) => e.stopPropagation()}>
        <button type="button" className={`btn ghost sm icon-btn ${s.close}`} aria-label="Close"
          data-tip="Close  Esc" onClick={onClose}>
          <X size={16} />
        </button>
        <TrainPanel {...options} />
      </div>
    </div>
  ), document.body);
}
