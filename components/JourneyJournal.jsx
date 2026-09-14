'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Check, Plus, Minus, Sparkles, Star, X } from 'lucide-react';
import PlacePhoto from '@/components/PlacePhoto';
import DateField from '@/components/DateField';
import GrowArea from '@/components/GrowArea';
import MonthStrip from '@/components/MonthStrip';
import {
  MONTHS, WHO, PACES, monthFit, daysLabel, costLabel, placeLine, momentCount,
  suggestedMonth, composeBrief, briefTitle, clampDays,
} from '@/lib/journeyKit';
import { BRIEF_KEY } from '@/lib/planBrief';
import { addDays, fmtRange, todayISO } from '@/lib/util';
import { useModalChrome } from '@/lib/useModal';
import s from './Journeys.module.css';

const memoryKey = (slug) => `wander:journey:${slug}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/*
 * What someone chose last time they read this journey, if it still makes
 * sense: a start date that has passed is dropped, and a moment that no longer
 * exists cannot stay "left out".
 */
function restore(j, raw, today) {
  if (!raw || typeof raw !== 'object') return {};
  const ids = new Set(j.chapters.flatMap((c) => c.moments.map((m) => m.id)));
  const out = {};
  if (raw.mode === 'month' || raw.mode === 'dates') out.mode = raw.mode;
  if (Number.isInteger(raw.month) && raw.month >= 1 && raw.month <= 12) out.month = raw.month;
  if (typeof raw.start === 'string' && ISO.test(raw.start) && raw.start >= today) out.start = raw.start;
  if (Number.isFinite(raw.days)) out.days = clampDays(j, raw.days);
  if (WHO.some((w) => w.id === raw.who)) out.who = raw.who;
  if (PACES.some((p) => p.id === raw.pace)) out.pace = raw.pace;
  if (Array.isArray(raw.dropped)) out.dropped = raw.dropped.filter((id) => ids.has(id));
  if (typeof raw.extra === 'string') out.extra = raw.extra.slice(0, 600);
  return out;
}

/**
 * A journey, read as a journal, with the choices beside it.
 *
 * The moments are where "make it yours" starts: every one is kept until it is
 * not, right where it is written, so leaving something out happens while
 * reading about it rather than on a form further down. The rest — when, how
 * long, who, how fast — sits beside the journal on a desk, and in a sheet on a
 * phone.
 */
export default function JourneyJournal({ journey: j, photos }) {
  const router = useRouter();
  const total = momentCount(j);
  const [choice, setChoice] = useState(() => ({
    mode: 'month', month: 0, start: '', days: clampDays(j), who: '', pace: 'written', dropped: [], extra: '',
  }));
  const [today, setToday] = useState('');
  const [sheet, setSheet] = useState(false);
  const loaded = useRef(false);

  // Dates and storage are the browser's business; read them after mount so
  // the cached page and the first render agree.
  useEffect(() => {
    const now = todayISO();
    setToday(now);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(memoryKey(j.slug)) || 'null'); } catch (e) { raw = null; }
    setChoice((c) => ({ ...c, month: suggestedMonth(j), ...restore(j, raw, now) }));
    loaded.current = true;
  }, [j]);

  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(memoryKey(j.slug), JSON.stringify(choice)); } catch (e) { /* not remembered */ }
  }, [choice, j.slug]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 961px)');
    const onChange = () => { if (mq.matches) setSheet(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const set = (patch) => setChoice((c) => ({ ...c, ...patch }));
  const kept = total - choice.dropped.length;

  function toggleMoment(id) {
    setChoice((c) => ({
      ...c,
      dropped: c.dropped.includes(id) ? c.dropped.filter((x) => x !== id) : [...c.dropped, id],
    }));
  }

  function plan() {
    if (choice.mode === 'dates' && !choice.start) return;
    try {
      sessionStorage.setItem(BRIEF_KEY, composeBrief(j, choice));
    } catch (e) { /* without storage the title alone still plans something */ }
    setSheet(false);
    router.push(`/plan?q=${encodeURIComponent(briefTitle(j))}&brief=1`);
  }

  const cover = photos && photos.cover;
  const form = (onClose) => (
    <MakeItYours j={j} choice={choice} set={set} today={today} kept={kept} total={total}
      onPlan={plan} onClose={onClose} />
  );

  return (
    <article>
      <Link href="/journeys" className={s.back}>
        <ArrowLeft size={16} aria-hidden="true" /> All journeys
      </Link>

      <header className={s.hero}>
        {cover ? (
          <img className={s.heroImg} alt=""
            src={`/api/places/photo?ref=${encodeURIComponent(cover.ref)}&w=1600`} />
        ) : null}
        <div className={s.heroText}>
          <span className={s.heroKicker}>{placeLine(j)}</span>
          <h1 className={s.heroTitle}>{j.title}</h1>
          <div className={s.heroMeta}>
            <span>{daysLabel(j)}</span>
            <span>{j.pace} pace</span>
            <span>{costLabel(j)}</span>
          </div>
        </div>
        {cover && cover.author ? (
          <span className={s.heroCredit}>
            Photo:{' '}
            {cover.authorUri
              ? <a href={cover.authorUri} target="_blank" rel="noreferrer">{cover.author}</a>
              : cover.author}
          </span>
        ) : null}
      </header>

      <div className={s.layout}>
        <div className={s.read}>
          <p className={s.journalLede}>{j.lede}</p>

          <section className={s.glance} aria-label="At a glance">
            <div className={s.glanceWhen}>
              <span className={s.glanceK}>When to go</span>
              <MonthStrip journey={j} large />
              <div className={s.legend} aria-hidden="true">
                <span><i /> Best</span>
                <span><i className={s.lgGood} /> Good</span>
                {(j.months.avoid || []).length ? <span><i className={s.lgAvoid} /> Avoid</span> : null}
              </div>
              <p className={s.whenNote}>{j.when}</p>
            </div>
            <div><span className={s.glanceK}>Length</span><span className={s.glanceV}>{daysLabel(j)}</span></div>
            <div><span className={s.glanceK}>Pace</span><span className={s.glanceV}>{j.pace}</span></div>
            <div><span className={s.glanceK}>Budget</span><span className={s.glanceV}>{costLabel(j)}</span></div>
          </section>

          {j.chapters.map((c, i) => (
            <section key={c.title} className={s.chapter} aria-labelledby={`chapter-${i + 1}`}>
              <div className={s.chapterHead}>
                <span className={s.chapterNo}>{String(i + 1).padStart(2, '0')}</span>
                <span className={s.chapterSpan}>{c.span} · {c.where}</span>
              </div>
              <h2 id={`chapter-${i + 1}`} className={s.chapterTitle}>{c.title}</h2>
              <p className={s.chapterBody}>{c.body}</p>
              <ul className={s.moments}>
                {c.moments.map((m) => {
                  const off = choice.dropped.includes(m.id);
                  const p = photos && photos.moments ? photos.moments[m.id] : null;
                  return (
                    <li key={m.id} className={s.moment} data-off={off ? '' : undefined}>
                      <span title={p && p.author ? `Photo: ${p.author}` : undefined}>
                        <PlacePhoto photoRef={p ? p.ref : null} category="sightseeing" size={56} rounded={14} />
                      </span>
                      <span className={s.momentText}>
                        <strong>{m.name}</strong>
                        <span>{m.note}</span>
                      </span>
                      <button type="button" className={s.keep} aria-pressed={!off}
                        aria-label={`Keep ${m.name} in my version`} onClick={() => toggleMoment(m.id)}>
                        {off ? <Plus size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />}
                        {off ? 'Add back' : 'Keep'}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <section className={s.know} aria-labelledby="good-to-know">
            <h2 id="good-to-know" className={s.knowTitle}>Good to know</h2>
            <dl className={s.knowList}>
              {j.know.map((k) => (
                <div key={k.label} className={s.knowRow}><dt>{k.label}</dt><dd>{k.text}</dd></div>
              ))}
            </dl>
          </section>
        </div>

        <aside className={s.aside} aria-label="Make it yours">
          <div className={s.panel}>{form(null)}</div>
        </aside>
      </div>

      <div className={s.dock}>
        <span className={s.kept}>Keeping {kept} of {total} moments</span>
        <button type="button" className="btn primary" onClick={() => setSheet(true)}>
          <Sparkles size={16} aria-hidden="true" /> Make it yours
        </button>
      </div>

      {sheet ? <Sheet onClose={() => setSheet(false)}>{form(() => setSheet(false))}</Sheet> : null}
    </article>
  );
}

/*
 * The phone's version of the desk panel. Portalled rather than a native modal
 * dialog: a modal dialog sits in the top layer, above the date picker's own
 * popover, which would open somewhere nobody could reach it.
 */
function Sheet({ onClose, children }) {
  const [host, setHost] = useState(null);
  const panel = useRef(null);
  useModalChrome({ onEscape: onClose });
  useEffect(() => { setHost(document.body); }, []);
  useEffect(() => { if (host && panel.current) panel.current.focus(); }, [host]);
  if (!host) return null;
  return createPortal(
    <div className={s.sheetBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className={s.sheet} role="dialog" aria-modal="true" aria-label="Make it yours" tabIndex={-1}>
        {children}
      </div>
    </div>,
    host,
  );
}

function MakeItYours({ j, choice, set, today, kept, total, onPlan, onClose }) {
  const id = useId();
  const days = clampDays(j, choice.days);
  const end = choice.start ? addDays(choice.start, days - 1) : '';
  const fit = choice.month ? monthFit(j, choice.month) : 'fine';

  return (
    <form className={s.mine} onSubmit={(e) => { e.preventDefault(); onPlan(); }}>
      <div className={s.mineHead}>
        <h2 className={s.mineTitle}>Make it yours</h2>
        {onClose ? (
          <button type="button" className="btn ghost icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} />
          </button>
        ) : null}
      </div>

      <div className={s.field} role="group" aria-labelledby={`${id}-when`}>
        <span id={`${id}-when`} className={s.label}>When</span>
        <div className={s.seg}>
          <button type="button" aria-pressed={choice.mode === 'month'} onClick={() => set({ mode: 'month' })}>
            A month
          </button>
          <button type="button" aria-pressed={choice.mode === 'dates'} onClick={() => set({ mode: 'dates' })}>
            Exact dates
          </button>
        </div>
        {choice.mode === 'month' ? (
          <>
            <div className={s.monthPick}>
              {MONTHS.map((m, i) => {
                const f = monthFit(j, i + 1);
                const said = f === 'best' ? ', best time' : f === 'good' ? ', good time' : f === 'avoid' ? ', a poor time' : '';
                return (
                  <button key={m} type="button" data-fit={f} aria-pressed={choice.month === i + 1}
                    aria-label={`${m}${said}`} onClick={() => set({ month: i + 1 })}>
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {fit === 'avoid' ? <p className={s.hint}>{j.when}</p> : null}
          </>
        ) : (
          <>
            <DateField label="Start date" value={choice.start} min={today || undefined}
              onChange={(v) => set({ start: v })} />
            <p className={s.hint}>{choice.start ? fmtRange(choice.start, end) : 'Pick the day you arrive.'}</p>
          </>
        )}
      </div>

      <div className={s.field} role="group" aria-labelledby={`${id}-long`}>
        <span id={`${id}-long`} className={s.label}>How long</span>
        <div className={s.stepRow}>
          <div className={s.stepper}>
            <button type="button" aria-label="One day fewer" disabled={days <= 1}
              onClick={() => set({ days: days - 1 })}>
              <Minus size={16} />
            </button>
            <output aria-live="polite">{days} {days === 1 ? 'day' : 'days'}</output>
            <button type="button" aria-label="One more day" disabled={days >= 30}
              onClick={() => set({ days: days + 1 })}>
              <Plus size={16} />
            </button>
          </div>
          <span className={s.hint}>Written for {daysLabel(j)}</span>
        </div>
      </div>

      <div className={s.field} role="group" aria-labelledby={`${id}-who`}>
        <span id={`${id}-who`} className={s.label}>Who’s going</span>
        <div className={s.chips}>
          {WHO.map((w) => (
            <button key={w.id} type="button" className={s.chip} aria-pressed={choice.who === w.id}
              onClick={() => set({ who: choice.who === w.id ? '' : w.id })}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.field} role="group" aria-labelledby={`${id}-pace`}>
        <span id={`${id}-pace`} className={s.label}>Pace</span>
        <div className={s.chips}>
          {PACES.map((p) => (
            <button key={p.id} type="button" className={s.chip} aria-pressed={choice.pace === p.id}
              onClick={() => set({ pace: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.field}>
        <label htmlFor={`${id}-extra`} className={s.label}>Anything to change?</label>
        <GrowArea id={`${id}-extra`} value={choice.extra} maxLength={600}
          placeholder="Vegetarian, an extra free day, no early starts"
          onChange={(e) => set({ extra: e.target.value })} />
      </div>

      <div className={s.actions}>
        <p className={s.kept}>Keeping {kept} of {total} moments</p>
        <button type="submit" className={`btn primary lg ${s.wide}`}
          disabled={choice.mode === 'dates' && !choice.start}>
          <Sparkles size={17} aria-hidden="true" /> Plan my version
        </button>
        <Link href={`/globe?want=${j.slug}`} className={`btn ghost ${s.wide}`}>
          <Star size={16} aria-hidden="true" /> Save to my globe
        </Link>
      </div>
    </form>
  );
}
