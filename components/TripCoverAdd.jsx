'use client';
import { ImagePlus } from 'lucide-react';
import s from './TripCoverAdd.module.css';

/*
 * What stands in for the hero on a trip with no cover to show: a slim bar asking
 * for one, rather than an empty box the height of a photograph. (With a cover, the
 * pill on the hero opens the same dialog.) `changing` is for a trip that has a
 * cover which would not load: it is not that it has none.
 */
export default function TripCoverAdd({ changing = false, onClick }) {
  return (
    <button type="button" className={s.bar} onClick={onClick}>
      <ImagePlus size={17} aria-hidden="true" /> {changing ? 'Change cover' : 'Add a cover'}
    </button>
  );
}
