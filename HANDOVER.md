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
- **Local Supabase runs in Docker**: `docker exec supabase_db_wander-planner
  psql -U postgres -d postgres -c "..."`. The local database has test data,
  including a demo trip `01b42f44-8000-4b6b-81b0-78bfe48bb37b` ("Hakone &
  Kyoto"). Clean up temporary rows; reusable fixtures must stay under a
  dedicated tester account.

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
| `OPENAI_MODEL_SMART` (turns on the better model for plan + command) | empty |
| `GOOGLE_SITE_VERIFICATION` | placeholder |
| Contact email in `app/privacy/page.js` and `app/terms/page.js` | `REPLACE_WITH_YOUR_CONTACT_EMAIL` |
| Google OAuth verification | **rejected** — `vercel.app` cannot be verified as owned. Needs a custom domain, or stay in Testing mode (refresh tokens then expire every 7 days) |
| Vector Map ID for compass rotation | optional |

---

## 8. Where the AI work stands

`lib/ai.js` routes seven tasks across two model tiers and three effort levels.
`plan` and `command` use `OPENAI_MODEL_SMART`; everything else uses
`OPENAI_MODEL`. Unset, both resolve to the same model and nothing changes.

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
  `0fd0ae3f-91a8-4d6f-8a90-eea84cebd85a`. Local-only fixture login details are in
  untracked `tmp/travel-e2e.json`. It was seeded through ordinary local sign-up,
  with no admin or production credentials.

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
  final prompt and empty trips/packing states only. Preserve the working hero
  preview and keep populated planner views free of decorative images. The
  theme-aware CSS blends their white backgrounds into the page. Assets and
  prompts are documented in `docs/artwork.md`; no Higgsfield runtime access is
  needed. Keep explicit dimensions, lazy loading, empty alt text and print hiding.
- UI copy is plain and short. No exclamation marks. Errors say what happened and
  what to do, never "Oops".
- Reuse existing patterns before inventing one — there is already a confirm
  pattern, a popover, a menu, a toast, a tooltip. The previous agent shipped a
  fourth confirm design and was rightly told off for it.
