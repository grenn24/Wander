import { notFound } from 'next/navigation';
import JourneysBar from '@/components/JourneysBar';
import JourneyJournal from '@/components/JourneyJournal';
import { journeyBySlug } from '@/lib/journeys';
import { journeyPhotos } from '@/lib/journeyPhotos';

export const revalidate = 86400;
// Rendered on first visit and kept, rather than at build: a build should not
// spend a hundred place lookups on pages nobody has opened yet.
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const j = journeyBySlug(slug);
  if (!j) return { title: 'Journey not found — Wander' };
  return { title: `${j.title} — Wander journeys`, description: j.teaser };
}

export default async function JourneyPage({ params }) {
  const { slug } = await params;
  const journey = journeyBySlug(slug);
  if (!journey) notFound();
  const photos = await journeyPhotos(journey);
  return (
    <div className="shell">
      <JourneysBar />
      <main className="main main-plain">
        <div className="wrap">
          <JourneyJournal journey={journey} photos={photos} />
        </div>
      </main>
    </div>
  );
}
