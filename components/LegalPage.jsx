import Link from 'next/link';
import BrandMark from '@/components/BrandMark';

/**
 * The frame both legal pages share.
 *
 * Deliberately a plain server component with no provider around it: these have
 * to be readable by someone who is not signed in, and by Google's reviewer,
 * who will open them in a fresh browser with no session and expect a page
 * rather than a sign-in wall.
 */
export default function LegalPage({ title, updated, children }) {
  return (
    <div className="shell">
      <header className="lp-top">
        <Link href="/" className="brand-link" aria-label="Wander — home">
          <BrandMark />
          <span className="brand-word">Wander</span>
        </Link>
        <div className="grow" />
        <Link className="btn sm" href="/trips">Open Wander</Link>
      </header>

      <main className="main main-plain">
        <article className="legal">
          <h1>{title}</h1>
          <p className="legal-date">Last updated {updated}</p>
          {children}
        </article>
      </main>

      <footer className="lp-foot">
        <span>Wander — travel itinerary planner</span>
        <div className="grow" />
        <Link className="dim" href="/privacy">Privacy</Link>
        <Link className="dim" href="/terms">Terms</Link>
      </footer>
    </div>
  );
}
