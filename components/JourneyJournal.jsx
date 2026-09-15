'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, Check, Plus, Minus, Sparkles, Star, X, Camera, Info, Route, EyeOff, MapPin, Play,
} from 'lucide-react';
import DateField from '@/components/DateField';
import GrowArea from '@/components/GrowArea';
import MonthStrip from '@/components/MonthStrip';
import Popover from '@/components/Popover';
import Lightbox from '@/components/Lightbox';
import {
  MONTHS, WHO, PACES, monthFit, daysLabel, costLabel, placeLine,
  suggestedMonth, composeBrief, briefTitle, clampDays,
} from '@/lib/journeyKit';
import { tokenize, paragraphs, imageURL, srcSet } from '@/lib/journeyFormat';
import { BRIEF_KEY } from '@/lib/planBrief';
import { placeDetails, searchPlaces } from '@/lib/geo';
import { addDays, fmtRange, todayISO, shortPlace } from '@/lib/util';
import { useModalChrome } from '@/lib/useModal';
import s from './Journeys.module.css';

const memoryKey = (slug) => `wander:journey:${slug}`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/*
 * What someone chose last time they read this journey, if it still makes
 * sense: a start date that has passed is dropped, and a place that is no
 * longer in the journey cannot stay "left out".
 */
function restore(doc, raw, today) {
  if (!raw || typeof raw !== 'object') return {};
  const ids = new Set((doc.places || []).map((p) => p.id));
  const out = {};
  if (raw.mode === 'month' || raw.mode === 'dates') out.mode = raw.mode;
  if (Number.isInteger(raw.month) && raw.month >= 1 && raw.month <= 12) out.month = raw.month;
  if (typeof raw.start === 'string' && ISO.test(raw.start) && raw.start >= today) out.start = raw.start;
  if (Number.isFinite(raw.days)) out.days = clampDays(doc, raw.days);
  if (WHO.some((w) => w.id === raw.who)) out.who = raw.who;
  if (PACES.some((p) => p.id === raw.pace)) out.pace = raw.pace;
  if (Array.isArray(raw.dropped)) out.dropped = raw.dropped.filter((id) => ids.has(id));
  if (typeof raw.extra === 'string') out.extra = raw.extra.slice(0, 600);
  return out;
}

/** An Unsplash photograph as the photo viewer takes it. */
const forViewer = (m) => ({
  id: m.id, raw: m.raw, width: m.width, provider: 'unsplash',
  author: m.author, authorUri: m.authorUrl, pageUrl: m.pageUrl,
});

function checkedOn(iso) {
  try {
    return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
      day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
    });
  } catch (e) { return iso; }
}

const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; } };

/**
 * A journey, read as a journal, with the choices beside it.
 *
 * The writing decides its own shape — prose, photographs, a quote, an hour by
 * hour day, a detour — and every place in it is a name you can tap: for its
 * photographs, and to keep it or leave it out. The rest of "make it yours"
 * sits beside the journal on a desk, and in a sheet on a phone.
 */
