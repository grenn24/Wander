import JourneysBar from '@/components/JourneysBar';
import JourneyBrowser from '@/components/JourneyBrowser';
import { publishedSummaries } from '@/lib/journeyStore';
import { fallbackCovers } from '@/lib/journeyPhotos';

export const metadata = {
  title: 'Journeys — Wander',
  description: 'Trips written like travel journals. Keep the places you like and Wander plans your version.',
};

// New journeys from the journey service appear within six hours.
export const revalidate = 21600;

export default async function JourneysPage() {
  const summaries = await publishedSummaries();
  const covers = await fallbackCovers(summaries);
  const journeys = summaries.map((s) => {
    const c = covers[s.slug];
    return { ...s, cover_ref: c ? c.ref : null, cover_author: c ? c.author : '' };
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
