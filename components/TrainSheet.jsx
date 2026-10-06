'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import TrainPanel from '@/components/TrainPanel';
import useSheetDrag from '@/components/useSheetDrag';
import s from './TrainSheet.module.css';

/*
 * On a phone the sheet opens partway up, and its grip pulls it to the top of
 * the screen for a long list, or down off the bottom to close it.
 */
const SIZES = ['gone', 'some', 'all'];

/**
 * The train options for a hop, over the page rather than in a panel: what
 * the itinerary opens from a train chip, where there is no side panel to
 * take over. A sheet from the right on a wide screen, from the bottom on a
 * phone; Escape or the backdrop closes it.
 */
export default function TrainSheet({ onClose, ...options }) {
  const ref = useRef(null);
  const [size, setSize] = useState('some');
  const drag = useSheetDrag({
    ref,
    sizes: SIZES,
    size,
    onSize: (name) => (name === 'gone' ? onClose() : setSize(name)),
  });
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return createPortal((
    <div className={s.backdrop} onClick={onClose}>
      <div ref={ref} className={s.sheet} data-size={size} role="dialog" aria-modal="true"
        aria-label={options.title || 'Train options'} onClick={(e) => e.stopPropagation()}>
        <button type="button" className={s.grip} {...drag.handlers}
          aria-label={size === 'all' ? 'Make the sheet shorter' : 'Make the sheet taller'}
          onClick={() => { if (!drag.dragged()) setSize((v) => (v === 'all' ? 'some' : 'all')); }}>
          <span className={s.bar} aria-hidden="true" />
        </button>
        <button type="button" className={`btn ghost sm icon-btn ${s.close}`} aria-label="Close"
          data-tip="Close  Esc" onClick={onClose}>
          <X size={16} />
        </button>
        <div className={s.body}>
          <TrainPanel {...options} />
        </div>
      </div>
    </div>
  ), document.body);
}
