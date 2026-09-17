import { journeyDoc } from '@/lib/journeyStore';
import { routeOf, sectionsOf } from '@/lib/journeyMap';

export const runtime = 'nodejs';
export const revalidate = 21600;

/**
 * A journey's stops in the order the journal visits them, for the globe to
 * draw as a route: each stop's name and position, its Google place ID for a
 * photograph to be looked up when it is opened, and which of the journal's
 * sections it belongs to, with those sections' names. The rest of the journal
 * stays on its own page.
 */
export async function GET(req, { params }) {
  const { slug } = await params;
  const doc = await journeyDoc(slug);
  if (!doc) return Response.json({ error: 'No such journey.' }, { status: 404 });
  const round = (v) => Math.round(v * 1e5) / 1e5; // about a metre
  const stops = routeOf(doc).map((s, i) => ({
    n: i + 1, name: s.name, lat: round(s.lat), lng: round(s.lng), section: s.section, place_id: s.place_id,
  }));
  const sections = sectionsOf(doc.blocks).map((s) => ({ kicker: s.kicker, title: s.title }));
  return Response.json({ slug, stops, sections }, {
    headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=21600' },
  });
}
