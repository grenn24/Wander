'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowUp, Shuffle, ImagePlus } from 'lucide-react';
import { shrinkAll, pickImages, MAX_SHOTS } from '@/lib/image';
import ShotStrip from '@/components/ShotStrip';
import { handleMessageEnter } from '@/lib/messageKeyboard';

/*
 * Where the pictures wait between the two pages.
 *
 * The planner lives at its own address so it can be reloaded and linked to,
 * and an address is no place for a photograph. Session storage carries them
 * across the one navigation and is gone when the tab is.
 */
export const SHOT_KEY = 'wander:plan-shots';

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
  const [shots, setShots] = useState([]); // [{ url, name }]
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
  async function take(files) {
    const picked = pickImages(files);
    if (!picked.length) return;
    setShotErr('');
    const room = MAX_SHOTS - shots.length;
    const { ok, failed, over } = await shrinkAll(picked, room);
    if (ok.length) setShots((was) => [...was, ...ok]);
    if (over > 0) {
      setShotErr(`${MAX_SHOTS} pictures is the most I can read at once.`);
    } else if (failed.length) {
      setShotErr(failed[0]);
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
    if (!q && !shots.length) return;
    if (shots.length) {
      try {
        sessionStorage.setItem(SHOT_KEY, JSON.stringify(shots.map((s) => s.url)));
      } catch (err) {
        // Too big for the quota, or storage switched off entirely.
        setShotErr('This browser would not hold the pictures. Try fewer, or describe them.');
        return;
      }
    } else {
      try { sessionStorage.removeItem(SHOT_KEY); } catch (err) { /* nothing to clear */ }
    }
    router.push(`/plan?q=${encodeURIComponent(q)}${shots.length ? '&shots=1' : ''}`);
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
          take(e.dataTransfer && e.dataTransfer.files);
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
          enterKeyHint="enter"
          autoFocus={autoFocus}
          aria-label="Describe the trip you want"
          placeholder={rotate ? '' : 'Where are you going?'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => handleMessageEnter(e, submit)}
          onPaste={(e) => {
            const imgs = pickImages(e.clipboardData && e.clipboardData.files);
            if (imgs.length) { e.preventDefault(); take(e.clipboardData.files); }
          }}
        />
        {rotate && !value ? (
          <span className="planbox-ghost" aria-hidden="true" key={ghost}>
            {SAMPLE_PROMPTS[ghost]}
          </span>
        ) : null}
        <input ref={fileRef} type="file" accept="image/*" multiple hidden
          onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
        <button className="btn ghost planbox-clip" type="button"
          disabled={shots.length >= MAX_SHOTS}
          data-tip={shots.length >= MAX_SHOTS ? `${MAX_SHOTS} is the limit` : 'Add photos'}
          aria-label="Add photos"
          onClick={() => fileRef.current && fileRef.current.click()}>
          <ImagePlus size={17} />
        </button>
        <button className="btn primary planbox-go" type="submit"
          disabled={!value.trim() && !shots.length}
          data-tip="Plan this trip for me"
          aria-label="Plan this trip for me">
          <ArrowUp size={17} />
        </button>
      </form>

      <ShotStrip shots={shots} onRemove={(i) => {
        setShotErr('');
        setShots((was) => was.filter((_, at) => at !== i));
      }} />
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
