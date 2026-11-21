'use client';
import { memo, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy, Globe, Loader2, RotateCw } from 'lucide-react';
import { activityIcon } from '@/lib/icons';
import { retryImport } from '@/lib/chunkRetry';
import {
  STOP_HREF, cleanSourceUrl, isCitation, parseMapSpec, sourceSite, stopFor, tidyCitations,
} from '@/lib/tripAsk';
import s from './TripAsk.module.css';

// The map and everything under it (Google's loader, the pins) arrive only
// with the first answer that has a map in it.
const AskMap = dynamic(() => retryImport(() => import('./AskMap')), {
  ssr: false,
  loading: () => <Pending label="Loading the map" />,
});

const PLUGINS = [remarkGfm];
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
 * names opens that stop, a ```map block is a map. No raw HTML, and no
 * pictures from anywhere — a search result can put words in an answer, and a
 * picture would be a request to whatever server it named.
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

  const sites = [];
  (message.sources || []).forEach((src) => {
    if (!sites.some((x) => x.url === src.url)) sites.push(src);
  });

  const waiting = writing && !message.content;
  return (
    <div className={s.answer}>
      {message.content ? (
        <div className={s.md}>
          <Markdown remarkPlugins={PLUGINS} rehypePlugins={REHYPE} components={components}>{message.content}</Markdown>
        </div>
      ) : null}

      {writing && (waiting || message.searching) ? (
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
