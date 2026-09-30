'use client';
import ErrorScreen from '@/components/ErrorScreen';

// Without this, an error anywhere in a page — a chunk that would not load, say —
// unmounts the whole app and leaves Next's bare "Application error" message.
export default function AppError({ error, reset }) {
  return <ErrorScreen error={error} reset={reset} />;
}
