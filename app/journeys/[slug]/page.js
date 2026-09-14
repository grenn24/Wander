import { notFound } from 'next/navigation';
import JourneysBar from '@/components/JourneysBar';
import JourneyJournal from '@/components/JourneyJournal';
import { journeyDoc } from '@/lib/journeyStore';
import { heroFallback } from '@/lib/journeyPhotos';
import { imageURL } from '@/lib/journeyFormat';

export const revalidate = 21600;
// Rendered on first visit and kept, rather than at build: hundreds of journeys
// should not each be rendered by every deploy.
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = await journeyDoc(slug);
  if (!doc) return { title: 'Journey not found — Wander' };
  const cover = doc.cover && doc.cover.photo;
  return {
    title: `${doc.title} — Wander journeys`,
    description: doc.teaser,
    openGraph: cover ? { images: [{ url: imageURL(cover, 1200), width: 1200 }] } : undefined,
  };
}

export default async function JourneyPage({ params }) {
  const { slug } = await params;
  const doc = await journeyDoc(slug);
  if (!doc) notFound();
  const hero = await heroFallback(doc);
  return (
    <div className="shell">
      <JourneysBar />
      <main className="main main-plain">
        <div className="wrap">
          <JourneyJournal journey={doc} hero={hero} />
        </div>
      </main>
    </div>
  );
}
