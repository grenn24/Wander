import { Plane, TrainFront, Bus, Ship, Car, MoveRight } from 'lucide-react';

/**
 * Transport is a parent type, not a leaf.
 *
 * "Transport" told you an activity involved moving and nothing else — not which
 * airport, which terminal, which gate, which seat. Those are exactly the things
 * you look up while standing in a departure hall with a bag, and they were
 * going into the notes field as prose if they were recorded at all.
 *
 * A flight and a bus ride share almost nothing, so rather than one form with
 * every field on it, each mode declares what it actually has. Adding a mode is
 * a row in this table; nothing else has to know.
 *
 * `where` marks the two fields that name the ends of the journey — the row on
 * the itinerary reads those as "SIN → HND" without knowing what kind of
 * transport it is looking at.
 */
export const TRANSPORT = [
  {
    id: 'flight',
    label: 'Flight',
    icon: Plane,
    fields: [
      { k: 'carrier', label: 'Airline', ph: 'JAL' },
      { k: 'code', label: 'Flight', ph: 'JL712' },
      { k: 'from', label: 'From', ph: 'SIN', where: 'start' },
      { k: 'to', label: 'To', ph: 'HND', where: 'end' },
      { k: 'from_terminal', label: 'Departure terminal', ph: '3' },
      { k: 'gate', label: 'Gate', ph: 'B7' },
      { k: 'to_terminal', label: 'Arrival terminal', ph: '2' },
      { k: 'seat', label: 'Seat', ph: '32A' },
    ],
  },
  {
    id: 'train',
    label: 'Train',
    icon: TrainFront,
    fields: [
      { k: 'carrier', label: 'Line', ph: 'Tokaido Shinkansen' },
      { k: 'code', label: 'Service', ph: 'Hikari 503' },
      { k: 'from', label: 'From', ph: 'Tokyo', where: 'start' },
      { k: 'to', label: 'To', ph: 'Kyoto', where: 'end' },
      { k: 'platform', label: 'Platform', ph: '14' },
      { k: 'car', label: 'Car', ph: '7' },
      { k: 'seat', label: 'Seat', ph: '11D' },
    ],
  },
  {
    id: 'bus',
    label: 'Bus or coach',
    icon: Bus,
    fields: [
      { k: 'carrier', label: 'Operator', ph: 'Willer Express' },
      { k: 'code', label: 'Service', ph: 'WE204' },
      { k: 'from', label: 'From', ph: 'Shinjuku', where: 'start' },
      { k: 'to', label: 'To', ph: 'Osaka', where: 'end' },
      { k: 'bay', label: 'Stand or bay', ph: 'C4' },
      { k: 'seat', label: 'Seat', ph: '2A' },
    ],
  },
  {
    id: 'ferry',
    label: 'Ferry or boat',
    icon: Ship,
    fields: [
      { k: 'carrier', label: 'Operator', ph: 'Hakone Sightseeing Cruise' },
      { k: 'from', label: 'From', ph: 'Togendai', where: 'start' },
      { k: 'to', label: 'To', ph: 'Motohakone', where: 'end' },
      { k: 'pier', label: 'Pier', ph: '2' },
      { k: 'seat', label: 'Seat or deck', ph: 'Upper' },
    ],
  },
  {
    id: 'car',
    label: 'Car or taxi',
    icon: Car,
    fields: [
      { k: 'carrier', label: 'Company', ph: 'Toyota Rent a Car' },
      { k: 'from', label: 'Pick up', ph: 'Haneda Airport', where: 'start' },
      { k: 'to', label: 'Drop off', ph: 'Hakone', where: 'end' },
      { k: 'code', label: 'Reference', ph: 'RC-88213' },
    ],
  },
  {
    id: 'transfer',
    label: 'Transfer or walk',
    icon: MoveRight,
    fields: [
      { k: 'from', label: 'From', ph: 'Hotel', where: 'start' },
      { k: 'to', label: 'To', ph: 'Station', where: 'end' },
    ],
  },
];

export function transportOf(id) {
  return TRANSPORT.find((t) => t.id === id) || null;
}

/** The icon for an activity, which for transport depends on how it travels. */
export function transportIcon(subtype) {
  const t = transportOf(subtype);
  return t ? t.icon : null;
}

/**
 * The one line a transport activity is worth on a busy day.
 *
 * Whatever identifies the service, then the two ends of the journey, then the
 * thing you will actually be hunting for on a departure board. Anything absent
 * is simply left out rather than labelled and left blank.
 */
export function transportLine(subtype, details) {
  const mode = transportOf(subtype);
  const d = details || {};
  if (!mode) return '';

  const bits = [];
  if (d.code) bits.push(d.code);
  else if (d.carrier) bits.push(d.carrier);

  const start = mode.fields.find((f) => f.where === 'start');
  const end = mode.fields.find((f) => f.where === 'end');
  const a = start && d[start.k];
  const b = end && d[end.k];
  if (a && b) bits.push(`${a} → ${b}`);
  else if (a || b) bits.push(a || b);

  if (d.gate) bits.push(`Gate ${d.gate}`);
  else if (d.platform) bits.push(`Plat. ${d.platform}`);
  else if (d.bay) bits.push(`Bay ${d.bay}`);
  else if (d.pier) bits.push(`Pier ${d.pier}`);

  if (d.seat) bits.push(`Seat ${d.seat}`);

  return bits.join(' · ');
}
