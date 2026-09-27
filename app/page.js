import Link from 'next/link';
import { redirect } from 'next/navigation';
import PlanPrompt from '@/components/PlanPrompt';
import HeroAtlas from '@/components/HeroAtlas';
import Reveal from '@/components/Reveal';
import LiveMock from '@/components/LiveMock';
import FeatureGrid from '@/components/FeatureGrid';
import LandingAccount from '@/components/LandingAccount';
import BrandMark from '@/components/BrandMark';
import TravelArt from '@/components/TravelArt';
import PromoVideo from '@/components/PromoVideo';
import GuideRail from '@/components/GuideRail';
import {
  CalendarDays, MapPin, Wallet, Backpack, NotebookPen, Users,
  ArrowRight, Check, Printer, Share2, Zap, ShieldCheck,
} from 'lucide-react';

export const metadata = {
  title: 'Wander — plan trips together, day by day',
  description:
    'A day-by-day travel itinerary planner with a map, budget, packing list and shared notes. '
    + 'Share one link and plan together live.',
};

const FEATURES = [
  { icon: CalendarDays, title: 'A day for every date', body: 'Type "9am Senso-ji" and it files itself.' },
  { icon: MapPin, title: 'Everything on a map', body: 'The whole trip, or one day at a time.' },
  { icon: Wallet, title: 'Costs as you go', body: 'Price a stop and the budget builds itself.' },
  { icon: Backpack, title: 'Packing, shared', body: 'One list everyone ticks off.' },
  { icon: NotebookPen, title: 'Notes and refs', body: 'Confirmations beside the plan, not in a chat.' },
  { icon: Printer, title: 'Ready without signal', body: 'Download your trip or print a copy.' },
];

const STEPS = [
  { n: '1', title: 'Describe it', body: 'A sentence is enough.' },
  { n: '2', title: 'Adjust it', body: 'Every day arrives filled in and editable.' },
  { n: '3', title: 'Send the link', body: 'They sign in and can edit with you.' },
];

export default async function Landing({ searchParams }) {
  // Share links used to live at /?join=<code>; keep those working.
  const sp = await searchParams;
  const legacy = sp && sp.join;
  if (legacy) redirect(`/join/${Array.isArray(legacy) ? legacy[0] : legacy}`);

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-in">
          <span className="brand-link" style={{ pointerEvents: 'none' }}>
            <BrandMark />
            <span className="brand-word">Wander</span>
          </span>
          <div className="grow" />
          <Link className="lp-navlink" href="/guides">Guides</Link>
          <a className="lp-navlink" href="#features">Features</a>
          <a className="lp-navlink" href="#how">How it works</a>
          <LandingAccount />
        </div>
      </header>

      <main>
        <div className="lp-hero-stage">
          <HeroAtlas />
          <section className="lp-hero">
            <div className="lp-hero-copy">
              <Reveal as="span" className="lp-eyebrow" delay={40}>
                <Zap size={13} /> Free. Yours. Shareable.
              </Reveal>
              <Reveal as="h1" delay={110}>Describe the trip. Get the plan.</Reveal>
              <Reveal as="p" className="lp-lede" delay={180}>
                Say where you are going. Wander lays out every day, maps it, and totals the cost.
              </Reveal>
              <Reveal delay={250}><PlanPrompt autoFocus={false} rotate /></Reveal>
              <Reveal className="lp-cta" delay={320}>
                <Link className="btn lg" href="/trips">
                  Start blank <ArrowRight size={17} />
                </Link>
              </Reveal>
              <Reveal as="ul" className="lp-ticks" delay={390}>
                <li><Check size={15} /> Free and open source</li>
                <li><Check size={15} /> Bookings and notes together</li>
                <li><Check size={15} /> Download for offline access</li>
              </Reveal>
            </div>

            <Reveal className="lp-hero-visual" from="right" delay={220} aria-hidden="true">
              <LiveMock />
            </Reveal>
          </section>
        </div>

        <section className="lp-section" id="features">
          <Reveal className="lp-section-head">
            <h2>Everything the trip needs</h2>
            <p>In one place, not five apps.</p>
          </Reveal>
          <FeatureGrid>
            {FEATURES.map((f, i) => (
              <Reveal as="article" className="lp-card" key={f.title} delay={i * 55}>
                <span className="lp-card-ico" aria-hidden="true"><f.icon size={19} /></span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </Reveal>
            ))}
          </FeatureGrid>
        </section>

        <section className="lp-section" id="guides">
          <Reveal className="lp-section-head">
            <h2>Not sure where yet?</h2>
            <p>Borrow a guide and make it yours.</p>
          </Reveal>
          <GuideRail title="" />
        </section>

        <section className="lp-section lp-band">
          <div className="lp-split">
            <Reveal>
              <span className="lp-eyebrow"><Share2 size={13} /> Built for planning together</span>
              <h2>One link. Everyone editing the same trip.</h2>
              <p className="lp-body">
                Send the link, they sign in, and you are both editing the same trip.
              </p>
            </Reveal>
            <ul className="lp-points">
              <Reveal as="li" delay={60}>
                <Users size={17} />
                <div><strong>Live presence</strong><span>See who else is here.</span></div>
              </Reveal>
              <Reveal as="li" delay={130}>
                <Zap size={17} />
                <div><strong>Instant edits</strong><span>Changes land as they happen.</span></div>
              </Reveal>
              <Reveal as="li" delay={200}>
                <ShieldCheck size={17} />
                <div><strong>Your plans stay together</strong><span>Bookings, notes and addresses shared with your travel companions.</span></div>
              </Reveal>
            </ul>
          </div>
        </section>

        <section className="lp-section" id="how">
          <Reveal className="lp-section-head">
            <h2>Three steps</h2>
          </Reveal>
          <ol className="lp-steps">
            {STEPS.map((step, i) => (
              <Reveal as="li" key={step.n} delay={i * 90}>
                <span className="lp-step-n">{step.n}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </Reveal>
            ))}
          </ol>
          <PromoVideo />
        </section>
        <section className="lp-final">
          <TravelArt kind="journey" className="travel-art-landing" />
          <Reveal as="h2">Where are you going?</Reveal>
          <Reveal className="lp-final-box" delay={90}><PlanPrompt rotate /></Reveal>
        </section>
      </main>

      <footer className="lp-foot">
        <BrandMark className="brand-mark-small" />
        <span>Wander — travel itinerary planner</span>
        <div className="grow" />
        <span className="dim">Maps and places by Google</span>
        <Link className="dim" href="/privacy">Privacy</Link>
        <Link className="dim" href="/terms">Terms</Link>
      </footer>
    </div>
  );
}

