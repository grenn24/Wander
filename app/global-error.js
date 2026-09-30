'use client';
import { useEffect } from 'react';
import { isChunkError, reloadOnce } from '@/lib/chunkRetry';

// The last resort, for an error in the root layout itself. It replaces the
// layout, so it brings its own document and cannot lean on the app's styles.
export default function GlobalError({ error }) {
  const chunk = isChunkError(error);

  useEffect(() => {
    if (chunk) reloadOnce();
  }, [chunk]);

  return (
    <html lang="en">
      <body style={{
        margin: 0, minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: '24px 18px',
        fontFamily: 'system-ui, sans-serif', background: '#f7f4ee', color: '#201d18',
      }}>
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: 21, margin: '0 0 8px' }}>Wander</h1>
          <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
            {chunk
              ? 'Part of this page did not load. Check your connection, then reload. Your plans are still saved.'
              : 'Something went wrong. Reload to try again. Your plans are still saved.'}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              font: 'inherit', padding: '8px 16px', borderRadius: 8, border: 0,
              background: '#201d18', color: '#f7f4ee', cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
