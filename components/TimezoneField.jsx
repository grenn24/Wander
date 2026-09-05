'use client';
import { useMemo, useState } from 'react';
import Select from '@/components/Select';

export default function TimezoneField({ id, label = 'Destination time zone', value = '', onChange }) {
  const [search, setSearch] = useState('');
  const zones = useMemo(() => [...new Set(['UTC', value,
    ...(Intl.supportedValuesOf ? Intl.supportedValuesOf('timeZone') : ['Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'America/New_York']),
  ].filter(Boolean))].sort(), [value]);
  const options = [{ value: '', label: 'Choose a time zone' }, ...zones
    .filter((z) => z === value || z.replaceAll('_', ' ').toLowerCase().includes(search.toLowerCase()))
    .map((z) => ({ value: z, label: z.replaceAll('_', ' ') }))];
  return <div className="field">
    <label className="label" htmlFor={id}>{label}</label>
    <input className="input" aria-label={`Filter ${label.toLowerCase()}`} placeholder="Search city or region"
      value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 6 }} />
    <Select id={id} label={label} value={value || ''} onChange={onChange} options={options} />
  </div>;
}
