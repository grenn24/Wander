'use client';
import AppProvider from '@/components/AppProvider';

export default function GlobeLayout({ children }) {
  return <AppProvider>{children}</AppProvider>;
}
