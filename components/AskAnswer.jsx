'use client';
import { memo, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Globe, Loader2, RotateCw } from 'lucide-react';
import { activityIcon } from '@/lib/icons';
import { retryImport } from '@/lib/chunkRetry';
import {
  STOP_HREF, cleanSourceUrl, isCitation, parseMapSpec, parsePlacesSpec, sourceSite, stopFor, tidyCitations,
} from '@/lib/tripAsk';
import AskSearch from './AskSearch';
import s from './TripAsk.module.css';

// The map and everything under it (Google's loader, the pins) arrive only
// with the first answer that has a map in it.
const AskMap = dynamic(() => retryImport(() => import('./AskMap')), {
  ssr: false,
  loading: () => <Pending label="Loading the map" />,
});

// Pictures of places, likewise, with the first answer that has some.
const AskPlaces = dynamic(() => retryImport(() => import('./AskPlaces')), {
  ssr: false,
  loading: () => <PicturesPending />,
});

const PLUGINS = [remarkGfm];
const NO_STEPS = Object.freeze([]);
const REHYPE = [tidyCitations];

function Pending({ label }) {
  return (
    <div className={`card ${s.map} ${s.mapFrame}`}>
      <div className={`${s.mapCanvas} ${s.mapWait}`}>
        <Loader2 size={16} className="spin" aria-hidden="true" />
        <span className="small muted">{label}</span>
      </div>
    </div>
  );
}

/* The shape of a row of cards, held while the pictures are on their way. */
function PicturesPending() {
  return (
    <div className={s.places}>
      <div className={s.cards} data-n="3">
        {[0, 1, 2].map((k) => <span key={k} className={`skel ${s.shot}`} aria-hidden="true" />)}
      </div>
    </div>
  );
}

/* Parsed once per version of its text, like a map. */
function PlacesBlock({ raw, writing, ctx }) {
  const spec = useMemo(() => parsePlacesSpec(raw), [raw]);
  if (!spec) return writing ? <PicturesPending /> : null;
  const { trip, days, activities, onOpenStop, onAddPlace, inline } = ctx;
  return (
    <AskPlaces spec={spec} trip={trip} days={days} activities={activities} inline={inline}
      onOpenStop={onOpenStop} onAddPlace={onAddPlace} />
  );
}

const textOf = (node) => (!node ? '' : node.type === 'text' ? node.value
  : (node.children || []).map(textOf).join(''));

