# Wander — handover

Everything a new agent needs before touching this repo. Read it once, in full,
before the first edit.

---

## 1. What this is

**Wander** — a travel itinerary planner. Next.js 15 (App Router, JavaScript, no
TypeScript), Supabase (Postgres + Auth + Realtime), deployed on Vercel. Google
Maps/Places/Routes for anything geographic, OpenAI for anything generative.

- Prod: <https://wander-travel-itinerary-planner.vercel.app>
- **Pushing to `main` deploys live.** There is no staging.

Layout worth knowing:

| path | what lives there |
|---|---|
| `app/api/*` | route handlers — every OpenAI and Google call is server-side |
| `lib/ai.js` | model/effort routing, the strict-JSON helper `askJson` |
| `lib/googleCal.js`, `lib/supabaseServer.js` | calendar + service-role access |
| `components/` | all UI, client components |
| `supabase/schema.sql` | the whole schema, idempotent |

---

## 2. How the owner wants you to work

- **Ship without asking.** Build, commit and push finished work to `main`
  automatically. Do not ask for permission to commit. Do not ask "shall I
  proceed".
- **Build before every commit.** `npm run build` must pass.
- **Say what you could not verify.** They would rather hear "this path is
  untested because I cannot sign in" than a confident claim.
- **Push back when they are wrong**, with evidence. They respond well to it and
  badly to agreement they did not earn.

### The procedure that keeps biting

**Stop the dev server before running `npm run build`.** Running a production
build while `next dev` is up corrupts `.next` and produces phantom 404s,
"Cannot find module './vendor-chunks/...'", and bogus prerender errors on
`/404`. The previous agent did this four times and wasted an hour each time.

```
stop dev  →  npm run build  →  commit + push  →  start dev again
```

If it happens anyway: `rm -rf .next`, then restart dev.

### Git

Pushes fail with a certificate error unless git uses the Windows cert store.
If a push fails on SSL, that is the cause.

---

## 3. Hard-won lessons — read these before debugging anything

Trip management is unified in the Edit trip dialog: Details, Travellers,
Offline and Calendar. The trip header has a separate edit control; its account
menu contains account actions only. Legacy /settings and /people URLs open the
same dialog over the itinerary and return there on close. New-trip forms and
quick edits from the trip list still use the basic TripModal fields. Draft
details survive tab changes; sharing/offline/calendar actions use saved data.

A trip's cover (`trip.cover_path` / `cover_ref`, resolved by `coverURL` in
`lib/tripCover.js`) is drawn across the head of the itinerary by
`components/TripHero.jsx`, with the trip name laid over a dark scrim so any
uploaded photo stays readable. The whole frame opens the cover in the shared
`Lightbox` (`coverPhoto` in `lib/tripCover.js` shapes it for the viewer). No
cover, or one that fails to load (`heroCoverURL`), falls back to the plain
heading. The Edit trip dialog saves
covers as you go, so it reports them through `onCover` and the page takes them
at once; do not wait for Save or the realtime refresh. Replacing a cover
(upload or redraw) deliberately leaves the old file in the `trip-covers` bucket
— the owner wants every cover a trip has had to stay visible there — so only the
trip's `cover_path` moves. Files are deleted only by the Remove button and when
a trip is deleted, and the latter removes just the current cover, so older ones
stay behind.

Mobile session recovery lives in `lib/sessionRecovery.js`. AppProvider restores
on visibility, pageshow, focus and reconnect without remounting ready editors.
Trip reads check the session first and replay once after a rejected JWT; never
wrap mutations with this helper. Failed trip views offer Retry and retry after
a restoration attempt. Token-refresh events alone must not retrigger failed
loads, or a persistent rejection can loop. Network errors must not sign users
out or clear offline downloads. Keep auth consumers outside the SDK callback
lock. Regression coverage is in `tests/session-recovery.test.mjs`.

