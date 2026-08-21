import {
  Mountain, UtensilsCrossed, TrainFront, Hotel, Ticket, ShoppingBag, Circle,
  CalendarDays, MapPin, Wallet, Backpack, NotebookPen, Settings,
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
  settings: Settings,
  // Old links land here; see LEGACY_TABS.
  people: Settings,
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
  // section nav: trip-level settings and who you are travelling with, not
  // another part of the plan you move between while editing one.
  { id: 'settings', label: 'Settings', offNav: true },
];

/** Settings used to be People; links people already shared still work. */
export const LEGACY_TABS = { people: 'settings' };

/** Everything the [tab] route will serve — the nav shows a subset. */
export const isTripTab = (t) => TRIP_TABS.some((x) => x.id === t) || !!LEGACY_TABS[t];

/** The tab a route segment actually means, following any old name. */
export const resolveTab = (t) => LEGACY_TABS[t] || t;

/** What the sidebar and the phone tab bar list. */
export const TRIP_NAV = TRIP_TABS.filter((t) => !t.offNav);
