import Link from 'next/link';
import PlanPrompt from '@/components/PlanPrompt';
import HeroAtlas from '@/components/HeroAtlas';
import HeroSheet from '@/components/HeroSheet';
import TogetherSheet from '@/components/TogetherSheet';
import LandingAccount from '@/components/LandingAccount';
import BrandMark from '@/components/BrandMark';
import TravelArt from '@/components/TravelArt';
import PromoVideo from '@/components/PromoVideo';
import GuideRail from '@/components/GuideRail';
import { accountHintScript } from '@/lib/accountHint';
import { authForwardScript } from '@/lib/authReturn';
import {
  CalendarDays, MapPin, Wallet, Backpack, NotebookPen, Users,
  Zap, ShieldCheck, Printer,
} from 'lucide-react';
import './landing.css';

export const metadata = {
  title: 'Wander — plan trips together, day by day',
  description:
    'A day-by-day travel itinerary planner with a map, budget, packing list and shared notes. '
    + 'Share one link and plan together live.',
};

/*
 * Nothing on this page waits for a script to be seen.
 *
 * The copy is in the HTML and readable at once; the only thing that moves on
 * its own is the day being planned in the hero, and that is drawn finished
 * before it starts (components/HeroSheet.jsx). Blocks used to be sent hidden and
 * revealed as they scrolled into view, which meant a slow phone showed a nav bar
 * and nothing else until the bundle had run. Legacy share links at /?join=<code>
 * are redirected in next.config.mjs, which is also what lets this page be
 * generated once instead of on every visit.
 */

// `eg` is a taste of the real thing, in the type the app uses for it.
const FEATURES = [
  { icon: CalendarDays, title: 'A day for every date', body: 'Type “9am Senso-ji” and it files itself.', eg: 'Day 3, 9:00 am' },
  { icon: MapPin, title: 'Everything on a map', body: 'The whole trip, or one day at a time.', eg: '5 stops, 4.2 km' },
  { icon: Wallet, title: 'Costs as you go', body: 'Price a stop and the budget builds itself.', eg: '¥8,100 so far' },
  { icon: Backpack, title: 'Packing, shared', body: 'One list everyone ticks off.', eg: '14 of 22 packed' },
  { icon: NotebookPen, title: 'Notes and refs', body: 'Confirmations beside the plan, not in a chat.', eg: 'Booking ref K7M2QX' },
  { icon: Printer, title: 'Ready without signal', body: 'Download your trip or print a copy.', eg: 'Saved for offline' },
];

const STEPS = [
  { title: 'Describe it', body: 'A sentence is enough, or a photo of a guidebook page you tore out.' },
  { title: 'Adjust it', body: 'Every day arrives filled in. Move stops, add costs, or ask for changes in your own words.' },
  { title: 'Send the link', body: 'They sign in and edit the same trip with you, live.' },
];