These are the recurring bug classes in this codebase. Most "the model is being
stupid" reports turned out to be one of them.

1. **A model with no field for a fact will put the fact in prose.** The single
   biggest source of complaints. A flight arrived titled
   `Flight: SIN (T2) → KUL (T1), MH 616 (confirmed)` because the schema had
   `title` and no `code`, `from`, `from_terminal`. Asked to change a subtype
   with no `subtype` field, the model wrote *notes about* subtypes. **Before
   blaming the prompt, check the schema can express the answer.**

2. **Prompt rules are not enough on their own.** Where correctness matters,
   follow the instruction with deterministic repair. `app/api/plan/route.js`
   has a `corrector()` that puts calendar titles and addresses back verbatim,
   because "use them exactly" was read as leave to annotate.

3. **`app/api/command/route.js` has a whitelist sanitiser.** A new field must be
   added in **four** places or it silently vanishes: the schema, the sanitiser,
   the `expand()` bulk path, and the apply in `components/Command.jsx`. Missing
   the sanitiser looks exactly like the model ignoring the request.

4. **`backdrop-filter` creates a containing block for `position: fixed`.** Any
   fixed overlay inside a glass surface must be portalled to `document.body`.
   This has caused at least four separate bugs.

5. **Postgres returns `time` columns as `"09:00:00"`, not `"09:00"`.** Appending
   seconds gave `2026-10-28T09:00:00:00` and Google rejected every timed event.

6. **One-shot effects must not claim before they can act.** Setting a
   `hasRun` ref and then bailing on a guard means the work never happens —
   React StrictMode double-invokes in dev and hides it. Bit twice.

7. **Google Places field masks decide the billing tier.** `reviews` puts the
   call in the top tier, so `rating`, `phone` and `website` ride along free.
   Photo *references* are free with a search; each photo *drawn* is a billed
   fetch, and references carry a per-response token so they are not stable ids.

8. **The map is raster.** `NEXT_PUBLIC_MAPS_MAP_ID` is unset, so it falls back
   to `DEMO_MAP_ID` and `setHeading` is silently ignored. Compass rotation in
   Traveller mode is written and dormant; it needs a vector Map ID.
   The Map page also offers optional photorealistic 3D using the independent
   `maps3d` renderer. See `docs/3d-maps.md` for scope, billing and validation.
   It does not change Traveller navigation or activity-editor maps.

9. **Things that arrive after the page.** The server cannot see the session
   (Supabase keeps it in localStorage) or the reader's clock, so anything drawn
   from them shows up only once the bundle has run: a control from nowhere, a
   card that drops in, a bar that jumps. Read what the server sends against what
   the page ends up with. Draw both states and pick one with CSS, or decide
   before the first paint with a tiny inline script — the landing page's
   account control does both (`lib/accountHint.js`, `data-account` on
   `<html>`). Never send content hidden for a script to reveal: `opacity: 0`
   from the server meant a slow phone showed a bare nav bar and nothing else.
   And never read the SDK's `session: null` as "signed out". With an expired
   token and a refresh that fails it says exactly that (`getSession` with an
   `error`, `INITIAL_SESSION` with null), which is how a signed-in visitor once
   got "Open Wander" 26 seconds after the page loaded. Storage is the truth:
   the SDK removes a session the server rejects and leaves one it could not
   reach.

---

## 4. What you cannot verify, and why

- **Use visible browser tests.** The owner has authorised seeding a dedicated
  local tester account and trips for authenticated E2E checks. Never use their
  real trips as test data. Keep the test tab visible and mark it as a deliverable
  so they can inspect it afterwards. A local-only Notes E2E Tester account and
  an `E2E — notes autosave` trip were created for the notes regression checks.
- **Workarounds that do work:** call the API routes directly with `fetch` from
  the browser console; render real markup against the real stylesheet to check
  CSS; query the local database directly.
