import { userFromRequest, notSignedIn, serverConfigured } from '@/lib/supabaseServer';
import {
  saveConnection, connection, forget, revoke, calendarConfigured,
} from '@/lib/googleCal';

export const runtime = 'nodejs';

/**
 * Taking custody of the Google connection.
 *
 * Supabase hands the browser a `provider_refresh_token` at the moment the
 * OAuth redirect lands, and then never again — it does not keep them. So the
 * browser's one job is to pass it straight here, where it goes into a table no
 * JWT can read. Everything after that happens on the server.
 */
export async function POST(req) {
  if (!serverConfigured() || !calendarConfigured()) {
    return Response.json({
      error: 'Calendar connections are not configured on this server.',
      code: 'not_configured',
    }, { status: 503 });
  }

  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return Response.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const refresh = String(body.refresh_token || '');
  const access = String(body.access_token || '');
  const scope = String(body.scope || '').slice(0, 500);

  if (!refresh) {
    /*
     * Google issues a refresh token on the first consent and then stops,
     * unless asked with prompt=consent. Someone who has connected before and
     * is reconnecting will arrive with only an access token — which is fine if
     * we already hold their refresh token, and useless if we do not.
     */
    const held = await connection(user.id);
    if (!held) {
      return Response.json({
        error: 'Google did not send a lasting permission. Try connecting again.',
        code: 'no_refresh',
      }, { status: 400 });
    }
    if (access) {
      await saveConnection(user.id, {
        refresh_token: held.refresh_token,
        access_token: access,
        expires_at: new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString(),
        scope: scope || held.scope,
      });
    }
    return Response.json({ connected: true });
  }

  await saveConnection(user.id, {
    refresh_token: refresh,
    access_token: access || null,
    expires_at: access
      ? new Date(Date.now() + (Number(body.expires_in) || 3600) * 1000).toISOString()
      : null,
    scope,
  });

  return Response.json({ connected: true });
}

/** Disconnecting: our row goes, and Google is told to forget us as well. */
export async function DELETE(req) {
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  const held = await connection(user.id);
  await forget(user.id);
  await revoke(held && held.refresh_token);
  return Response.json({ connected: false });
}

/** Whether there is a connection, and what it is allowed to do. */
export async function GET(req) {
  if (!serverConfigured() || !calendarConfigured()) {
    return Response.json({ connected: false, available: false });
  }
  const user = await userFromRequest(req);
  if (!user) return notSignedIn();

  const held = await connection(user.id);
  return Response.json({
    available: true,
    connected: !!held,
    canWrite: !!held && String(held.scope || '').includes('calendar.events'),
    since: held ? held.updated_at : null,
  });
}
