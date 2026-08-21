'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowUp, Shuffle } from 'lucide-react';

export const SAMPLE_PROMPTS = [
  'Five days in Tokyo in December, mostly food and small neighbourhoods',
  'A week in Portugal, Lisbon and Porto, slow mornings and a lot of walking',
  'Long weekend in Seoul with a 6-year-old, nothing too far from the hotel',
  'Ten days across Vietnam by train, street food and coffee',
  'Four days in Kyoto in cherry blossom season, temples but avoid the crowds',
  'A fortnight in Iceland in summer, hiking and hot springs, driving the ring road',
  'Three days in Singapore on a budget, hawker centres and free things',
  'A week in Rome and Florence, art galleries booked in advance',
];

/**
 * The natural-language entry point. It only collects the query — the work
 * happens on /plan, which owns the guest session and can write to the database.
 */
export default function PlanPrompt({ autoFocus = false, compact = false }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(() => SAMPLE_PROMPTS.slice(0, 3));
  const areaRef = useRef(null);

  function submit(e) {
    if (e) e.preventDefault();
    const q = value.trim();
    if (!q) return;
    router.push(`/plan?q=${encodeURIComponent(q)}`);
  }

  function useSample(s) {
    setValue(s);
    if (areaRef.current) areaRef.current.focus();
  }

  function shuffle() {
    const pool = SAMPLE_PROMPTS.filter((s) => !shown.includes(s));
    const pick = [];
    const from = pool.length >= 3 ? pool : SAMPLE_PROMPTS;
    while (pick.length < 3 && pick.length < from.length) {
      const s = from[Math.floor(Math.random() * from.length)];
      if (!pick.includes(s)) pick.push(s);
    }
    setShown(pick);
  }

  return (
    <div className={`planbox${compact ? ' compact' : ''}`}>
      <form className="planbox-field" onSubmit={submit}>
        <Sparkles size={17} className="planbox-spark" aria-hidden="true" />
        <textarea
          ref={areaRef}
          className="planbox-input"
          value={value}
          rows={compact ? 1 : 2}
          autoFocus={autoFocus}
          aria-label="Describe the trip you want"
          placeholder="Describe the trip you want — where, how long, what you are into…"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        <button className="btn primary planbox-go" type="submit" disabled={!value.trim()}
          aria-label="Plan this trip">
          <ArrowUp size={17} />
        </button>
      </form>

      <div className="planbox-samples">
        {shown.map((s) => (
          <button key={s} type="button" className="samplechip" onClick={() => useSample(s)}>
            {s}
          </button>
        ))}
        <button type="button" className="samplechip shuffle" onClick={shuffle}
          aria-label="Show different examples">
          <Shuffle size={13} />
        </button>
      </div>
    </div>
  );
}
