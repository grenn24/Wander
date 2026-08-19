# Wander — travel itinerary planner

Day-by-day trips with a map, budget, packing list, shared notes and live
multi-user editing. Next.js on Vercel, Supabase for data + auth + realtime.

## Setup (5 minutes)

1. **Create a Supabase project** — https://supabase.com/dashboard → *New project* (free tier is fine).
2. **Run the schema** — Supabase → *SQL Editor* → *New query* → paste all of
   `supabase/schema.sql` → *Run*. It is safe to re-run.
3. **Enable anonymous sign-ins** — Supabase → *Authentication* → *Sign In / Providers*
   → turn on **Anonymous sign-ins**. The app has no login screen; every visitor
   gets a guest session automatically. Without this the app cannot start.
4. **Connect the app** — open the deployed URL. The setup screen asks for your
   *Project URL* and *anon public* key (Supabase → Project Settings → API).
   These are stored in your browser only.

### Optional: skip the setup screen for everyone

In Vercel → Project → Settings → Environment Variables, add:

```
NEXT_PUBLIC_SUPABASE_URL   = https://xxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = eyJhbGciOi...
```

Redeploy. The app then uses those and never shows the setup screen — better for
collaborators.

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