- **The desktop app's Browser pane can be hidden**, and then screenshots and
  clicks time out. A scratch Chrome DevTools driver works instead — Node 22 has
  a global `WebSocket`: launch `C:/Program Files/Google/Chrome/Application/chrome.exe`
  with `--headless=new --remote-debugging-port=…`, emulate with `Emulation.*`
  (device, colour scheme, reduced motion, CPU and network throttling), inject a
  probe before the page's own scripts with `Page.addScriptToEvaluateOnNewDocument`,
  and seed a signed-in session into localStorage the same way. Blocking
  `/_next/static/*` shows the frame a visitor gets before hydration.
- **Local Supabase runs in Docker**: `docker exec supabase_db_wander-planner
  psql -U postgres -d postgres -c "..."`. The local database has test data,
  including a demo trip `01b42f44-8000-4b6b-81b0-78bfe48bb37b` ("Hakone &
  Kyoto"). Clean up temporary rows; reusable fixtures must stay under a
  dedicated tester account.
- **Where the machine-local things live** (none of it is committed; `tmp/` is gone and is
  gitignored, so do not keep anything you need there):
  - `.env.e2e.local` — the local test account's login (see section above).
  - `.local/bin/supabase.exe` — the Supabase CLI (v2.115.0). It is not on PATH or in
    `node_modules`, so run it by path from the repo root: `./.local/bin/supabase.exe status`.
  - `.local/art-sources/` — lossless PNG originals of `public/artwork/*.webp`.
  - `tools/dev-clean-env.mjs` — `next dev` with the stale Windows `OPENAI_API_KEY` removed
    for that one process.
  - `scripts/e2e/seed-travel-tester.mjs` — one-shot fixture seeder for the test trip.
  - `output/group-XX-seminar-src/` — build scripts and notes for the CS3216 seminar deck
    (the finished decks are beside it in `output/`). Not part of Wander.

---

## 5. Secrets and safety

- **Never print `.env` or `.env.local` contents.** Mask with
  `sed 's/=.*/=<set>/'` when you need to see which keys exist.
- **Never accept an API key pasted into chat.** Tell the owner to put it in
  `.env.local` and Vercel themselves.
- ⚠️ **An OpenAI API key leaked in an early session and has still not been
  rotated.** Remind them.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses row-level security. Server-only, never
  `NEXT_PUBLIC_`.

---

## 6. Schema changes

**Always announce them.** Prod is a separate Supabase database the owner updates
by hand from the dashboard; a schema edit that is not flagged becomes a
production error days later. `supabase/schema.sql` is fully idempotent, so the
whole file can be re-run safely — but note that the Supabase SQL editor runs a
paste as **one transaction**, so one failing statement rolls back the lot.

---

## 7. Outstanding — owner's side, not yours

| item | state |
|---|---|
| Rotate the leaked OpenAI key | not done |
| `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` + Vercel | placeholder |
| `GOOGLE_SITE_VERIFICATION` | placeholder |
| Contact email in `app/privacy/page.js` and `app/terms/page.js` | `REPLACE_WITH_YOUR_CONTACT_EMAIL` |
| Google OAuth verification | **rejected** — `vercel.app` cannot be verified as owned. Needs a custom domain, or stay in Testing mode (refresh tokens then expire every 7 days) |
| Vector Map ID for compass rotation | optional |

---

## 8. Where the AI work stands

`lib/ai.js` routes seven tasks across two model tiers and three effort levels.
`plan` and `command` use `gpt-5.5`, named in the code; everything else uses
`OPENAI_MODEL`. The guide service (`scripts/guides`) uses `gpt-5.5` at high
effort through the Responses API with web search.

Every call is **single-shot structured output** — a strict JSON schema, one
request, deterministic post-processing. There is no tool-use loop anywhere, and
that is deliberate: it keeps the app streamable, cheap and debuggable.

**The agreed next step, not yet built:** one bounded tool-use pass after the
plan lands — `find_place` and `place_details`, hard cap of ~8 calls — to fill in
opening hours and closing days, which the planner currently cannot know and
papers over with "check opening hours" in the notes. If you build it: tool
errors must be returned as data rather than thrown, and it must propose rather
than write. The command bar's existing propose-then-approve flow is the pattern
to copy.

---

## 9. House style

### Lodging bookings

- A lodging booking is one activity row. Its existing `details` JSONB holds
  optional `check_in_date`, `check_out_date` (YYYY-MM-DD), `check_in_time` and
  `check_out_time`. No additional migration is needed.
- `lib/lodging.js` derives itinerary endpoints with `_source` pointing to the
  original record. Never persist a projected entry or duplicate its cost.
  Both endpoints and intervening-day bed icons open the original editor.
- Only a complete, valid range implies covered nights. Endpoint days have
  activity rows; intermediate days have icons. Structured bookings with no
  dates appear under Unscheduled lodging. Legacy note-only lodging is unchanged.
- Preserve out-of-trip booking dates; the editor confirms keeping them without
  changing trip dates. The change agent should ask before extending a trip.
- Keep lodging fields in planner/command schemas, sanitizers, client payloads,
  and save paths. `tests/lodging.test.mjs` covers projection and persistence rules.

### General

- Notes autosave is coordinated by `lib/notesSync.js`: register own writes
  before optimistic updates, serialize saves, preserve newer drafts, and pause
  pending autosaves for genuine conflicts. Save failures must return `false`
  to the editor, not display a false Saved status. Covered by notes-sync tests.

- Activity editors mount `StaticActivityMap` until expansion; only the expanded
  panel mounts `GoogleMap`. Previews always use light road maps; saved map type
  and theme preferences apply only to interactive maps. Static previews use the authenticated
  `/api/maps/static` proxy. Configure server-only `MAPS_STATIC_API_KEY`, or allow
  Maps Static API on the existing `GEOCODING_API_KEY` / `PLACES_API_KEY` fallback.
  The API must also be enabled in Google Cloud. A rejected static request shows
  a click-to-open fallback, never silently loads an interactive map. Do not
  persist images or crop out Google's attribution. As of this change the local
  fallback key returned 403 for Static Maps; Cloud/key setup is still required.

Match the surrounding code — it is consistent and deliberate.

### Type scale (29 September 2026)

- Font sizes in the trip pages come from six tokens on `:root` in
  `globals.css`: `--fs-xs` 12, `--fs-sm` 14, `--fs-md` 16, `--fs-lg` 18,
  `--fs-xl` 24 and `--fs-2xl` 28. Write `font-size: var(--fs-sm)`, never a
  number. The pages had drifted to two dozen sizes (11.5, 13.5, 14.5 …) and the
  itinerary carried a larger set of its own under `.itin`, so the same class
  was a different size on each tab. `.itin` now holds layout only.
- Nothing that is read goes below 12px. By role: `xs` badges, uppercase labels,
  table headers, pin and avatar numbers; `sm` meta lines, hints, chips, form
  labels, small buttons; `md` body text, times and every field (16px also
  keeps iOS from zooming into inputs); `lg` item titles and card and dialog
  headings; `xl` day headings and the numbers a page is built around; `2xl`
  page titles. Unstyled `h3`, `h4` and `<small>` take a step from `globals.css`
  instead of the browser's 18.72px and 10px.
- To make the app read larger or smaller, change the six values, not the
  rules. Left alone on purpose: the wordmark, print (`pt`), the fluid Today
  headline, the planning desk's notes (the person sizes those), and the
  landing, guides, globe, sign-in, legal and trips-list styles, which keep
  their own type. Shared atoms (`.small`, `.label`, `.btn.sm`, `.page-head h2`)
  are on the scale everywhere, so those pages moved with them by a pixel or two.
- Checking it: in the browser, walk every text node and read its computed
  size — a trip tab should show only 12, 14, 16, 18, 24 and 28, plus the
  wordmark's 21 and 23 and, on the map, Google's own 10px attribution.
  `MapView.module.css` and `PlanningDesk.module.css` have sizes of their own;
  they use the same tokens.

### The landing page (29 September 2026)

- All of its styles are in `app/landing.css`, prefixed `lp-`. `globals.css` keeps
  only what is shared: the prompt box, the brand mark, and the frame the legal
  pages use (`.lp-top`, `.lp-foot`). The idea is a travel journal — routes and
  pins only where they say something, features as a timetable, one thing that
  moves. Do not turn the feature list back into a grid of identical cards.
- It is generated once (`○ Static` in the build), so it must not read
  `searchParams` or cookies. Old share links at `/?join=<code>` are redirected
  in `next.config.mjs`.
- The signed-in control is decided by `lib/accountHint.js`: an inline script sets
  `data-account="in"` from the stored session before the first paint, and
  `components/LandingAccount.jsx` follows storage afterwards. Both versions are
  in the HTML; CSS picks one. Covered by `tests/account-hint.test.mjs`.
  Signing out is the one time storage is behind: `AppProvider.signOut` goes to
  the landing page first and the session stays in storage until the server has
  answered, so it calls `markSigningOut()` and the landing treats that session
  (by its refresh token) as gone at once. Without it the landing showed "Your
  trips" for as long as the logout request took. The SDK drops the local
  session even when that request fails, so nothing has to undo the mark.
- The hero's day (`HeroSheet.jsx`) is drawn complete by the server, then moves
  only while on screen and in a visible tab, and can be paused. Every scene has
  four stops and every stop is one line, so the card never changes height — if
  you add a scene, watch the height of `.lp-sheet` through a full cycle. Under
  `prefers-reduced-motion` it stays still and the pause control is hidden.
- `public/promo/wander-promo.mp4` and its poster were recorded before this
  redesign, so the tour's first scene shows the previous landing page.
  Re-record when convenient.

### Destination times, splits and offline access (5 September 2026)

- Before deploying, apply `supabase/migrations/20260905090000_trip_timezone_budget_split.sql`
  to the hosted database. It is applied locally. Existing zones stay null until
  chosen in Trip settings → Edit trip details; never use the browser zone for
  calendar export. New planner output includes the destination IANA zone.
- `public/trip-time.js` is shared by Next and the independent offline reader.
  Flight endpoint zones and local arrival date live in `activities.details`.
  Calendar events include absolute instants and the endpoint IANA zones.
- Budget splits divide the existing total. `budget_member_ids = null` means all
  current members; otherwise use the selected current members. Round using the
  currency precision and distribute the remainder, rather than rounding every
  person's share independently.
- Downloads are explicit read-only IndexedDB snapshots, with an independent
  cached reader at `/offline.html`. Never cache authenticated Next pages, APIs,
  tokens, share codes or Google imagery. Clear downloads on sign-out; show their
  saved date. Bump `public/sw.js`'s cache version when changing reader assets.
- Local RLS persistence smoke test: pipe `tests/travel-storage.sql` into the
  local Docker Postgres with `psql -v ON_ERROR_STOP=1`. It uses the dedicated
  Notes E2E Tester and rolls back all fixtures.
- Validation: 88 Node tests, production build, authenticated local database
  smoke test, and visible browser checks. The reader opened and reloaded with
  Next stopped; sign-out removed downloads. Member selection survived reload,
  flight endpoint zones survived editing, and a phone-width viewport had no
  horizontal overflow. A real Google Calendar write and a physical phone were
  not tested.
- On this Windows setup, build and start Next from the resolved project path
  (`C:/Users/Hoo Di Heng/OneDrive/Documents/Computer Science/Projects/Web Apps/wander-planner`).
  Mixing the E: alias with the resolved path produced duplicate absolute paths
  in Next's manifest lookup, despite a successful build.
- A reusable fictional trip is retained under Travel E2E Tester:
  `0fd0ae3f-91a8-4d6f-8a90-eea84cebd85a`. The account's login is in the gitignored
  `.env.e2e.local` (`E2E_EMAIL`, `E2E_PASSWORD`, `E2E_TRIP_ID`; `.env.e2e.example` shows
  the shape). It was seeded through ordinary local sign-up, with no admin or production
  credentials, and works only against the local stack.

- Comments explain **why**, not what, and often name the bug that caused the
  line to exist. Keep that; it is why the codebase is debuggable.
- British spelling in prose and UI copy.
- Never use native/default dropdowns (`<select>`). Use `components/Select.jsx`
  and the shared popover styling for all dropdown choices, including map controls.
  Preserve keyboard navigation, accessible labels, and light/dark theme support.
- Native browser date/time pickers are also prohibited. Use `DateField.jsx`
  for calendars and `TimeField.jsx` for times; no date/time/month/week inputs.
- Floating map panels, map day chips, Map appearance, Search this area and
  command surfaces share a Liquid Glass-inspired CSS treatment: translucent
  tint, saturated backdrop blur, light gradients and inset edge highlights.
  Keep readable text, selected-day accents and opaque reduced-transparency
  fallbacks. Other warm-earth surfaces stay opaque. The command scrim must
  not filter its own backdrop or it prevents the panel from sampling the page.
- The map shell fills the viewport using flex sizing, including the variable
  Today banner height, so the phone's bottom sheet stays above its navigation.
- Anchor the command shortcut with viewport units, not percentage offsets:
  page scrollbars otherwise shift it sideways between the map and itinerary.
  Keep its bottom offset shared across routes.
- The map stop list groups by day with matching pin colours and preserves the
  visible marker numbering. Transfer connectors stay within each day; distances
  are straight-line estimates, not routed distances. Stop cards use a light
  translucent fill without their own backdrop blur inside the glass panel.
- `TravelEstimate.jsx` supplies the same distance and walking/transport labels
  to the map and itinerary. Itinerary transfers sit beside time gaps and appear
  even for back-to-back activities; missing coordinates do not create a route.
  `activityDistance` validates coordinates and same-day boundaries.
- The small-screen tab bar shares the floating controls' glass treatment and
  solid reduced-transparency fallback. Mobile photo tiles stay inline-grid:
  changing them to flex loses horizontal centring for fallback activity icons.
- The mobile map sheet keeps its handle outside a single scrolling content
  area, including dropped-pin details and search controls. Collapsing shows
  a compact Explore nearby / stop-count bar. The expanded sheet has separate
  Explore and My stops views; categories use an even three-column grid. Search
  state survives switching views, and opening a pin returns to Explore and
  scrolls back to its actions. Desktop keeps the combined sidebar.
  Its height is capped by the available map space and clears the measured
  footer, with a conservative CSS fallback before measurement. The sheet sits
  above map controls on short screens. The map route hides the floating command
  shortcut through CommandProvider's floating prop; top-bar and keyboard
  command access remain available.
- The search form supplies a single rounded tint; its input stays transparent
  so a square form background cannot show around the input's rounded corners.
- `TravelArt.jsx` supplies small, self-hosted illustrations for the homepage's
  final prompt and empty trips/packing/map-stop states only. Preserve the hero's
  live day (`HeroSheet.jsx`) and keep populated planner views free of decorative images. The
  theme-aware CSS blends their white backgrounds into the page. Assets and
  prompts are documented in `docs/artwork.md`; no Higgsfield runtime access is
  needed. Keep explicit dimensions, lazy loading, empty alt text and print hiding.
- UI copy is plain and short. No exclamation marks. Errors say what happened and
  what to do, never "Oops".
- Reuse existing patterns before inventing one — there is already a confirm
  pattern, a popover, a menu, a toast, a tooltip. The previous agent shipped a
  fourth confirm design and was rightly told off for it.
