const ARTWORK = {
  journey: '/artwork/journey.webp',
  trips: '/artwork/trips.webp',
  packing: '/artwork/packing.webp',
  places: '/artwork/places.webp',
};

// These drawings support nearby copy; they never carry information or actions.
export default function TravelArt({ kind, className = '' }) {
  if (!ARTWORK[kind]) return null;
  return <img className={`travel-art ${className}`} src={ARTWORK[kind]}
    width={640} height={430} alt="" aria-hidden="true"
    loading="lazy" decoding="async" draggable={false} />;
}
