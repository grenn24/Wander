# Wander — travel itinerary planner

Day-by-day trips with a map, budget, packing list, shared notes and live
multi-user editing. Next.js on Vercel, Supabase for data + auth + realtime.

## Configuration

The app reads its Supabase connection from two environment variables. There is
no in-app setup screen — if either is missing, the app shows an error page
naming what to set.

```
NEXT_PUBLIC_SUPABASE_URL       = http://127.0.0.1:54321      # the API endpoint
NEXT_PUBLIC_SUPABASE_ANON_KEY  = eyJhbGciOi...
```

`NEXT_PUBLIC_SUPABASE_URL` is the Supabase **HTTP API** endpoint, not a
`postgres://` connection string and not port 5432. The browser never speaks to
Postgres directly: PostgREST serves the queries, GoTrue issues the anonymous
guest sessions, and Realtime drives the live collaboration.

## Running locally

1. **Start the Supabase stack** — `npx supabase start`. It boots Postgres,
   PostgREST, GoTrue, Realtime and Studio in Docker, then prints an *API URL*
   and an *anon key*.
2. **Copy those into `.env.local`** (gitignored). `DATABASE_URL` is also in
   there for `psql` and migrations; the app itself does not read it.
3. **Run the schema** — apply `supabase/schema.sql` to the database, either via
   Studio's SQL editor or `psql "$DATABASE_URL" -f supabase/schema.sql`. Safe to
   re-run.
4. **Enable anonymous sign-ins.** The app has no login screen; every visitor
   gets a guest session automatically. Without this the app cannot start.
5. `npm run dev`.

Restart the dev server after editing `.env.local` — Next reads it at startup.

## Deploying

Set the same two variables in your host's environment (Vercel → Project →
Settings → Environment Variables), pointing at a hosted Supabase project rather
than localhost, and redeploy.

## Collaboration

There is no sign-in. Each visitor gets a Supabase **anonymous** session, which
is still a real `auth.uid()` — so row-level security, membership and presence
all work as normal.

Access is by **share link**. Every trip has a `share_code`; the People tab gives
you `?join=<code>`. Opening that URL calls `join_trip_by_code()`, which adds the
visitor as an editor. Treat the link like a password.

Two consequences worth knowing:

- A guest session lives in one browser's local storage. Clear site data or move
  to another device and you get a *new* guest — keep the share link to get back in.
- Anyone with the link can edit. There is no way to revoke a link short of the
  owner removing that member (they can rejoin with the same link).

## Security

Row-level security is on for every table. `SECURITY DEFINER` helpers
(`is_trip_member`, `is_trip_owner`) keep the trips ↔ members policies from
recursing. The anon key is a public client key by design; RLS is what protects
rows.

## Third-party services used from the browser

- OpenStreetMap tiles + Leaflet (unpkg CDN) for the map
- Nominatim for place search
