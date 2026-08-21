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
  {
    icon: CalendarDays,
    title: 'A day for every date',
    body: 'Set the dates and Wander lays out the days. Type "9am Senso-ji" into any day and it files it at nine in the morning — no forms unless you want them.',
  },
  {
    icon: MapPin,
    title: 'Everything on a map',
    body: 'Pin activities as you add them and see the whole trip laid out. Filter to one day to check whether tomorrow actually holds together.',
  },
  {
    icon: Wallet,
    title: 'Costs as you go',
    body: 'Give an activity a price and the budget builds itself — totals by day, by type, and how much of your budget is left.',
  },
  {
    icon: Backpack,
    title: 'Packing that stays shared',
    body: 'One list everyone ticks off, grouped by documents, tech, clothes and the rest. Nobody brings three adapters and no charger.',
  },
  {
    icon: NotebookPen,
    title: 'Notes and booking refs',
    body: 'Flight numbers, hotel confirmations, the restaurant someone swears by. Kept beside the plan instead of buried in a chat thread.',
  },
  {
    icon: Printer,
    title: 'Works on the plane',
    body: 'Print the whole trip, or save it as a PDF, and carry the itinerary with you when there is no signal and no roaming.',
  },
];

const STEPS = [
  { n: '1', title: 'Describe it', body: 'A sentence is enough. Where, roughly how long, and what you actually care about.' },
  { n: '2', title: 'Adjust the plan', body: 'Every day arrives filled in and editable. Move things, retime them, ask for more ideas.' },
  { n: '3', title: 'Send the link', body: 'Everyone you share with can edit immediately — no account, no invite to accept.' },
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
              Say where you are going and what you are into. Wander lays out every day, pins it on
              the map, and totals the budget — then share one link and everyone edits the same
              trip, live.
            </p>
            <PlanPrompt autoFocus={false} />
            <div className="lp-cta">
              <Link className="btn lg" href="/trips">
                Or start from a blank trip <ArrowRight size={17} />
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
            <h2>Everything the trip needs, in one place</h2>
            <p>Six things you would otherwise keep in five different apps and one very long group chat.</p>
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
                There is no sign-up step to lose people at. Open the link and you are in the trip as
                an editor, straight away — with everyone&apos;s changes appearing live as they type,
                and a row of faces showing who else is looking at it right now.
              </p>
              <p className="lp-body">
                Treat the link like a password: anyone holding it can edit, and the trip owner can
                remove people at any time.
              </p>
            </div>
            <ul className="lp-points">
              <li>
                <Users size={17} />
                <div><strong>Live presence</strong><span>See who is in the trip while you plan.</span></div>
              </li>
              <li>
                <Zap size={17} />
                <div><strong>Instant edits</strong><span>Changes land for everyone as they happen.</span></div>
              </li>
              <li>
                <ShieldCheck size={17} />
                <div><strong>Row-level security</strong><span>The database enforces who can see each trip.</span></div>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-section" id="how">
          <div className="lp-section-head">
            <h2>Three steps to a plan</h2>
            <p>Most trips are filled in within about ten minutes.</p>
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
          <p>One sentence is enough to get a whole itinerary back.</p>
          <div className="lp-final-box"><PlanPrompt /></div>
        </section>
      </main>

      <footer className="lp-foot">
        <span className="brand-mark" aria-hidden="true"><Plane size={14} /></span>
        <span>Wander — travel itinerary planner</span>
        <div className="grow" />
        <span className="dim">Maps by OpenStreetMap contributors</span>
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