export default function JourneyJournal({ journey: doc, hero = null }) {
  const router = useRouter();
  const places = doc.places || [];
  const total = places.length;
  const [choice, setChoice] = useState(() => ({
    mode: 'month', month: 0, start: '', days: clampDays(doc), who: '', pace: 'written', dropped: [], extra: '',
  }));
  const [today, setToday] = useState('');
  const [sheet, setSheet] = useState(false);
  const [open, setOpen] = useState(null); // { id, anchor }
  const [viewer, setViewer] = useState(null); // { photos, index }
  const loaded = useRef(false);

  // Dates and storage are the browser's business; read them after mount so
  // the cached page and the first render agree.
  useEffect(() => {
    const now = todayISO();
    setToday(now);
    let raw = null;
    try { raw = JSON.parse(localStorage.getItem(memoryKey(doc.slug)) || 'null'); } catch (e) { raw = null; }
    setChoice((c) => ({ ...c, month: suggestedMonth(doc), ...restore(doc, raw, now) }));
    loaded.current = true;
  }, [doc]);

  useEffect(() => {
    if (!loaded.current) return;
    try { localStorage.setItem(memoryKey(doc.slug), JSON.stringify(choice)); } catch (e) { /* not remembered */ }
  }, [choice, doc.slug]);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 961px)');
    const onChange = () => { if (mq.matches) setSheet(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const dropped = useMemo(() => new Set(choice.dropped), [choice.dropped]);
  const kept = total - choice.dropped.filter((id) => byId.has(id)).length;
  const set = (patch) => setChoice((c) => ({ ...c, ...patch }));

  function toggle(id) {
    setChoice((c) => ({
      ...c,
      dropped: c.dropped.includes(id) ? c.dropped.filter((x) => x !== id) : [...c.dropped, id],
    }));
  }

  function plan() {
    if (choice.mode === 'dates' && !choice.start) return;
    try {
      sessionStorage.setItem(BRIEF_KEY, composeBrief(doc, choice));
    } catch (e) { /* without storage the title alone still plans something */ }
    setSheet(false);
    router.push(`/plan?q=${encodeURIComponent(briefTitle(doc))}&brief=1`);
  }

  const cover = doc.cover && doc.cover.photo;

  // Every photograph in the journal, in reading order, so the viewer can step
  // through them all from whichever one was opened.
  const gallery = useMemo(() => {
    const list = [];
    if (cover) list.push(forViewer(cover));
    else if (hero) list.push(hero);
    (doc.blocks || []).forEach((b) => {
      if (b.type !== 'photo') return;
      (b.photos || []).slice(0, b.layout === 'pair' ? 2 : 1).forEach((m) => list.push(forViewer(m)));
    });
    return list;
  }, [doc, cover, hero]);

  const openPhoto = (id) => {
    const at = gallery.findIndex((p) => (p.id || p.ref) === id);
    setViewer({ photos: gallery, index: Math.max(0, at) });
  };

  function rich(text) {
    return tokenize(text).map((part, i) => {
      if (part.text != null) return part.text;
      const p = byId.get(part.place);
      if (!p) return null;
      const off = dropped.has(p.id);
      return (
        <button key={i} type="button" className={s.place} data-off={off ? '' : undefined}
          aria-haspopup="dialog" aria-expanded={open ? open.id === p.id : false}
          aria-label={`${p.name}${off ? ', left out of your version' : ''}`}
          onClick={(e) => setOpen(open && open.id === p.id ? null : { id: p.id, anchor: e.currentTarget })}>
          {p.name}
        </button>
      );
    });
  }

  function block(b, i) {
    switch (b.type) {
      case 'heading':
        return (
          <div key={i} className={s.bHeading}>
            {b.kicker ? <span className={s.bKicker}>{b.kicker}</span> : null}
            <h2 className={s.bTitle}>{rich(b.text)}</h2>
          </div>
        );
      case 'prose': {
        const paras = paragraphs(b.text).map((para, k) => <p key={`${i}-${k}`} className={s.bProse}>{rich(para)}</p>);
        if (!b.kicker) return paras;
        // Some journeys put a section's label on its first paragraph instead
        // of on a heading. Show it as the heading it was meant to be.
        const [when, ...where] = b.kicker.split(' · ');
        return [
          <div key={`${i}-h`} className={s.bHeading}>
            {where.length ? <span className={s.bKicker}>{when}</span> : null}
            <h2 className={s.bTitle}>{where.length ? where.join(' · ') : when}</h2>
          </div>,
          ...paras,
        ];
      }
      case 'photo':
        return <PhotoBlock key={i} block={b} onOpen={openPhoto} />;
      case 'quote':
        return <blockquote key={i} className={s.bQuote}>{rich(b.text)}</blockquote>;
      case 'tip':
      case 'detour':
      case 'skip': {
        const Icon = b.type === 'tip' ? Info : b.type === 'detour' ? Route : EyeOff;
        const label = b.label || b.title || (b.type === 'tip' ? 'Good to know' : b.type === 'detour' ? 'A detour' : 'Skip it');
        return (
          <aside key={i} className={`${s.bNote} ${b.type === 'detour' ? s.bDetour : b.type === 'skip' ? s.bSkip : ''}`}>
            <span className={s.bLabel}><Icon size={14} aria-hidden="true" /> {label}</span>
            {paragraphs(b.text).map((para, k) => <p key={k}>{rich(para)}</p>)}
          </aside>
        );
      }
      case 'day':
        return (
          <section key={i} className={s.bDay}>
            {b.title ? <h3 className={s.bDayTitle}>{b.title}</h3> : null}
            <ol>
              {(b.items || []).map((it, k) => (
                <li key={k}><span className={s.bTime}>{it.time}</span><span>{rich(it.text)}</span></li>
              ))}
            </ol>
          </section>
        );
      default:
        return null;
    }
  }

  const openPlace = open ? byId.get(open.id) : null;
  const form = (onClose) => (
    <MakeItYours doc={doc} choice={choice} set={set} today={today} kept={kept} total={total}
      dropped={dropped} onToggle={toggle} onPlan={plan} onClose={onClose} />
  );
  const sources = doc.sources || [];

  return (
    <article>
      <Link href="/journeys" className={s.back}>
        <ArrowLeft size={16} aria-hidden="true" /> All journeys
      </Link>

      <header className={s.hero} style={cover && cover.color ? { backgroundColor: cover.color } : undefined}>
        {cover ? (
          <img className={s.heroImg} alt={cover.alt || ''} fetchPriority="high"
            src={imageURL(cover, 1600)} srcSet={srcSet(cover, [960, 1600, 2400, 3200])}
            sizes="(max-width: 1120px) 100vw, 1080px" />
        ) : hero ? (
          <img className={s.heroImg} alt="" src={`/api/places/photo?ref=${encodeURIComponent(hero.ref)}&w=2400`} />
        ) : null}
        <div className={s.heroText}>
          <span className={s.heroKicker}>{placeLine(doc)}</span>
          <h1 className={s.heroTitle}>{doc.title}</h1>
          <div className={s.heroMeta}>
            <span>{daysLabel(doc)}</span>
            <span>{doc.pace} pace</span>
            <span>{costLabel(doc)}</span>
          </div>
        </div>
        {cover ? (
          <span className={s.heroCredit}>
            Photo by <a href={cover.authorUrl} target="_blank" rel="noreferrer">{cover.author}</a>
            {' '}on <a href={cover.pageUrl} target="_blank" rel="noreferrer">Unsplash</a>
          </span>
        ) : hero && hero.author ? (
          <span className={s.heroCredit}>Photo: {hero.author}</span>
        ) : null}
        {gallery.length ? (
          <button type="button" className={s.heroPhotos} onClick={() => setViewer({ photos: gallery, index: 0 })}>
            <Camera size={15} aria-hidden="true" /> {gallery.length} {gallery.length === 1 ? 'photo' : 'photos'}
          </button>
        ) : null}
      </header>

      <div className={s.layout}>
        <div className={s.read}>
          <p className={s.journalLede}>{doc.lede}</p>

          <section className={s.glance} aria-label="At a glance">
            <div className={s.glanceWhen}>
              <span className={s.glanceK}>When to go</span>
              <MonthStrip journey={doc} large />
              <div className={s.legend} aria-hidden="true">
                <span><i /> Best</span>
                <span><i className={s.lgGood} /> Good</span>
                {(doc.months.avoid || []).length ? <span><i className={s.lgAvoid} /> Avoid</span> : null}
              </div>
              <p className={s.whenNote}>{doc.when}</p>
            </div>
            <div><span className={s.glanceK}>Length</span><span className={s.glanceV}>{daysLabel(doc)}</span></div>
            <div><span className={s.glanceK}>Pace</span><span className={s.glanceV}>{doc.pace}</span></div>
            <div><span className={s.glanceK}>Budget</span><span className={s.glanceV}>{costLabel(doc)}</span></div>
          </section>

          <div className={s.flow}>{(doc.blocks || []).map(block)}</div>

          {doc.video ? <VideoBlock video={doc.video} /> : null}

          {(doc.know || []).length ? (
            <section className={s.know} aria-labelledby="good-to-know">
              <h2 id="good-to-know" className={s.knowTitle}>Good to know</h2>
              <dl className={s.knowList}>
                {doc.know.map((k) => (
                  <div key={k.label} className={s.knowRow}><dt>{k.label}</dt><dd>{k.text}</dd></div>
                ))}
              </dl>
            </section>
          ) : null}

          {doc.checked || sources.length ? (
            <footer className={s.provenance}>
              {doc.checked ? <p>Checked against current information on {checkedOn(doc.checked)}.</p> : null}
              {sources.length ? (
                <details>
                  <summary>Sources</summary>
                  <ul>
                    {sources.map((src) => (
                      <li key={src.url}>
                        <a href={src.url} target="_blank" rel="noreferrer nofollow">{src.title || host(src.url)}</a>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </footer>
          ) : null}
        </div>

        <aside className={s.aside} aria-label="Make it yours">
          <div className={s.panel}>{form(null)}</div>
        </aside>
      </div>

      <div className={s.dock}>
        <span className={s.kept}>Keeping {kept} of {total} places</span>
        <button type="button" className="btn primary" onClick={() => setSheet(true)}>
          <Sparkles size={16} aria-hidden="true" /> Make it yours
        </button>
      </div>

      {sheet ? <Sheet onClose={() => setSheet(false)}>{form(() => setSheet(false))}</Sheet> : null}

      {openPlace ? (
        <PlaceCard key={openPlace.id} place={openPlace} anchor={open.anchor} kept={!dropped.has(openPlace.id)}
          onToggle={() => toggle(openPlace.id)} onClose={() => setOpen(null)}
          onPhotos={(photos, index) => { setOpen(null); setViewer({ photos, index }); }} />
      ) : null}

      {viewer ? (
        <Lightbox photos={viewer.photos} index={viewer.index} alt={doc.title}
          onIndex={(index) => setViewer((v) => ({ ...v, index }))} onClose={() => setViewer(null)} />
      ) : null}
    </article>
  );
}

/*
 * A creator's video of the journey, chosen by the journey service.
 *
 * A picture and a play button until pressed: an embedded player costs a
 * megabyte of script and tells YouTube about everyone who scrolls past, while
 * this costs one thumbnail. Pressing play loads YouTube's privacy-enhanced
 * player in its place, credited to the channel that made the video.
 */
function VideoBlock({ video }) {
  const [playing, setPlaying] = useState(false);
  const [thumb, setThumb] = useState(`https://i.ytimg.com/vi/${video.id}/maxresdefault.jpg`);
  const minutes = Math.round((video.seconds || 0) / 60);
  return (
    <section className={s.video} aria-labelledby="journey-video">
      <h2 id="journey-video" className={s.knowTitle}>See it moving</h2>
      <div className={s.videoFrame}>
        {playing ? (
          <iframe src={`https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&rel=0`}
            title={video.title} allowFullScreen referrerPolicy="strict-origin-when-cross-origin"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" />
        ) : (
          <button type="button" className={s.videoPlay} onClick={() => setPlaying(true)}
            aria-label={`Play “${video.title}” by ${video.channel}`}>
            <img src={thumb} alt="" loading="lazy" decoding="async"
              onError={() => setThumb(`https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`)} />
            <span className={s.playIcon} aria-hidden="true"><Play size={26} /></span>
          </button>
        )}
      </div>
      <p className={s.videoMeta}>
        <span className={s.videoTitle}>{video.title}</span>
        <span>
          by{' '}
          <a href={`https://www.youtube.com/channel/${video.channelId}`} target="_blank" rel="noreferrer">{video.channel}</a>
          {minutes ? ` · ${minutes} min` : ''} · on{' '}
          <a href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noreferrer">YouTube</a>
        </span>
      </p>
    </section>
  );
}

function PhotoBlock({ block: b, onOpen }) {
  const photos = (b.photos || []).slice(0, b.layout === 'pair' ? 2 : 1);
  if (!photos.length) return null;
  const pair = photos.length === 2;
  const layout = pair ? s.bPair : b.layout === 'inset' ? s.bInset : s.bWide;
  const authors = [...new Map(photos.map((m) => [m.author, m])).values()];
  const sizes = pair ? '(max-width: 960px) 50vw, 340px'
    : b.layout === 'inset' ? '(max-width: 960px) 100vw, 320px' : '(max-width: 960px) 100vw, 760px';
  return (
    <figure className={`${s.bPhoto} ${layout}`}>
      <div className={s.bFrames}>
        {photos.map((m) => (
          <button key={m.id} type="button" className={s.bFrame}
            style={m.color ? { backgroundColor: m.color } : undefined}
            aria-label={`Open photograph${m.alt ? `: ${m.alt}` : ''}`} onClick={() => onOpen(m.id)}>
            <img src={imageURL(m, pair ? 900 : 1400)}
              srcSet={srcSet(m, pair ? [480, 720, 960, 1400] : [640, 960, 1400, 2000, 2800])}
              sizes={sizes} alt={m.alt || ''} loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
      <figcaption>
        {b.caption ? <span className={s.bCaption}>{b.caption}</span> : <span />}
        <span className={s.bCredit}>
          {authors.length > 1 ? 'Photos' : 'Photo'} by{' '}
          {authors.map((m, k) => (
            <span key={m.id}>{k ? ' and ' : ''}<a href={m.authorUrl} target="_blank" rel="noreferrer">{m.author}</a></span>
          ))}
          {' '}on <a href={photos[0].pageUrl} target="_blank" rel="noreferrer">Unsplash</a>
        </span>
      </figcaption>
    </figure>
  );
}

/*
 * A place, opened from its name in the text: its photographs from Google at
 * full size, the note the journal gives it, and whether it stays in your
 * version. Looked up when opened, never stored — Google allows keeping the
 * place ID, not what it returns for it.
 */
function PlaceCard({ place, anchor, kept, onToggle, onClose, onPhotos }) {
  const [info, setInfo] = useState({ loading: true, photos: [], mapsUri: '' });

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        let id = place.place_id;
        if (!id) {
          const [hit] = await searchPlaces(place.q);
          id = hit && hit.place_id;
        }
        const d = id ? await placeDetails(id) : null;
        if (live) setInfo({ loading: false, photos: (d && d.photos) || [], mapsUri: (d && d.mapsUri) || '' });
      } catch (e) {
        if (live) setInfo({ loading: false, photos: [], mapsUri: '' });
      }
    })();
    return () => { live = false; };
  }, [place.place_id, place.q]);

  const first = info.photos[0];
  return (
    <Popover anchorEl={anchor} open onClose={onClose} align="start" width={300}>
      <div className={s.placeCard} role="dialog" aria-label={place.name}>
        {first ? (
          <button type="button" className={s.placeShot} onClick={() => onPhotos(info.photos, 0)}
            aria-label={`See photographs of ${place.name}`}>
            <img src={`/api/places/photo?ref=${encodeURIComponent(first.ref)}&w=800`} alt="" />
            <span className={s.placeCount}><Camera size={13} aria-hidden="true" /> {info.photos.length}</span>
          </button>
        ) : info.loading ? <div className={`skel ${s.placeShotSkel}`} /> : null}
        <div className={s.placeBody}>
          <strong>{place.name}</strong>
          {place.address ? <span className={s.placeAddr}>{shortPlace(place.address)}</span> : null}
          <p>{place.note}</p>
          <div className={s.placeActs}>
            <button type="button" className={`btn sm${kept ? '' : ' primary'}`} aria-pressed={kept} onClick={onToggle}>
              {kept ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
              {kept ? 'In my version' : 'Add back'}
            </button>
            {info.mapsUri ? (
              <a className="btn ghost sm" href={info.mapsUri} target="_blank" rel="noreferrer">
                <MapPin size={14} aria-hidden="true" /> Maps
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </Popover>
  );
}

/*
 * The phone's version of the desk panel. Portalled rather than a native modal
 * dialog: a modal dialog sits in the top layer, above the date picker's own
 * popover, which would open somewhere nobody could reach it.
 */
function Sheet({ onClose, children }) {
  const [target, setTarget] = useState(null);
  const panel = useRef(null);
  useModalChrome({ onEscape: onClose });
  useEffect(() => { setTarget(document.body); }, []);
  useEffect(() => { if (target && panel.current) panel.current.focus(); }, [target]);
  if (!target) return null;
  return createPortal(
    <div className={s.sheetBack} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} className={s.sheet} role="dialog" aria-modal="true" aria-label="Make it yours" tabIndex={-1}>
        {children}
      </div>
    </div>,
    target,
  );
}

function MakeItYours({ doc, choice, set, today, kept, total, dropped, onToggle, onPlan, onClose }) {
  const id = useId();
  const days = clampDays(doc, choice.days);
  const end = choice.start ? addDays(choice.start, days - 1) : '';
  const fit = choice.month ? monthFit(doc, choice.month) : 'fine';

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
                const f = monthFit(doc, i + 1);
                const said = f === 'best' ? ', best time' : f === 'good' ? ', good time' : f === 'avoid' ? ', a poor time' : '';
                return (
                  <button key={m} type="button" data-fit={f} aria-pressed={choice.month === i + 1}
                    aria-label={`${m}${said}`} onClick={() => set({ month: i + 1 })}>
                    {m.slice(0, 3)}
                  </button>
                );
              })}
            </div>
            {fit === 'avoid' ? <p className={s.hint}>{doc.when}</p> : null}
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
          <span className={s.hint}>Written for {daysLabel(doc)}</span>
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

      {total ? (
        <div className={s.field} role="group" aria-labelledby={`${id}-places`}>
          <span id={`${id}-places`} className={s.label}>Places · keeping {kept} of {total}</span>
          <ul className={s.placeList}>
            {doc.places.map((p) => {
              const off = dropped.has(p.id);
              return (
                <li key={p.id}>
                  <label className={s.placeRow} data-off={off ? '' : undefined}>
                    <input type="checkbox" checked={!off} onChange={() => onToggle(p.id)} />
                    <span>{p.name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className={s.field}>
        <label htmlFor={`${id}-extra`} className={s.label}>Anything to change?</label>
        <GrowArea id={`${id}-extra`} value={choice.extra} maxLength={600}
          placeholder="Vegetarian, an extra free day, no early starts"
          onChange={(e) => set({ extra: e.target.value })} />
      </div>

      <div className={s.actions}>
        <button type="submit" className={`btn primary lg ${s.wide}`}
          disabled={choice.mode === 'dates' && !choice.start}>
          <Sparkles size={17} aria-hidden="true" /> Plan my version
        </button>
        <Link href={`/globe?want=${doc.slug}`} className={`btn ghost ${s.wide}`}>
          <Star size={16} aria-hidden="true" /> Save to my globe
        </Link>
      </div>
    </form>
  );
}
