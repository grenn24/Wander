import { activityTimes, nextDate } from '../public/trip-time.js';

export function calendarEvent(a, zone) {
  const times = a.start_time ? activityTimes(a, zone) : null;
  return {
    summary: String(a.title || 'Untitled').slice(0, 300),
    location: a.location ? String(a.location).slice(0, 400) : undefined,
    description: [a.notes, a.booking_ref ? `Booking: ${a.booking_ref}` : '', 'Planned in Wander'].filter(Boolean).join('\n\n').slice(0, 2000),
    start: times ? { dateTime: new Date(times.start).toISOString(), timeZone: times.startZone } : { date: a.day },
    end: times ? { dateTime: new Date(times.end).toISOString(), timeZone: times.endZone } : { date: nextDate(a.day) },
  };
}
