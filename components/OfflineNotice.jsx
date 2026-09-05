'use client';
import { useEffect, useState } from 'react';
export default function OfflineNotice() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const read = () => setOffline(!navigator.onLine);
    read(); window.addEventListener('online', read); window.addEventListener('offline', read);
    return () => { window.removeEventListener('online', read); window.removeEventListener('offline', read); };
  }, []);
  return offline ? <div className="offline-notice" role="status">You’re offline. <a href="/offline.html">Open downloaded trips</a> to view your saved plans.</div> : null;
}
