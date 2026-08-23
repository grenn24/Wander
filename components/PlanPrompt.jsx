'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowUp, Shuffle } from 'lucide-react';

// Short on purpose: they are a nudge, not an example of how much to write.
export const SAMPLE_PROMPTS = [
  'Five days in Tokyo, food first',
  'A week in Portugal, slow mornings',
  'Seoul with a six-year-old',
  'Vietnam by train, ten days',
  'Kyoto in blossom season',
  'Iceland ring road, two weeks',
  'Singapore on a budget',
  'Rome and Florence, galleries',
];

/**
 * The natural-language entry point. It only collects the query — the work
 * happens on /plan, which owns the guest session and can write to the database.
 */
export default function PlanPrompt({ autoFocus = false, compact = false, rotate = false }) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [shown, setShown] = useState(() => SAMPLE_PROMPTS.slice(0, 3));
  const [ghost, setGhost] = useState(0);
  const areaRef = useRef(null);

  /*
   * One line to begin with, and as many as it takes after that.
   *
   * It used to open two rows tall for a box that almost always holds one line,
   * which left the send button sitting an inch below the text it belonged to —
   * the button bottom-aligns so it stays in the corner as the field grows, and
   * with nothing to grow into there was nothing under it but empty glass. A
   * field that starts at its content's height has no gap to misalign across.
   */
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const cap = parseFloat(getComputedStyle(el).maxHeight) || Infinity;
    const want = el.scrollHeight;
    el.style.overflowY = want > cap ? 'auto' : 'hidden';
    el.style.height = `${Math.min(want, cap)}px`;
  }, [value]);

  /*
   * On the landing page the empty box suggests trips instead of asking a
   * question. A real placeholder cannot animate, so the rotating line is a
   * layer above the field and the textarea keeps its aria-label as the name.
   * Under reduced motion it simply stops on the first one.
   */
  useEffect(() => {
    if (!rotate) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const t = setInterval(() => setGhost((i) => (i + 1) % SAMPLE_PROMPTS.length), 3400);
    return () => clearInterval(t);
  }, [rotate]);

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
        {/* In the flow rather than pinned to a corner: an icon positioned by
            hand agrees with the text at exactly one font size. */}
        <span className="planbox-spark" aria-hidden="true"><Sparkles size={17} /></span>
        <textarea
          ref={areaRef}
          className="planbox-input"
          value={value}
          rows={1}
          autoFocus={autoFocus}
          aria-label="Describe the trip you want"
          placeholder={rotate ? '' : 'Where are you going?'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        {rotate && !value ? (
          <span className="planbox-ghost" aria-hidden="true" key={ghost}>
            {SAMPLE_PROMPTS[ghost]}
          </span>
        ) : null}
        <button className="btn primary planbox-go" type="submit" disabled={!value.trim()}
          data-tip="Plan this trip"
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
          data-tip="Other examples"
          aria-label="Show different examples">
          <Shuffle size={13} />
        </button>
      </div>
    </div>
  );
}
