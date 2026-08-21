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

### AI planning (optional)

```
OPENAI_API_KEY   = sk-...
OPENAI_MODEL     = gpt-5-mini      # optional
```

Note the missing `NEXT_PUBLIC_` prefix: unlike the Supabase anon key, this is a
real secret. It is read only by the route handlers in `app/api/`, and the
browser calls those rather than OpenAI. Never add the prefix — it would inline
the key into the client bundle for every visitor.

Without it the app works exactly as before; the planning features return a 503
that the UI explains, and every screen stays usable by hand.

## Running locally

Local development points at the hosted Supabase project — there is no local
stack and no Docker. A plain local Postgres will not work: `schema.sql` has
foreign keys into `auth.users` and 14 uses of `auth.uid()`, both of which come
from Supabase's auth service, and the browser needs PostgREST, GoTrue and
Realtime rather than a database port.

1. **Copy the credentials into `.env.local`** (gitignored) — Supabase dashboard
   → Project Settings → API gives you the *Project URL* and the *anon public*
   key. `DATABASE_URL` is there too, for `psql`; the app does not read it.
2. **Run the schema** — apply `supabase/schema.sql`, either in the dashboard's
   SQL Editor or with `psql "$DATABASE_URL" -f supabase/schema.sql`. Safe to
   re-run.
3. **Enable anonymous sign-ins** — Authentication → Sign In / Providers. The app
   has no login screen; every visitor gets a guest session automatically.
   Without this the app cannot start.
4. `npm run dev`.

Restart the dev server after editing `.env.local` — Next reads it at startup.

> Local dev therefore reads and writes **production data**. Every browser that
> loads the app creates a real anonymous user in `auth.users`, and test trips
> are real trips. Point `.env.local` at a second, free Supabase project when you
> want that separation.

## Authentication

There is no login screen. Supabase's auth service (GoTrue) owns the `auth`
schema, and `signInAnonymously()` creates a real row in `auth.users` with no
email attached, returning a JWT.

That JWT rides along on every request. PostgREST validates it and sets the
session so `auth.uid()` returns the user's id, which is what every row-level
security policy checks. So the anon key only says "this is the app"; the JWT
says "and this is who is asking".

The display name lives in `raw_user_meta_data.display_name` on the user row,
written by `updateUser()` and read back by the `my_display_name()` helper.

A session lives in one browser's local storage. Clearing site data, or opening
another browser, triggers a fresh anonymous sign-up — a *different* user with no
trips. The share link is the only way back into an existing trip.

## Deploying

Set the same two variables in your host's environment (Vercel → Project →
Settings → Environment Variables), pointing at a hosted Supabase project rather
than localhost, and redeploy.

## Collaboration

Access is by **share link**. Every trip has a `share_code`; the People tab gives
you `?join=<code>`. Opening that URL calls `join_trip_by_code()`, which adds the
visitor as an editor. Treat the link like a password: anyone holding it can
edit, and there is no way to revoke one short of the owner removing that member
— who can then rejoin with the same link.

Because an anonymous session is still a real `auth.uid()`, row-level security,
membership and presence all work exactly as they would with real accounts.

## Security

Row-level security is on for every table. `SECURITY DEFINER` helpers
(`is_trip_member`, `is_trip_owner`) keep the trips ↔ members policies from
recursing. The anon key is a public client key by design; RLS is what protects
rows.

## Third-party services used from the browser

- OpenStreetMap tiles + Leaflet (unpkg CDN) for the map
- Nominatim for place search
