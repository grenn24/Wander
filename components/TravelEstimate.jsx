import { Footprints, TrainFront, TriangleAlert } from 'lucide-react';
import { fmtKm, walkMinutes } from '@/lib/geo';

/** Shared wording and thresholds keep the itinerary and map in agreement. */
export default function TravelEstimate({ km }) {
  const Icon = km > 60 ? TriangleAlert : km > 5 ? TrainFront : Footprints;
  return <>
    <Icon size={15} aria-hidden="true" />
    <div className="map-leg-detail">
      <strong>≈ {fmtKm(km)}</strong>
      <span>{km > 60 ? 'Long transfer · check travel time'
        : km > 5 ? 'Consider public transport or a taxi'
          : `About ${Math.max(1, walkMinutes(km))} min walk`}</span>
    </div>
  </>;
}
