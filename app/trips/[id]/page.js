import { redirect } from 'next/navigation';
import { tripHome } from '@/lib/icons';

/** /trips/<id> has no meaning of its own — the Assistant is the trip's front door. */
export default async function TripIndex({ params }) {
  const { id } = await params;
  redirect(tripHome(id));
}
