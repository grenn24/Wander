'use client';
import AppProvider from '@/components/AppProvider';

export default function TripsLayout({ children }) {
  return <AppProvider>{children}</AppProvider>;
}