function CopyButton({ text, label = 'Copy' }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className="btn ghost sm icon-btn" data-tip={done ? 'Copied' : label} aria-label={label}
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }).catch(() => {});
      }}>
      {done ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

/* A map block is parsed once per version of its text, so an answer still
   streaming below it does not hand the map a new spec — and a new set of
   searches — on every word. */
function MapBlock({ raw, writing, ctx }) {
  const spec = useMemo(() => parseMapSpec(raw), [raw]);
  if (!spec) return writing ? <Pending label="Drawing a map" /> : null;
  const { trip, days, activities, onOpenStop, onAddPlace } = ctx;
  return <AskMap spec={spec} trip={trip} days={days} activities={activities} onOpenStop={onOpenStop} onAddPlace={onAddPlace} />;
}

/**
 * One answer, as Markdown.
 *
 * GitHub's flavour (tables, task lists, strikethrough), with the parts that
 * point back into the app drawn as the app draws them: a stop the answer
 * names opens that stop, a ```map block is a map, a ```places block is
 * pictures of places. No raw HTML, and no image from anywhere the answer
 * names — a search result can put words in an answer, and a picture would be
 * a request to whatever server it named. The pictures are Google's, through
 * our own photo route, found by the place's name.
 */
function AskAnswer({ message, last, trip, days, activities, onOpenStop, onAddPlace, onAgain }) {
  const writing = message.status === 'writing';
  // What the renderers read. A ref rather than a dependency, so the renderers
  // keep one identity for the life of the answer: a new one would remount
  // every map in it, and each map is a billed load.
  const ctx = useRef({});
  ctx.current = { trip, days, activities, onOpenStop, onAddPlace, writing };

  const components = useMemo(() => ({
    a({ href, children, node }) {
      const stop = String(href || '').match(STOP_HREF);
      if (stop) {
        const a = stopFor(ctx.current.activities, stop[1]);
        // A stop deleted since the answer was written is just words now.
        if (!a) return <>{children}</>;
        const Icon = activityIcon(a);
        // A real link, so it wraps like words do and opens in a new tab when asked to.
        return (
          <a className={s.stop} href={`/trips/${ctx.current.trip.id}/itinerary?focus=${encodeURIComponent(a.id)}`}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
              e.preventDefault();
              ctx.current.onOpenStop(a);
            }}>
            <Icon size={13} aria-hidden="true" />{children}
          </a>
        );
      }
      const url = cleanSourceUrl(href);
      if (!url) return <>{children}</>;
      if (isCitation(textOf(node), url)) {
        return <a className={s.cite} href={url} target="_blank" rel="noopener noreferrer" data-tip={url}>{sourceSite(url)}</a>;
      }
      return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
    },
    img({ alt }) {
      return alt ? <span>{alt}</span> : null;
    },
    pre({ node }) {
      const code = node && node.children && node.children[0];
      const cls = (code && code.properties && code.properties.className) || [];
      const lang = String(cls.find((c) => String(c).startsWith('language-')) || '').slice(9);
      const text = textOf(code).replace(/\n$/, '');
      if (lang === 'map') return <MapBlock raw={text} writing={ctx.current.writing} ctx={ctx.current} />;
      if (lang === 'places') return <PlacesBlock raw={text} writing={ctx.current.writing} ctx={ctx.current} />;
      return (
        <div className={s.code}>
          <div className={s.codeHead}>
            <span className="small muted">{lang || 'text'}</span>
            <CopyButton text={text} label="Copy code" />
          </div>
          <pre className="mono"><code>{text}</code></pre>
        </div>
      );
    },
    table({ children }) {
      return <div className={s.tableWrap}><table className="data">{children}</table></div>;
    },
    // A time or a price on one line; a sentence wide enough to read, with the
    // table scrolling sideways on a phone rather than every row ten lines tall.
    td({ node, ...props }) {
      const n = textOf(node).length;
      return <td {...props} className={n <= 16 ? s.short : n > 60 ? s.long : undefined} />;
    },
    h1: ({ children }) => <h3>{children}</h3>,
    h2: ({ children }) => <h3>{children}</h3>,
    h3: ({ children }) => <h4>{children}</h4>,
    h4: ({ children }) => <h4>{children}</h4>,
    h5: ({ children }) => <h4>{children}</h4>,
    h6: ({ children }) => <h4>{children}</h4>,
  }), []);

  /*
   * A place's description in a list of pictures is Markdown too — a bold
   * word, a stop, a cited source — but a sentence, not a block: no paragraph
   * of its own around it.
   */
  const inlineComponents = useMemo(() => ({ ...components, p: ({ children }) => <>{children}</> }), [components]);
  ctx.current.inline = (text) => (
    <Markdown remarkPlugins={PLUGINS} rehypePlugins={REHYPE} components={inlineComponents}>{text}</Markdown>
  );

  const sites = [];
  (message.sources || []).forEach((src) => {
    if (!sites.some((x) => x.url === src.url)) sites.push(src);
  });

  const waiting = writing && !message.content;
  const steps = Array.isArray(message.steps) ? message.steps : NO_STEPS;
  return (
    <div className={s.answer}>
      {steps.length ? <AskSearch steps={steps} writing={writing} gathering={waiting} /> : null}

      {message.content ? (
        <div className={s.md}>
          <Markdown remarkPlugins={PLUGINS} rehypePlugins={REHYPE} components={components}>{message.content}</Markdown>
        </div>
      ) : null}

      {/* Until the first search starts, or when there is none: what the steps
          above would otherwise say. */}
      {waiting && !steps.length ? (
        <p className={`small muted ${s.status}`}>
          <Loader2 size={14} className="spin" aria-hidden="true" />
          {message.searching ? 'Searching the web' : 'Thinking'}
        </p>
      ) : null}

      {message.error ? <p className="err" role="alert">{message.error}</p> : null}
      {message.status === 'stopped' && !message.error ? <p className="small muted">Stopped.</p> : null}

      {sites.length && !writing ? (
        <div className={s.sources}>
          <span className="small muted"><Globe size={13} aria-hidden="true" /> Sources</span>
          {sites.slice(0, 8).map((src) => (
            <a key={src.url} className={s.cite} href={src.url} target="_blank" rel="noopener noreferrer" data-tip={src.title || src.url}>
              {sourceSite(src.url)}
            </a>
          ))}
        </div>
      ) : null}

      {!writing && (message.content || message.error) ? (
        <div className={s.acts}>
          {message.content ? <CopyButton text={message.content} label="Copy answer" /> : null}
          {last ? (
            <button type="button" className="btn ghost sm icon-btn" data-tip="Ask again" aria-label="Ask again" onClick={onAgain}>
              <RotateCw size={15} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default memo(AskAnswer);
