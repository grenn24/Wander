'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import AppProvider, { useApp } from '@/components/AppProvider';
import { humanError } from '@/lib/util';

export default function JoinPage({ params }) {
  const { code } = use(params);
  return (
    <AppProvider>
      <Joiner code={code} />
    </AppProvider>
  );
}

function Joiner({ code }) {
  const { supabase, pushToast } = useApp();
  const router = useRouter();
  const [error, setError] = useState('');
  const done = useRef(false);

  useEffect(() => {
    if (!supabase || done.current) return;
    done.current = true;
    (async () => {
      const { data, error: err } = await supabase.rpc('join_trip_by_code', { p_code: code });
      if (err) { setError(humanError(err)); return; }
      pushToast('You are in — this trip is now on your list.');
      router.replace(`/trips/${data}/itinerary`);
    })();
  }, [supabase, code, router, pushToast]);

  if (error) {
    return (
      <div className="gate">
        <div className="gate-card card">
          <h1 style={{ fontSize: 19, marginBottom: 8 }}>That link did not work</h1>
          <p className="err" style={{ marginTop: 0 }}>{error}</p>
          <p className="small muted">
            Share links can stop working if the trip was deleted. Ask whoever sent it for a fresh
            one from the trip&apos;s People tab.
          </p>
          <Link className="btn primary" href="/trips">Go to your trips</Link>
        </div>
      </div>
    );
  }

  return <div className="gate"><div className="muted">Joining trip</div></div>;
}
