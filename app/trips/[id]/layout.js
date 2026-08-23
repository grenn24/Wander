'use client';

import { use, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChevronLeft, Plus, Printer, Settings } from 'lucide-react';
import TripProvider, { useTrip } from '@/components/TripProvider';
import TopBar from '@/components/TopBar';
import PrintView from '@/components/PrintView';
import TripCommand from '@/components/TripCommand';
import TripSearch from '@/components/TripSearch';
import { TAB_ICONS, TRIP_NAV, isTripTab, resolveTab } from '@/lib/icons';

export default function TripLayout({ children, params }) {
  const { id } = use(params);
  return (
    <TripProvider tripId={id}>
      <TripChrome tripId={id}>{children}</TripChrome>
    </TripProvider>
  );
}

function TripChrome({ tripId, children }) {
  const { trip, online, ready, notFound, days, activities, packing, members } = useTrip();
  const pathname = usePathname();
  // Read the tab off the end of the path rather than by index — a leading or
  // trailing slash shifts the positions, which is what silently pinned this to
  // "itinerary" no matter which tab was open.
  const tabRef = useRef(null);

  /*
   * How much of the bottom edge the tab bar occupies.
   *
   * It is fixed, so it takes no space in the flow — which is exactly why
   * anything drawn full-height underneath it (the map) has to be told. Not its
   * height: it floats clear of the bottom by eight pixels plus whatever the
   * safe area adds, and a panel sitting on its height alone tucks under it by
   * that much. The distance from the bottom of the window to its top edge is
   * the number that is actually wanted, and it is zero on desktop where the
   * bar is not displayed at all.
   */
  useEffect(() => {
    const el = tabRef.current;
    const shell = el && el.closest('.shell');
    if (!el || !shell || typeof ResizeObserver === 'undefined') return undefined;
    const read = () => {
      const box = el.getBoundingClientRect();
      const used = box.height ? Math.max(0, Math.round(window.innerHeight - box.top)) : 0;
      shell.style.setProperty('--tabbar-h', `${used}px`);
    };
    const ro = new ResizeObserver(read);
    ro.observe(el);
    window.addEventListener('resize', read);
    return () => { ro.disconnect(); window.removeEventListener('resize', read); };
  }, []);

  const segments = pathname.split('/').filter(Boolean);
  const last = segments[segments.length - 1];
  const active = isTripTab(last) ? resolveTab(last) : 'itinerary';

  if (notFound) {
    return (
      <div className="shell">
        <TopBar />
        <main className="main main-plain">
          <div className="wrap">
            <div className="empty empty-lg">
              <p className="empty-title">Trip not found</p>
              <p className="small muted" style={{ marginTop: 0 }}>
                It may have been deleted, or you may no longer be a member. If someone shared it
                with you, open their link again to rejoin.
              </p>
              <Link className="btn primary" href="/trips">Back to your trips</Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      <div className="shell">
        <TopBar
          online={online}
          tools={<TripSearch />}
          menu={[
            { id: 'settings', label: 'Settings', icon: Settings, href: `/trips/${tripId}/settings` },
            { id: 'print', label: 'Print / PDF', icon: Printer, onClick: () => window.print() },
            { id: 'all', label: 'All trips', icon: Plus, href: '/trips' },
          ]}
        >
          {/* Back should undo the last step, not the last two: from a section
              that is where the trip came from, and only the trip itself leads
              out to the list. */}
          <Link
            href={active === 'itinerary' ? '/trips' : `/trips/${tripId}/itinerary`}
            className="crumb-back"
            title={active === 'itinerary' ? 'All your trips' : 'Back to the itinerary'}
            aria-label={active === 'itinerary' ? 'All trips' : 'Back to the itinerary'}
          >
            <ChevronLeft size={16} />
          </Link>
          {/* A shimmer the width of a trip name, rather than the word
              "Loading" sitting where the name will be. */}
          {trip ? (
            <span className="crumb" title={trip.name}>{trip.name}</span>
          ) : (
            <span className="crumb skel skel-crumb" aria-label="Loading trip" />
          )}
        </TopBar>

        <div className="body">
          <nav className="rail" aria-label="Trip sections">
            {TRIP_NAV.map((t) => {
              const Icon = TAB_ICONS[t.id];
              return (
                <Link key={t.id} href={`/trips/${tripId}/${t.id}`} aria-current={active === t.id}>
                  <span className="ico" aria-hidden="true"><Icon size={17} /></span>{t.label}
                </Link>
              );
            })}
            <div className="rail-spacer" />
            <button type="button" onClick={() => window.print()}>
              <span className="ico" aria-hidden="true"><Printer size={17} /></span>Print / PDF
            </button>
            <Link href="/trips">
              <span className="ico" aria-hidden="true"><Plus size={17} /></span>All trips
            </Link>
          </nav>

          <main className="main">
            <div className="wrap">
              {ready ? children : (
                <div aria-busy="true" aria-label="Loading trip">
                  <div className="skel skel-head" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                  <div className="skel skel-row" />
                </div>
              )}
            </div>
          </main>
        </div>

        <TripCommand />

        <nav className="tabbar" ref={tabRef} aria-label="Trip sections">
          {TRIP_NAV.map((t) => {
            const Icon = TAB_ICONS[t.id];
            return (
              <Link key={t.id} href={`/trips/${tripId}/${t.id}`} aria-current={active === t.id}>
                <span className="ico" aria-hidden="true"><Icon size={18} /></span>{t.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <PrintView trip={trip} days={days} activities={activities}
        packing={packing} members={members} />
    </>
  );
}
