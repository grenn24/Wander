'use client';
import { useEffect, useState } from 'react';
import { CalendarDays, Navigation } from 'lucide-react';
import { tripNow } from '@/public/trip-time';
export default function TodayButton({ trip, activities, onOpen }) {
  // Now, as the first paint is made: waiting a tick made the banner drop in
  // after the trip around it. Never on the server, whose clock is not yours.
  const [date, setDate] = useState(() => (typeof window === 'undefined' ? null : new Date()));
  useEffect(() => { setDate(new Date()); const t = setInterval(() => setDate(new Date()), 30000); return () => clearInterval(t); }, []);
  if (!trip || !date) return null;
  const state = tripNow(trip, activities, date);
  if (!state.live) return null;
  const lead = state.next || state.now;
  return <button className="today-entry" onClick={onOpen}>
    <CalendarDays size={22} aria-hidden="true" />
    <span><strong>Today</strong><span>{!trip.timezone ? 'Choose the destination time zone in trip settings' : lead ? `${state.next ? 'Up next' : 'Now'} · ${lead.start_time?.slice(0, 5) || ''} ${lead.title}` : 'Your day is clear'}</span></span>
    <span className="today-entry-action"><Navigation size={17} aria-hidden="true" /> View day & directions</span>
  </button>;
}
