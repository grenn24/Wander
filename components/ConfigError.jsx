'use client';
import BrandMark from '@/components/BrandMark';

export default function ConfigError({ kind, fatal, missing, onRetry }) {
  // "Failed to fetch" means nothing answered at that URL — a different problem
  // from the API answering and refusing the sign-in.
  const unreachable = /failed to fetch|networkerror|load failed|fetch failed/i.test(fatal || '');

  return (
    <div className="gate">
      <div className="gate-card card">
        <div className="brand">
          <BrandMark />
          <h1>Wander</h1>
        </div>

        {kind === 'config' ? (
          <>
            <p className="small" style={{ marginTop: 0 }}>This app is not configured yet.</p>
            <p className="err" style={{ marginTop: 0 }}>
              {missing.length === 1 ? `Missing ${missing[0]}.` : `Missing ${missing.join(' and ')}.`}
            </p>
            <p className="small muted">
              Set {missing.length > 1 ? 'them' : 'it'} in <code>.env.local</code> when running
              locally, or in your host&apos;s environment variables when deployed, then restart
              the server.
            </p>
            <p className="small muted">
              The URL is the Supabase <strong>API</strong> endpoint — <code>http://…</code>, not a{' '}
              <code>postgres://</code> connection string. <code>npx supabase start</code> prints
              both values.
            </p>
          </>
        ) : (
          <>
            <p className="small" style={{ marginTop: 0 }}>Could not restore your sign-in.</p>
            <p className="err" style={{ marginTop: 0 }}>{fatal}</p>
            {unreachable ? (
              <p className="small muted">
                Check your connection, then try again. Your plans are still saved.
              </p>
            ) : (
              <p className="small muted">
                Try again to reconnect. If your sign-in has ended, we’ll ask you to sign in again.
              </p>
            )}
          </>
        )}

        <div className="chiprow">
          <button className="btn primary" onClick={kind === 'session' && onRetry ? onRetry : () => window.location.reload()}>
            {kind === 'session' ? 'Try again' : 'Reload'}
          </button>
        </div>
      </div>
    </div>
  );
}
