import { notFound } from 'next/navigation';
import GuidesBar from '@/components/GuidesBar';
import GuideJournal from '@/components/GuideJournal';
import { guideDoc } from '@/lib/guideStore';
import { heroFallback } from '@/lib/guidePhotos';
import { imageURL } from '@/lib/guideFormat';

export const revalidate = 21600;
// Rendered on first visit and kept, rather than at build: hundreds of guides
// should not each be rendered by every deploy.
export const dynamicParams = true;
export function generateStaticParams() { return []; }

export async function generateMetadata({ params }) {
  const { slug } = await params;
  const doc = await guideDoc(slug);
  if (!doc) return { title: 'Guide not found — Wander' };
  const cover = doc.cover && doc.cover.photo;
  return {
    title: `${doc.title} — Wander guides`,
    description: doc.teaser,
    openGraph: cover ? { images: [{ url: imageURL(cover, 1200), width: 1200 }] } : undefined,
  };
}

export default async function GuidePage({ params }) {
  const { slug } = await params;
  const doc = await guideDoc(slug);
  if (!doc) notFound();
  const hero = await heroFallback(doc);
  return (
    <div className="shell">
      <GuidesBar />
      <main className="main main-plain">
        <div className="wrap">
          <GuideJournal guide={doc} hero={hero} />
        </div>
      </main>
    </div>
  );
}
