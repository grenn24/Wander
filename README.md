# Wander — travel itinerary planner

Day-by-day trips with a map, budget, packing list, shared notes and live
multi-user editing. Next.js on Vercel, Supabase for data + auth + realtime.

## Destination times, member splits and offline trips

Apply `supabase/migrations/20260905090000_trip_timezone_budget_split.sql` to the
hosted database **before deploying this version**. The local database has this
migration. It adds nullable `trips.timezone` and `trips.budget_member_ids`; it
does not guess zones for existing trips. The full schema also contains both.

- Trip settings → Edit trip details: choose the destination’s IANA time zone.
  AI-created plans can supply it. Calendar export uses that saved zone, never
  the browser zone. Flights store departure/arrival zones and a local arrival
  date in `activities.details`; enter these in the flight editor. Missing or
  invalid timing produces an actionable calendar-sync error. Existing calendar
  events need another sync after setting the correct zone.
- Budget: divide the existing planned total equally among selected members.
  Save the selection for collaborators, or include everyone automatically.
  Shares respect the currency’s precision and sum to the rounded total. This
  is an estimate, not a record of payments or debts.
- During trip dates, Today opens Traveller mode with the current/next activity
  and directions. Both use the destination clock, including overnight flights.
- Trip settings → Download for offline: explicitly save a read-only snapshot
  in IndexedDB. A service worker caches the independent `/offline.html` reader
  and its assets, so it can start without Next, Supabase or a login connection.
  Failed full-page navigations open that reader. The offline banner links to
  it, as does Open saved trip in trip settings. Update or remove a saved copy
  from trip settings. Signing out clears this browser’s downloads.

Downloads include booking references and notes: use a personal device. They
are not encrypted separately from browser storage, do not update automatically,
and can be removed by the browser. Maps, photos, editing and live directions
need a connection. Cache only the reader assets, never authenticated pages,
API responses or Google imagery. Bump the cache version in `public/sw.js` when
changing reader assets; its script is served with `Cache-Control: no-store`.

Implementation references: [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)
and [Google Calendar event times](https://developers.google.com/workspace/calendar/api/v3/reference/events).

## Train times in Japan

Google's Routes API has no transit in Japan (the Google Maps app does; the API
does not), so the app answers trains in Japan itself, from open data, at no
cost and with no key:

