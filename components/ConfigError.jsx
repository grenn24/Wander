'use client';
import { Plane } from 'lucide-react';

export default function ConfigError({ kind, fatal, missing, warning, apiUrl }) {
  // "Failed to fetch" means nothing answered at that URL — a different problem
  // from the API answering and refusing the sign-in.
  const unreachable = /failed to fetch|networkerror|load failed|fetch failed/i.test(fatal || '');

  return (
    <div className="gate">
      <div className="gate-card card">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true"><Plane size={17} /></span>
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
            <p className="small" style={{ marginTop: 0 }}>Could not start a guest session.</p>
            <p className="err" style={{ marginTop: 0 }}>{fatal}</p>
            {warning ? <p className="err" style={{ marginTop: 0 }}>{warning}</p> : null}
            {unreachable ? (
              <p className="small muted">
                Nothing answered at <code>{apiUrl}</code>. Start the Supabase stack with{' '}
                <code>npx supabase start</code>, or point <code>NEXT_PUBLIC_SUPABASE_URL</code> at
                a hosted project — then restart the dev server.
              </p>
            ) : (
              <p className="small muted">
                This usually means anonymous sign-ins are off. In Supabase go to{' '}
                <strong>Authentication → Sign In / Providers</strong> and enable{' '}
                <strong>Anonymous sign-ins</strong>, then reload. If you have not run{' '}
                <code>schema.sql</code> against the database yet, do that first.
              </p>
            )}
          </>
        )}

        <div className="chiprow">
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </div>
    </div>
  );
}
