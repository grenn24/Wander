'use client';
import { useEffect } from 'react';
import BrandMark from '@/components/BrandMark';
import { isChunkError, reloadOnce } from '@/lib/chunkRetry';

/**
 * What a page shows when something under it threw while rendering.
 *
 * This sits above the app's providers, so it takes nothing from them. A chunk
 * that would not load is put right by a reload (React keeps the failed import
 * and would fail the same way on a retry), so that is tried once by itself; if
 * it fails again the person gets the button.
 */
export default function ErrorScreen({ error, reset }) {
  const chunk = isChunkError(error);

  useEffect(() => {
    if (chunk) reloadOnce();
  }, [chunk]);

  return (
    <div className="gate">
      <div className="gate-card card">
        <div className="brand">
          <BrandMark />
          <h1>Wander</h1>
        </div>
        {chunk ? (
          <>
            <p className="small" style={{ marginTop: 0 }}>Part of this page did not load.</p>
            <p className="small muted">
              Check your connection, then reload. Your plans are still saved.
            </p>
          </>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}>Something went wrong on this page.</p>
            <p className="small muted">
              Try again, or reload. Your plans are still saved.
            </p>
          </>
        )}
        <div className="chiprow">
          {!chunk && reset && (
            <button className="btn primary" onClick={() => reset()}>Try again</button>
          )}
          <button className={`btn${chunk ? ' primary' : ''}`} onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
