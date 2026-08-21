import {
  Mountain, UtensilsCrossed, TrainFront, Hotel, Ticket, ShoppingBag, Circle,
  CalendarDays, MapPin, Wallet, Backpack, NotebookPen, Users,
} from 'lucide-react';

/** Activity types. Keys match CATEGORIES ids in lib/util.js. */
export const CATEGORY_ICONS = {
  sightseeing: Mountain,
  food: UtensilsCrossed,
  transport: TrainFront,
  lodging: Hotel,
  activity: Ticket,
  shopping: ShoppingBag,
  other: Circle,
};

export function categoryIcon(id) {
  return CATEGORY_ICONS[id] || CATEGORY_ICONS.other;
}

/** The trip workspace tabs. Keys match the [tab] route segment. */
export const TAB_ICONS = {
  itinerary: CalendarDays,
  map: MapPin,
  budget: Wallet,
  packing: Backpack,
  notes: NotebookPen,
  people: Users,
};

/**
 * These sections only exist inside a trip — they are meaningless without one,
 * which is why they live here and not in any global navigation.
 */
export const TRIP_TABS = [
  { id: 'itinerary', label: 'Itinerary' },
  { id: 'map', label: 'Map' },
  { id: 'budget', label: 'Budget' },
  { id: 'packing', label: 'Packing' },
  { id: 'notes', label: 'Notes' },
  { id: 'people', label: 'People' },
];

export const isTripTab = (t) => TRIP_TABS.some((x) => x.id === t);
