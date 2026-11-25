'use client';
import { useId, useState } from 'react';
import { ChevronDown, FileText, Globe, Loader2, Search, TextSearch } from 'lucide-react';
import { cleanSourceUrl, settledSteps, sourceSite, stepsSummary } from '@/lib/tripAsk';
import s from './TripAsk.module.css';

// Sites shown under a search before "+ more".
const SHOWN = 5;

/** "japan-guide.com/e/e3011.html": where a page is, short enough for one line. */
function shortPage(url) {
  try {
    const u = new URL(url);
    let path = u.pathname.replace(/\/+$/, '');
    try { path = decodeURIComponent(path); } catch { /* left encoded */ }
    const full = `${u.hostname.replace(/^www\./, '')}${path}`;
    return full.length > 56 ? `${full.slice(0, 55)}…` : full;
  } catch {
    return '';
  }
}

/* One site a search turned up, as a pill like a citation's. They arrive one
   after another rather than all at once, the way a search reads. */
function Site({ url, i }) {
  const href = cleanSourceUrl(url);
  if (!href) return null;
  return (
    <a className={s.cite} href={href} target="_blank" rel="noopener noreferrer" data-tip={href}
      style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}>
      {sourceSite(href)}
    </a>
  );
}

function Sites({ step }) {
  const [all, setAll] = useState(false);
  const sites = step.sites || [];
  if (!sites.length) return null;
  const shown = all ? sites : sites.slice(0, SHOWN);
  // The search may have turned up more than were kept; those are a number only.
  const more = Math.max(0, (step.found || sites.length) - shown.length);
  const canOpen = !all && sites.length > shown.length;
  return (
    <span className={s.stepSites}>
      {shown.map((u, i) => <Site key={u} url={u} i={i} />)}
      {more ? (canOpen
        ? <button type="button" className={s.more} onClick={() => setAll(true)}>+{more} more</button>
        : <span className={s.more}>+{more} more</span>) : null}
    </span>
  );
}

function Page({ url }) {
  const href = cleanSourceUrl(url);
  if (!href) return <>a page</>;
  return <a className={s.readLink} href={href} target="_blank" rel="noopener noreferrer" data-tip={href}>{shortPage(href)}</a>;
}

function Step({ step }) {
  if (step.kind === 'search') {
    return (
      <li className={s.step}>
        <Search size={14} aria-hidden="true" />
        <div>
          <span className={s.stepText}>{step.query ? `“${step.query}”` : 'Searched the web'}</span>
          <Sites step={step} />
        </div>
      </li>
    );
  }
  if (step.kind === 'open') {
    return (
      <li className={s.step}>
        <FileText size={14} aria-hidden="true" />
        <span>Read <Page url={step.url} /></span>
      </li>
    );
  }
  if (step.kind === 'find') {
    return (
      <li className={s.step}>
        <TextSearch size={14} aria-hidden="true" />
        <span>
          {step.pattern ? <>Looked for <span className={s.stepText}>“{step.pattern}”</span> on </> : 'Looked through '}
          <Page url={step.url} />
        </span>
      </li>
    );
  }
  // Started, and not yet said what it is doing: the line above says it.
  return (
    <li className={s.step}>
      <Loader2 size={14} className="spin" aria-hidden="true" />
      <span className={`skel ${s.stepWait}`} aria-hidden="true" />
    </li>
  );
}

/**
 * What the web search did for an answer: each search and the sites it turned
 * up, each page read. Open while the answer is being gathered, so there is
 * something to watch besides a spinner; folded into one line once the words
 * start, and opened again by anyone who wants to see where they came from.
 */
export default function AskSearch({ steps, writing, gathering }) {
  // null follows the answer; a click decides from then on.
  const [chosen, setChosen] = useState(null);
  const id = useId();
  const list = writing ? steps : settledSteps(steps);
  if (!list.length) return null;
  const pending = writing && list.some((x) => x.pending);
  const busy = writing && (gathering || pending);
  const open = chosen ?? (writing && gathering);
  const summary = stepsSummary(list);
  const label = pending ? 'Searching the web' : busy ? 'Thinking' : 'Searched the web';
  return (
    <div className={s.trail}>
      <button type="button" className={s.trailHead} aria-expanded={open} aria-controls={id} onClick={() => setChosen(!open)}>
        {busy ? <Loader2 size={14} className="spin" aria-hidden="true" /> : <Globe size={14} aria-hidden="true" />}
        <span>{label}{summary ? <span className={s.trailCount}> · {summary}</span> : null}</span>
        <ChevronDown size={14} className={s.chev} aria-hidden="true" />
      </button>
      {open ? (
        <ol className={s.steps} id={id}>
          {list.map((step, i) => <Step key={step.id || i} step={step} />)}
        </ol>
      ) : null}
    </div>
  );
}
