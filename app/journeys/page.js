import JourneysBar from '@/components/JourneysBar';
import JourneyBrowser from '@/components/JourneyBrowser';
import { JOURNEYS, journeySummary } from '@/lib/journeys';
import { coverPhotos } from '@/lib/journeyPhotos';

export const metadata = {
  title: 'Journeys — Wander',
  description: 'Trips written like travel journals. Keep the moments you like and Wander plans your version.',
};

// The page re-renders daily; the photographs behind it are cached for a week.
export const revalidate = 86400;

export default async function JourneysPage() {
  const covers = await coverPhotos(JOURNEYS);
  const journeys = JOURNEYS.map((j) => {
    const c = covers[j.slug];
    return { ...journeySummary(j), cover_ref: c ? c.ref : null, cover_author: c ? c.author : '' };
  });
  return (
    <div className="shell">
      <JourneysBar />
      <main className="main main-plain">
        <div className="wrap">
          <JourneyBrowser journeys={journeys} />
        </div>
      </main>
    </div>
  );
}
