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

### Maps and photos (optional)

```
NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY = ...   # Maps JavaScript API  (browser)
PLACES_API_KEY                      = ...   # Places API (New)     (server)
GEOCODING_API_KEY                   = ...   # Geocoding API        (server, optional)
```

Each is named after the Google Cloud API it belongs to, so it is obvious which
console entry a value came from. `GEOCODING_API_KEY` falls back to
`PLACES_API_KEY`, so two keys are enough unless you want one restricted per API.

Note that **Places API** and **Places API (New)** are different products in the
console. This app uses the New one.

Two keys, because they have different exposure. The Maps JS key **must** reach
the browser, so it is public by design — restrict it in Google Cloud Console by
HTTP referrer and to the Maps JavaScript API alone. The server key does
geocoding and photo fetches, where referrer restrictions cannot protect
anything; restrict it by API instead and never give it a `NEXT_PUBLIC_` prefix.

There is no fallback provider. Without these keys the map is replaced by a
panel naming exactly what to set, stops are not located, and nearby search is
disabled — one source keeps geocoding, the map and nearby results consistent
with each other, and makes a missing key an obvious configuration problem
rather than a quietly degraded experience.

Enable **Maps JavaScript API**, **Places API (New)** and **Geocoding API** on
the keys, with billing active. Text search, nearby search and photos all bill
per request, so `lib/places.js` asks for the narrowest field mask that works
and stores each place's id and photo handle to avoid looking it up twice.

### If server-side lookups fail locally

`npm run dev` runs Node with `--use-system-ca`. Without it, on a machine that
intercepts HTTPS (corporate proxy, some antivirus), every server-side call
fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, because Node does not read the OS
certificate store by default. `npm run dev:plain` is the unmodified command if
you ever need it.

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

## Third-party services

- **Google Maps** draws the map in the browser, using the public
  `NEXT_PUBLIC_MAPS_JAVASCRIPT_API_KEY`.
- **Google Places** does geocoding, nearby search and photos, always through
  `/api/places/*` so `PLACES_API_KEY` never leaves the server.
- **OpenAI** plans trips, suggests activities and builds packing lists, through
  `/api/plan`, `/api/suggest` and `/api/packing`.

Without the Google keys the map is replaced by a panel naming what to set, and
stops are not located. Without the OpenAI key the planning features return a
503 the UI explains. Everything else works regardless.
