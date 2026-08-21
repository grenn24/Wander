import Link from 'next/link';
import { redirect } from 'next/navigation';
import PlanPrompt from '@/components/PlanPrompt';
import Aurora from '@/components/Aurora';
import {
  Plane, CalendarDays, MapPin, Wallet, Backpack, NotebookPen, Users,
  ArrowRight, Check, Printer, Share2, Zap, ShieldCheck,
} from 'lucide-react';

export const metadata = {
  title: 'Wander — plan trips together, day by day',
  description:
    'A day-by-day travel itinerary planner with a map, budget, packing list and shared notes. '
    + 'Share one link and plan together live — no accounts, no sign-ups.',
};

const FEATURES = [
  { icon: CalendarDays, title: 'A day for every date', body: 'Type "9am Senso-ji" and it files itself.' },
  { icon: MapPin, title: 'Everything on a map', body: 'The whole trip, or one day at a time.' },
  { icon: Wallet, title: 'Costs as you go', body: 'Price a stop and the budget builds itself.' },
  { icon: Backpack, title: 'Packing, shared', body: 'One list everyone ticks off.' },
  { icon: NotebookPen, title: 'Notes and refs', body: 'Confirmations beside the plan, not in a chat.' },
  { icon: Printer, title: 'Works on the plane', body: 'Print it. No signal needed.' },
];

const STEPS = [
  { n: '1', title: 'Describe it', body: 'A sentence is enough.' },
  { n: '2', title: 'Adjust it', body: 'Every day arrives filled in and editable.' },
  { n: '3', title: 'Send the link', body: 'Anyone with it can edit. No account.' },
];

export default async function Landing({ searchParams }) {
  // Share links used to live at /?join=<code>; keep those working.
  const sp = await searchParams;
  const legacy = sp && sp.join;
  if (legacy) redirect(`/join/${Array.isArray(legacy) ? legacy[0] : legacy}`);

  return (
    <div className="lp">
      <Aurora />
      <header className="lp-nav">
        <div className="lp-nav-in">
          <span className="brand-link" style={{ pointerEvents: 'none' }}>
            <span className="brand-mark" aria-hidden="true"><Plane size={16} /></span>
            <span className="brand-word">Wander</span>
          </span>
          <div className="grow" />
          <a className="lp-navlink" href="#features">Features</a>
          <a className="lp-navlink" href="#how">How it works</a>
          <Link className="btn primary sm" href="/trips">Open Wander</Link>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <div className="lp-hero-copy">
            <span className="lp-eyebrow"><Zap size={13} /> No accounts. No sign-ups.</span>
            <h1>Describe the trip. Get the plan.</h1>
            <p className="lp-lede">
              Say where you are going. Wander lays out every day, maps it, and totals the cost.
            </p>
            <PlanPrompt autoFocus={false} />
            <div className="lp-cta">
              <Link className="btn lg" href="/trips">
                Start blank <ArrowRight size={17} />
              </Link>
            </div>
            <ul className="lp-ticks">
              <li><Check size={15} /> Free and open source</li>
              <li><Check size={15} /> Your own database</li>
              <li><Check size={15} /> Works offline on paper</li>
            </ul>
          </div>

          <div className="lp-hero-visual" aria-hidden="true">
            <MockItinerary />
          </div>
        </section>

        <section className="lp-section" id="features">
          <div className="lp-section-head">
            <h2>Everything the trip needs</h2>
            <p>In one place, not five apps.</p>
          </div>
          <div className="lp-grid">
            {FEATURES.map((f) => (
              <article className="lp-card" key={f.title}>
                <span className="lp-card-ico" aria-hidden="true"><f.icon size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="lp-section lp-band">
          <div className="lp-split">
            <div>
              <span className="lp-eyebrow"><Share2 size={13} /> Built for planning together</span>
              <h2>One link. Everyone editing the same trip.</h2>
              <p className="lp-body">
                No sign-up to lose people at. Open the link and you are in, editing live.
              </p>
            </div>
            <ul className="lp-points">
              <li>
                <Users size={17} />
                <div><strong>Live presence</strong><span>See who else is here.</span></div>
              </li>
              <li>
                <Zap size={17} />
                <div><strong>Instant edits</strong><span>Changes land as they happen.</span></div>
              </li>
              <li>
                <ShieldCheck size={17} />
                <div><strong>Row-level security</strong><span>The database decides who sees what.</span></div>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-section-head">
            <h2>Three steps</h2>
          </div>
          <ol className="lp-steps">
            {STEPS.map((s) => (
              <li key={s.n}>
                <span className="lp-step-n">{s.n}</span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="lp-final">
          <h2>Where are you going?</h2>
          <div className="lp-final-box"><PlanPrompt /></div>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand-mark" aria-hidden="true"><Plane size={14} /></span>
        <span>Wander — travel itinerary planner</span>
        <div className="grow" />
        <span className="dim">Maps and places by Google</span>
      </footer>
    </div>
  );
}

/** A stylised preview of the itinerary, built from the app's own design tokens. */
function MockItinerary() {
  const rows = [
    { time: '9am', title: 'Senso-ji temple', meta: 'Sightseeing · Asakusa', cat: 'sightseeing', cost: '' },
    { time: '1:30pm', title: 'Ichiran ramen', meta: 'Food & drink · Shibuya', cat: 'food', cost: '¥1,800' },
    { time: '7:40pm', title: 'Shinkansen to Nagoya', meta: 'Transport · Tokyo Station', cat: 'transport', cost: '¥11,300' },
  ];
  return (
    <div className="mock">
      <div className="mock-bar">
        <span className="mock-dot" /><span className="mock-dot" /><span className="mock-dot" />
        <span className="mock-title">Japan, December</span>
      </div>
      <div className="mock-body">
        <div className="mock-dayhead">
          <span className="day-num">Day 3</span>
          <span className="mock-daydate">Fri, 4 Dec</span>
          <span className="today-badge">Today</span>
        </div>
        {rows.map((r) => (
          <div className="mock-act" key={r.title}>
            <span className="mock-time">{r.time}</span>
            <span className="mock-main">
              <span className="mock-name">
                <span className={`dot cat-${r.cat}`} />{r.title}
              </span>
              <span className="mock-meta">{r.meta}</span>
            </span>
            {r.cost ? <span className="mock-cost">{r.cost}</span> : null}
          </div>
        ))}
        <div className="mock-add">+ Add to Fri, 4 Dec — try &ldquo;9am Senso-ji&rdquo;</div>
      </div>
    </div>
  );
}
