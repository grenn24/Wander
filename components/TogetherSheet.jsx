import { MousePointer2 } from 'lucide-react';

/**
 * The claim beside it — one link, everyone editing the same trip — as a moment
 * rather than a sentence: three people in one day, one of them changing lunch
 * while another has just added a viewpoint. Still on purpose. The hero already
 * has the page's one moving picture, and this only has to show who is here and
 * what just changed.
 *
 * The people are invented, as the trips in the hero are. Each has one colour,
 * used for their face and for the tag that follows what they are touching.
 */
const MEI = 'var(--cat-1)';
const SAM = 'var(--cat-3)';
const ANA = 'var(--cat-2)';

export default function TogetherSheet() {
  return (
    <div className="lp-live" role="img"
      aria-label="Three people planning the same Lisbon day: one is changing lunch while another has just added a viewpoint.">
      <div className="lp-live-head">
        <span className="lp-live-place">Lisbon, May</span>
        <span className="lp-live-now">3 planning now</span>
        <span className="lp-faces">
          <i style={{ '--c': MEI }}>MT</i>
          <i style={{ '--c': SAM }}>SL</i>
          <i style={{ '--c': ANA }}>AC</i>
        </span>
      </div>

      <div className="lp-live-row">
        <span className="lp-live-time">9:30 am</span>
        <span className="lp-live-main">
          <span className="lp-live-name">Pastéis de Belém</span>
          <span className="lp-live-meta">Food and drink, Belém</span>
        </span>
        <span className="lp-live-cost">€6</span>
      </div>

      <div className="lp-live-row lp-live-editing" style={{ '--c': SAM }}>
        <span className="lp-live-time">1:00 pm</span>
        <span className="lp-live-main">
          <span className="lp-live-name">Time Out Market</span>
          <span className="lp-live-meta">Food and drink, Cais do Sodré</span>
        </span>
        <span className="lp-live-cost">€22</span>
        <span className="lp-live-tag"><MousePointer2 size={12} fill="currentColor" strokeWidth={1.5} /> Sam</span>
      </div>

      <div className="lp-live-row lp-live-new" style={{ '--c': MEI }}>
        <span className="lp-live-time">5:00 pm</span>
        <span className="lp-live-main">
          <span className="lp-live-name">Miradouro de Santa Luzia</span>
          <span className="lp-live-meta">Sightseeing, Alfama</span>
        </span>
        <span className="lp-live-cost" />
        <span className="lp-live-tag">Mei added this</span>
      </div>
    </div>
  );
}