export default function Landing() {
  const hint = accountHintScript(process.env.NEXT_PUBLIC_SUPABASE_URL || '');

  return (
    <div className="lp" id="top">
      {/* Somebody who arrives here straight out of a sign-in — a confirmation
          email, or a return Supabase would not send anywhere else — goes on to
          their trips (lib/authReturn.js). Before the account hint: there is no
          point drawing a page that is being left. */}
      <script dangerouslySetInnerHTML={{ __html: authForwardScript() }} />
      {/* Says whether this browser is signed in while the page is still being
          parsed, so the account control is right in the first frame. */}
      {hint ? <script dangerouslySetInnerHTML={{ __html: hint }} /> : null}
      <a className="lp-skip" href="#lp-main">Skip to content</a>

      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <span className="brand-link">
            <BrandMark />
            <span className="brand-word">Wander</span>
          </span>
          <nav className="lp-links" aria-label="On this page">
            <a className="lp-link lp-link-wide" href="#how">How it works</a>
            <a className="lp-link lp-link-wide" href="#features">Features</a>
            <Link className="lp-link" href="/guides">Guides</Link>
          </nav>
          <LandingAccount />
        </div>
      </header>

      <main id="lp-main">
        <div className="lp-stage">
          <HeroAtlas />
          <section className="lp-hero" aria-labelledby="lp-title">
            <div className="lp-hero-copy">
              <h1 className="lp-h1" id="lp-title">
                Describe the trip. <span>Get the plan.</span>
              </h1>
              <p className="lp-lede">
                Say where you are going. Wander lays out every day, maps it, and totals the cost.
              </p>
              <PlanPrompt autoFocus={false} rotate />
              <p className="lp-blank">
                Or <Link href="/trips">start from a blank trip</Link>.
              </p>
              <p className="lp-fine">Free and open source. Download any trip to use it offline.</p>
            </div>
            <HeroSheet />
          </section>
        </div>

        <section className="lp-section" id="how" aria-labelledby="lp-how-title">
          <div className="lp-how">
            <div>
              <div className="lp-head">
                <h2 className="lp-h2" id="lp-how-title">How it works</h2>
                <p className="lp-sub">From a sentence to a shared trip.</p>
              </div>
              <ol className="lp-route" role="list">
                {STEPS.map((step, i) => (
                  <li key={step.title}>
                    <span className="lp-pin" aria-hidden="true">{i + 1}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <PromoVideo />
          </div>
        </section>

        <section className="lp-section" id="features" aria-labelledby="lp-features-title">
          <div className="lp-head">
            <h2 className="lp-h2" id="lp-features-title">Everything the trip needs</h2>
            <p className="lp-sub">In one place, not five apps.</p>
          </div>
          <ul className="lp-index" role="list">
            {FEATURES.map((f) => (
              <li className="lp-row" key={f.title}>
                <f.icon className="lp-row-ico" size={22} strokeWidth={1.6} aria-hidden="true" />
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <span className="lp-row-eg">{f.eg}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-section" id="guides" aria-labelledby="lp-guides-title">
          <div className="lp-head">
            <h2 className="lp-h2" id="lp-guides-title">Not sure where yet?</h2>
            <p className="lp-sub">Borrow a guide and make it yours.</p>
          </div>
          <GuideRail title="" />
        </section>

        <section className="lp-together" aria-labelledby="lp-together-title">
          <div className="lp-wrap lp-together-in">
            <div>
              <h2 className="lp-h2" id="lp-together-title">One link. Everyone editing the same trip.</h2>
              <p className="lp-body">
                Send the link, they sign in, and you are both editing the same trip.
              </p>
              <ul className="lp-points" role="list">
                <li>
                  <Users size={20} strokeWidth={1.6} aria-hidden="true" />
                  <div><strong>Live presence</strong><span>See who else is here.</span></div>
                </li>
                <li>
                  <Zap size={20} strokeWidth={1.6} aria-hidden="true" />
                  <div><strong>Instant edits</strong><span>Changes land as they happen.</span></div>
                </li>
                <li>
                  <ShieldCheck size={20} strokeWidth={1.6} aria-hidden="true" />
                  <div>
                    <strong>Your plans stay together</strong>
                    <span>Bookings, notes and addresses shared with your travel companions.</span>
                  </div>
                </li>
              </ul>
            </div>
            <TogetherSheet />
          </div>
        </section>

        <section className="lp-final" aria-labelledby="lp-final-title">
          <div className="lp-wrap lp-final-in">
            <div className="lp-final-copy">
              <h2 className="lp-h2" id="lp-final-title">Where are you going?</h2>
              <PlanPrompt rotate />
            </div>
            <TravelArt kind="journey" className="lp-final-art" />
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-in">
          <span className="lp-footer-brand">
            <BrandMark className="brand-mark-small" />
            <span>Wander</span>
            <span className="dim">travel itinerary planner</span>
          </span>
          <nav className="lp-footer-links" aria-label="More">
            <Link href="/guides">Guides</Link>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </nav>
          <span className="dim">Maps and places by Google</span>
        </div>
      </footer>
    </div>
  );
}
