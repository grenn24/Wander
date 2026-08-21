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
  // A real tab with a real route, reached from the top bar rather than the
  // section nav: it is about who you are travelling with, not another part of
  // the plan you move between while editing one.
  { id: 'people', label: 'People', offNav: true },
];

/** Everything the [tab] route will serve — the nav shows a subset. */
export const isTripTab = (t) => TRIP_TABS.some((x) => x.id === t);

/** What the sidebar and the phone tab bar list. */
export const TRIP_NAV = TRIP_TABS.filter((t) => !t.offNav);