- **Greater Tokyo: real timetables.** Every urban railway (JR East, Tokyo
  Metro, Toei, the private railways, monorails, trams), out to Nikko, Hakone,
  Kamakura, Kawaguchiko and both airports. Planning times are typical: the
  median of departures every ten minutes from 10am on a weekday, waiting
  included. Directions in Traveller mode give the next train from now, with
  each train's departure ("Ginza Line 9:32pm"). Source:
  [mini-tokyo-3d](https://github.com/nagix/mini-tokyo-3d) (MIT), which gathers
  the operators' data from the Public Transportation Open Data Center.
- **Other open timetables.** Every railway and tram in Japan's GTFS Data
  Repository ([gtfs-data.jp](https://gtfs-data.jp/); of its 579 current
  feeds, nearly all are buses), plus Fukuoka's subway from
  [GTFS-FukuokaCitySubway](https://github.com/kuwayamamasayuki/GTFS-FukuokaCitySubway):
  the Kumamoto, Kōchi, Toyama and Takaoka trams, and the Kumamoto Electric,
  Ise, Akechi, Yamagata and Kōnan railways. Each feed's licence is in
  `data/transit/LICENSE-open`. They are one operator among several, so a
  timetable answer is used only when it is not clearly slower than the
  estimate over every line. A new feed is a line in `FEEDS` in
  `scripts/transit/build-gtfs.mjs`.
- **The rest of Japan: an estimate over the real network.** No operator
  outside Tokyo publishes its timetable openly, so every other line in the
  country (about 9,000 stations on 590 lines, JR to trams) is modelled: the
  real route over real track, time on board from distance, the kind of line
  and how many trains stop at each station, and the wait from how often trains
  run. Shown with `~` and drawn along the track. Its speeds are fitted
  against real timetables (`scripts/transit/calibrate.mjs`): on 300 Tokyo
  journeys of 2 to 120 km, 80% come within −15%/+10% and 95% within 10
  minutes or 20%; on the regional railways, trams and Fukuoka subway of the
  open feeds, time on board is right at the median. Fast JR corridors, where
  a special rapid skips most stations, come out about a fifth slow. Source: the
  [全国鉄道運行本数データ](https://gtfs-gis.jp/railway_honsu/) of the University of
  Tokyo and the Japan Bus Information Association (CC BY 4.0 / ODbL).
- **Shinkansen.** That dataset counts only trains needing no extra ticket, so
  the eight Shinkansen lines come from `scripts/transit/shinkansen.mjs`, a
  small table of published journey times and service frequencies. Tokyo to
  Kyoto comes out at 2h22 door to door.
- **English names.** Greater Tokyo's from mini-tokyo-3d, the rest from
  [Wikidata](https://www.wikidata.org/) (CC0), matched by name and position
  (`scripts/transit/wikidata.mjs`): 99.5% of stations and 99% of lines. The
  rest show their Japanese names.
- **Left out.** Surcharge trains other than the Shinkansen (Narita Express,
  Romancecar, limited expresses such as the Hida or Thunderbird), ferries,
  buses, and public holidays (treated as weekdays).

**Comparing routes.** Clicking a hop's train chip (on the trip map, the
itinerary or the directions sheet) opens up to four ways to go, fastest
first: the fastest route, then the same trip with each of its lines left out,
with all of them left out, and with fewer changes, keeping those within 15
minutes or half again of the fastest (`lib/trainOptions.js`). Each card has a
journey bar on a shared time scale, the line badges, tags (fastest, cheapest,
changes, JR only) and, opened, the steps: the stations passed, how often
trains run and the next one, and in greater Tokyo the exit to leave by (the
one nearest where you are going, from mini-tokyo-3d's station exits). **Use** saves the lines on the
activity (`activities.transit_pick`), and that hop prefers them from then on.
Tapping a train step lists its departures for the rest of the day, from a
leave-at time, with the last train (`lib/departures.js`, timetable regions
only). Every time in the app is 12-hour.

**Fares** (`lib/fares.js`) are shown only where they are known: the open
feeds' GTFS fares, and the IC fares of Tokyo Metro and Toei from their
distance bands (a range near a band's edge, ¥70 off a change between the
two). JR and the other private railways publish no machine-readable fares, so
their routes show none. **Operator logos** are the railways' own from
Wikimedia Commons, only those filed there as public domain
(`scripts/transit/operator-logos.mjs` fetches them into `public/operators/`
and `lib/operatorLogos.js`); other operators show their initials.

How it fits together: `/api/routes` sends transit in Japan to
`lib/japanTransit.js`, which tries the timetable regions
(`lib/timetableRegions.js` over `lib/timetable.js`, a connection scan), then
the nationwide model (`lib/railModel.js`, Dijkstra's). Each answers in
Google's shape with `source: 'timetable'` or `'model'`, and loads its data
(`data/transit/tokyo-rail.json`, 2.5 MB; `open-rail.json`, 0.2 MB;
`japan-rail.json`, 1 MB) on its first request. Everything else goes to
Google as before.

**Keeping it current.** Timetables change every March. Rebuild, refit, test,
commit:

```
git clone --depth 1 --filter=blob:none --sparse https://github.com/nagix/mini-tokyo-3d.git
git -C mini-tokyo-3d sparse-checkout set data
node scripts/transit/build-tokyo.mjs mini-tokyo-3d

mkdir honsu && cd honsu
curl -O https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_rosen_kukan.geojson
curl -O https://gtfs-gis.jp/railway_honsu/data/unkohonsu2026_rosen_eki.geojson
cd ..
node scripts/transit/wikidata.mjs wikidata             # English names
node scripts/transit/build-japan.mjs honsu mini-tokyo-3d --wikidata wikidata

node scripts/transit/build-gtfs.mjs feeds              # downloads the open feeds into feeds/

node scripts/transit/calibrate.mjs     # fits PACE in lib/railModel.js; check its regional line too
npm test
```

Check `scripts/transit/shinkansen.mjs` against the new Shinkansen timetable
too. The `LICENSE*` files in `data/transit/` carry each source's terms and
must stay beside the data; the Terms page credits them.

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
OPENAI_IMAGE_MODEL = gpt-image-2   # optional; drawn trip covers, default gpt-image-1
OPENAI_IMAGE_SIZE  = 2304x1536     # optional; WIDTHxHEIGHT, default follows the model
OPENAI_IMAGE_QUALITY = high        # optional; low, medium, high or auto — default high
```

Note the missing `NEXT_PUBLIC_` prefix: unlike the Supabase anon key, this is a
real secret. It is read only by the route handlers in `app/api/`, and the
browser calls those rather than OpenAI. Never add the prefix — it would inline
the key into the client bundle for every visitor.

Without it the app works exactly as before; the planning features return a 503
that the UI explains, and every screen stays usable by hand.

The four AI call sites want different things — planning a trip is streamed, so
latency is hidden and only quality counts, while parsing a line someone just
typed is the reverse. That tuning lives in the `TASKS` table at the top of
`lib/ai.js`, not in the environment: it does not vary between a laptop and
production, so keeping it in code means it is versioned and cannot drift.

`OPENAI_MODEL` stays an environment variable, because which models an account
can actually use genuinely does vary.

Trip covers are drawn at the best quality, at the largest size the image model
allows (`lib/coverDraw.js`): 1536x1024 for `gpt-image-1`, which turns anything
larger down, and 2304x1536 for its successors. That costs more and takes far
longer than a small draw — over a minute is ordinary — so the route may run for
five minutes (`maxDuration` in `app/api/trips/cover/route.js`) and gives up
itself a little before that, answering "took too long" and logging what it
asked for. If the Vercel plan refuses that limit the deployment fails at build
time; bring `maxDuration` down to what the plan allows. If draws still run out
of time, step down without a deploy: `OPENAI_IMAGE_QUALITY=medium`, or a
smaller `OPENAI_IMAGE_SIZE`.

The sharper lever turned out to be reasoning effort rather than model choice.
Reasoning tokens are worth paying for on a whole itinerary and mostly wasted
turning one sentence into five fields, so `parse` runs at minimal effort — that
alone took the add field from about ten seconds to under two.

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
- **Japanese train data** is bundled in `data/transit/` (Tokyo timetables
  from mini-tokyo-3d, MIT; the nationwide network from gtfs-gis.jp, CC BY 4.0 /
  ODbL) and planned on the server; nothing is called at runtime.

Without the Google keys the map is replaced by a panel naming what to set, and
stops are not located. Without the OpenAI key the planning features return a
503 the UI explains. Everything else works regardless.
