import { redirect } from 'next/navigation';

/** /trips/<id> has no meaning of its own — the itinerary is the trip's front door. */
export default async function TripIndex({ params }) {
  const { id } = await params;
  redirect(`/trips/${id}/itinerary`);
}
