/** Describe work actually underway; waiting for a traveller is not progress. */
export function planningProgress({ phase, awaitingAnswers = false, pictureCount = 0, days = [], expected = 0 }) {
  const count = days.reduce((sum, day) => sum + day.activities.length, 0);
  const activities = `${count} activit${count === 1 ? 'y' : 'ies'}`;
  switch (phase) {
    case 'start': return 'Getting ready to plan your trip';
    case 'reading': return `Reading your picture${pictureCount === 1 ? '' : 's'}`;
    case 'clarifying': return awaitingAnswers ? null : 'Checking the details that shape your trip';
    case 'streaming': return days.length
      ? `Day ${days[days.length - 1].index}${expected ? ` of ${expected}` : ''} · ${activities} drafted`
      : 'Building your itinerary';
    case 'locating': return `Finding ${count} stop${count === 1 ? '' : 's'} on the map`;
    case 'saving': return `Saving your trip with ${activities}`;
    default: return null;
  }
}
