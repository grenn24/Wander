'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowUp, Shuffle, ImagePlus, X } from 'lucide-react';
import { shrink, pickImage, BadImage } from '@/lib/image';

/*
 * Where a picture waits between the two pages.
 *
 * The planner lives at its own address so it can be reloaded and linked to,
 * and an address is no place for a photograph. Session storage carries it
 * across the one navigation and is gone when the tab is.
 */
export const SHOT_KEY = 'wander:plan-shot';

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
  const [shot, setShot] = useState(null); // { url, name }
  const [shotErr, setShotErr] = useState('');
  const [over, setOver] = useState(false); // something is being dragged onto us
  const areaRef = useRef(null);
  const fileRef = useRef(null);

  /*
   * A picture is a description too.
   *
   * People photograph the thing they want rather than describing it — a page
   * torn out of a guidebook, a friend's list on a napkin, the front of a
   * restaurant. Taking that as input costs one button and saves them writing
   * out what they are already holding.
   */
  async function take(file) {
    if (!file) return;
    setShotErr('');
    try {
      const url = await shrink(file);
      setShot({ url, name: file.name || 'picture' });
    } catch (e) {
      setShotErr(e instanceof BadImage ? e.message : 'That picture could not be read.');
      setShot(null);
    }
  }

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
    if (!q && !shot) return;
    if (shot) {
      try {
        sessionStorage.setItem(SHOT_KEY, shot.url);
      } catch (err) {
        // A picture too big for the quota, or storage switched off entirely.
        setShotErr('This browser would not hold the picture. Try describing it instead.');
        return;
      }
    } else {
      try { sessionStorage.removeItem(SHOT_KEY); } catch (err) { /* nothing to clear */ }
    }
    router.push(`/plan?q=${encodeURIComponent(q)}${shot ? '&shot=1' : ''}`);
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
      <form
        className={`planbox-field${over ? ' is-over' : ''}`}
        onSubmit={submit}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault(); setOver(false);
          take(pickImage(e.dataTransfer && e.dataTransfer.files));
        }}
      >
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
          onPaste={(e) => {
            const img = pickImage(e.clipboardData && e.clipboardData.files);
            if (img) { e.preventDefault(); take(img); }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
        />
        {rotate && !value ? (
          <span className="planbox-ghost" aria-hidden="true" key={ghost}>
            {SAMPLE_PROMPTS[ghost]}
          </span>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => { take(e.target.files && e.target.files[0]); e.target.value = ''; }} />
        <button className="btn ghost planbox-clip" type="button"
          data-tip="Plan from a picture" aria-label="Attach a picture"
          onClick={() => fileRef.current && fileRef.current.click()}>
          <ImagePlus size={17} />
        </button>
        <button className="btn primary planbox-go" type="submit"
          disabled={!value.trim() && !shot}
          data-tip="Plan this trip"
          aria-label="Plan this trip">
          <ArrowUp size={17} />
        </button>
      </form>

      {shot ? (
        <div className="planshot">
          <img src={shot.url} alt="" />
          <span className="planshot-name">{shot.name}</span>
          <button className="planshot-x" type="button" data-tip="Remove"
            aria-label="Remove the picture" onClick={() => setShot(null)}>
            <X size={13} />
          </button>
        </div>
      ) : null}
      {shotErr ? <p className="planshot-err">{shotErr}</p> : null}

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
