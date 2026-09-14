import { publishedSummaries } from '@/lib/journeyStore';
import { fallbackCovers } from '@/lib/journeyPhotos';

export const runtime = 'nodejs';
export const revalidate = 21600;

/**
 * The catalogue without its prose, for the pieces of the app that only need a
 * card: the rail under the trip planner and the ideas on the globe.
 */
export async function GET() {
  const summaries = await publishedSummaries();
  const covers = await fallbackCovers(summaries);
  const journeys = summaries.map(({ search, ...card }) => {
    const c = covers[card.slug];
    return { ...card, cover_ref: c ? c.ref : null, cover_author: c ? c.author : '' };
  });
  return Response.json({ journeys }, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=21600' },
  });
}
