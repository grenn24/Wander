import { JOURNEYS, journeySummary } from '@/lib/journeys';
import { coverPhotos } from '@/lib/journeyPhotos';

export const runtime = 'nodejs';
export const revalidate = 86400;

/**
 * The catalogue without its prose, for the pieces of the app that only need a
 * card: the rail under the trip planner and the ideas on the globe.
 */
export async function GET() {
  const covers = await coverPhotos(JOURNEYS);
  const journeys = JOURNEYS.map((j) => {
    const { search, ...card } = journeySummary(j);
    const c = covers[j.slug];
    return { ...card, cover_ref: c ? c.ref : null, cover_author: c ? c.author : '' };
  });
  return Response.json({ journeys }, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=86400' },
  });
}
