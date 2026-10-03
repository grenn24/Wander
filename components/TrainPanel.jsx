'use client';
import { useState } from 'react';
import TrainOptions from '@/components/TrainOptions';
import Departures from '@/components/Departures';

/**
 * A hop's train options, and a train's departures when its step is tapped:
 * one panel that turns from the one to the other and back, wherever it is
 * shown — the trip map's side panel, the itinerary's sheet, directions.
 *
 *   ends     the hop's two ends, { from, to } as { lat, lng }
 *   date     the hop's day, YYYY-MM-DD, for the departures' timetable
 *   leaveAt  the minute you leave, for the departures to start from
 *   live     the day is today
 *
 * Everything else is TrainOptions'.
 */
export default function TrainPanel({ ends, date, leaveAt, live = false, ...options }) {
  const [leg, setLeg] = useState(null); // { option, ride }
  if (leg) {
    return (
      <Departures option={leg.option} ride={leg.ride} from={ends.from} to={ends.to}
        toName={options.to} date={date} leaveAt={leaveAt} live={live}
        onBack={() => setLeg(null)} />
    );
  }
  return (
    <TrainOptions {...options}
      onLeg={ends ? (option, index) => setLeg({
        option,
        ride: option.legs.slice(0, index).filter((l) => l.kind === 'ride').length,
      }) : null} />
  );
}
