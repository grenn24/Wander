'use client';

import { use } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronLeft, Plus, Printer, Settings } from 'lucide-react';
import TripProvider, { useTrip } from '@/components/TripProvider';
import TopBar from '@/components/TopBar';
import PrintView from '@/components/PrintView';
import { TAB_ICONS, TRIP_TABS } from '@/lib/icons';

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
  const router = useRouter();
  const active = pathname.split('/')[4] || 'itinerary';

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
        <TopBar online={online} onOpenProfile={() => router.push(`/trips/${tripId}/people`)}>
          <Link href="/trips" className="crumb-back" aria-label="All trips">
            <ChevronLeft size={16} />
          </Link>
          <span className="crumb" title={trip ? trip.name : ''}>
            {trip ? trip.name : 'Loading…'}
          </span>
        </TopBar>

        <div className="body">
          <nav className="rail" aria-label="Trip sections">
            {TRIP_TABS.map((t) => {
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

        <nav className="tabbar" aria-label="Trip sections">
          {TRIP_TABS.map((t) => {
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
