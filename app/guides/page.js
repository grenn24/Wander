import GuidesBar from '@/components/GuidesBar';
import GuideBrowser from '@/components/GuideBrowser';
import { publishedSummaries } from '@/lib/guideStore';
import { fallbackCovers } from '@/lib/guidePhotos';

export const metadata = {
  title: 'Guides — Wander',
  description: 'Trips written like travel journals. Keep the places you like and Wander plans your version.',
};

// New guides from the guide service appear within six hours.
export const revalidate = 21600;

export default async function GuidesPage() {
  const summaries = await publishedSummaries();
  const covers = await fallbackCovers(summaries);
  const guides = summaries.map((s) => {
    const c = covers[s.slug];
    return { ...s, cover_ref: c ? c.ref : null, cover_author: c ? c.author : '' };
  });
  return (
    <div className="shell">
      <GuidesBar />
      <main className="main main-plain">
        <div className="wrap">
          <GuideBrowser guides={guides} />
        </div>
      </main>
    </div>
  );
}
