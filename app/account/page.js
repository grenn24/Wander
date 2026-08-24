'use client';

import Link from 'next/link';
import { UserRound, ChevronLeft } from 'lucide-react';
import AppProvider, { useApp } from '@/components/AppProvider';
import TopBar from '@/components/TopBar';
import CalendarLink from '@/components/CalendarLink';

/**
 * The account, as opposed to any of the trips on it.
 *
 * There was nowhere for this before: everything with a settings page was a
 * trip, so anything that belonged to the person rather than the plan ended up
 * filed under whichever trip they happened to be looking at. A calendar
 * connection is the clearest case — granted once, for good, and nothing to do
 * with the trip that was on screen when it was asked for.
 */
function Account() {
  const { user, displayName } = useApp();

  return (
    <div className="shell">
      <TopBar>
        <Link href="/trips" className="crumb-back" data-tip="All trips" aria-label="All trips">
          <ChevronLeft size={16} />
        </Link>
        <span className="crumb">Account</span>
      </TopBar>

      <main className="main main-plain">
        <div className="wrap">
          <div className="page-head">
            <h2>Account</h2>
            <div className="small muted">
              {displayName}{user && user.email ? ` · ${user.email}` : ''}
            </div>
          </div>

          <section className="card tset">
            <h3 className="tset-h"><UserRound size={15} aria-hidden="true" /> You</h3>
            <p className="tset-hint">
              Signed in as {user && user.email ? user.email : displayName}.
            </p>
          </section>

          <CalendarLink mode="account" />
        </div>
      </main>
    </div>
  );
}

export default function AccountPage() {
  return (
    <AppProvider>
      <Account />
    </AppProvider>
  );
}
