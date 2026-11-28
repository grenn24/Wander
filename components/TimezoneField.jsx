'use client';
import { useMemo, useState } from 'react';
import Select from '@/components/Select';

// Current GMT offset for a zone, e.g. "GMT+1" or "GMT+5:30" (UTC reads "GMT").
function gmtOffset(zone, at) {
  try {
    const part = new Intl.DateTimeFormat('en-GB', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part ? part.value : '';
  } catch { return ''; }
}

export default function TimezoneField({ id, label = 'Destination time zone', value = '', onChange }) {
  const [search, setSearch] = useState('');
  const zones = useMemo(() => [...new Set(['UTC', value,
    ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York']),
  ].filter(Boolean))].sort(), [value]);
  const labelled = useMemo(() => {
    const now = new Date();
    return zones.map((z) => {
      const offset = gmtOffset(z, now);
      return { value: z, label: offset ? `${z.replaceAll('_', ' ')} (${offset})` : z.replaceAll('_', ' ') };
    });
  }, [zones]);
  const q = search.trim().toLowerCase();
  const options = [{ value: '', label: 'Choose a time zone' }, ...labelled
    .filter((o) => o.value === value || o.label.toLowerCase().includes(q))];
  return <div className="field">
    <label className="label" htmlFor={id}>{label}</label>
    <input className="input" aria-label={`Filter ${label.toLowerCase()}`} placeholder="Search city, region or GMT offset"
      value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 6 }} />
    <Select id={id} label={label} value={value || ''} onChange={onChange} options={options} />
  </div>;
}
