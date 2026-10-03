# Train options in Japan: build plan

**Goal:** build what `docs/train-options.md` describes. In Japan, a train hop
offers two to four routes to compare. Each shows its lines, fares, a journey
bar and the departures for the rest of the day, and a chosen route is saved
to the trip.

**Architecture:** the two planners (`lib/timetable` and `lib/railModel`) learn
to leave lines out and to make changes costly. A new `lib/trainOptions`
re-plans with those settings and turns every journey into one shape of option
with legs. `/api/routes` adds those options to its transit answer, and
`/api/departures` lists a leg's trains. On screen, a `TrainOptions` panel takes
the stop list's place on the trip map and the Transit tab's place in
directions, and the map draws the shown option line by line.

**Stack:** Next.js 15 (App Router, JS), Supabase, node's own test runner
(`npm test`), Google Maps JS for the map.

**Spec:** `docs/train-options.md`. This plan follows it, and both are read
together.

## Rules for every task

- Times on screen are 12-hour (`10:06am`), and never 24-hour. Minutes go
  through `fmtMinute` (task 1), and `HH:MM` strings through `fmtTime`
  (`lib/util`).
- Fares are IC fares and are never guessed: an unknown fare is `null` and is
  not shown.
- No operator's real logo without a licence that allows it. Otherwise the mark
  is the operator's initials on its colour.
- Tooltips are short: a name and a fact or two, without saying where a number
  came from.
- Every task ends with `npm test` passing, and a `next build` before any push.
- Commit messages end with the session's `Co-Authored-By` and `Claude-Session`
  lines. Work goes only to the branch `ccr-5e5a3f68-o4opgg`.

---

## Step 1: options from the planners

### Task 1: a 12-hour clock for timetable minutes

**Files:**
- Modify: `lib/util.js` (add `fmtMinute`)
- Modify: `components/RouteView.jsx` (show `l.departs` with `fmtTime`)
- Test: `tests/util.test.mjs` (add to it, or create it if there isn't one)

**Produces:** `fmtMinute(minute: number): string`, where `minute` counts from
midnight of the service day and may go past 1440. For example,
`fmtMinute(606)` is `'10:06am'`, `fmtMinute(1453)` is `'12:13am'` and
`fmtMinute(720)` is `'12pm'`. It uses the same style as `fmtTime`.

- [ ] Write the test: 0 → `12am`, 606 → `10:06am`, 720 → `12pm`,
      1453 → `12:13am`, 1500 → `1am`.
- [ ] Run `node --test tests/util.test.mjs` and see it fail.
- [ ] Write `fmtMinute`, using `fmtTime`:
      `const m = ((minute % 1440) + 1440) % 1440; return fmtTime(\`${pad(Math.floor(m / 60))}:${pad(m % 60)}\`);`
- [ ] In `RouteView`, show `fmtTime(l.departs)` where `l.departs` is shown.
- [ ] Run the tests, then commit.

### Task 2: the timetable planner can leave lines out and make changes costly

**Files:**
- Modify: `lib/timetable.js` (`earliestJourney`, `typicalJourney`, `ride`)
- Test: `tests/timetable.test.mjs`

**Produces:**
- `earliestJourney(net, from, to, minute, { avoid = null, change = 0, only = null } = {})`:
  - `avoid`: a `Set` of line indexes that are never boarded;
  - `only`: a `Set` of line indexes, the only ones boarded;
  - `change`: extra minutes on every boarding after the first (it is added to
    `ready` after an arrival and after a walk between stops, never at the
    start).
- `typicalJourney(net, from, to, starts = TYPICAL, opts = {})` passes `opts`
  through.
- A ride leg gains:
  - `lineIndex: number`;
  - `toward: string`, the name of the last stop of the train it is on, or of
    the last train it runs through onto;
  - `times: number[]`, the arrival minute at each stop in `stops`.

- [ ] Write tests against the real Tokyo data (the file already loads it):
  - With `avoid` set to the lines of the fastest journey from Tokyo Station to
    Shinjuku Gyoen, no ride in the new journey is on those lines.
  - With `only` set to `{Marunouchi}`, every ride is on the Marunouchi Line.
  - With `change: 30`, the journey has no more changes than with `change: 0`.
  - `toward` is not empty.
  - `times` has one entry per stop, and the entries never go down.
- [ ] Run the tests and see them fail.
- [ ] Implement:
  - Find a leg's line with `net.stops[legs.from[c]].line`.
  - Skip a leg whose line is avoided, or not among `only`, before boarding.
  - Add `change` in the two places where `ready` is set after arriving or
    after walking.
  - In `ride()`, add `lineIndex`, `toward` (the stop at the end of the train's
    stop sequence) and `times` (`legs.arr` for each leg in `at`, after
    `legs.dep` of the first).
- [ ] Run the tests (all 342 or more must pass), then commit.

### Task 3: the model planner can leave lines out and make changes costly

**Files:**
- Modify: `lib/railModel.js` (`modelJourney`, and a new `modelLegs`)
- Test: `tests/railModel.test.mjs`

**Produces:**
- `modelJourney(model, from, to, { avoid = null, change = 0 } = {})`:
  - `avoid`: a `Set` of model line indexes; an edge is skipped when it boards,
    rides, runs on or travels express on an avoided line;
  - `change`: added to every edge that leaves a `ridden(hub)` node and boards
    a train (`BOARD` or `EXPRESS`).
- `modelLegs(model, journey)` returns
  `[{ kind: 'walk'|'ride', minutes, lineIndex?, from, to, stops: [hub], through }]`.
  The minutes are summed from the edge costs, and a ride's minutes include its
  wait.

- [ ] Write tests:
  - Kyoto Station to Kiyomizu-dera with the first journey's lines avoided
    gives a journey that rides none of them.
  - `change: 30` never adds changes.
  - `modelLegs` minutes add up to the journey's minutes (within 1).
- [ ] Run the tests and see them fail, implement, run them again, then commit.

### Task 4: `lib/trainOptions`, one shape of option for both planners

**Files:**
- Create: `lib/trainOptions.js`
- Modify: `lib/timetableRegions.js` (export
  `regionNetworks({ from, to, now })` returning `[{ region, net, minute|null }]`)
- Modify: `lib/japanTransit.js` (`japanTransit` returns the route plus
  `options`)
- Test: `tests/trainOptions.test.mjs`

**Produces:**
- `planOptions({ net, from, to, minute|null, kind: 'timetable'|'model', prefer = null }) → Option[]`;
- `Option = { id, seconds, source, lines: string[], tags: string[], fare: null, legs: Leg[] }`;
- `Leg` is one of:
  - `{ kind: 'walk', minutes, from, to, exit: null, polyline }`;
  - `{ kind: 'wait', minutes }`;
  - `{ kind: 'ride', minutes, line: { id, name, code, colour, shape, operator }, type, from, to, toward, stops: [{ name, time|null }], every, next|null, platform: null, polyline }`.

`id` is the lines' ids joined with `>`. `every` is the minutes between trains
at that time, counted from the departures within 30 minutes either side
(timetable), or from the model's trains a day.

**How the options are found:**
1. The fastest journey.
2. One journey for each line of the fastest, with that line in `avoid`.
3. One journey with `change: 12`.
4. Keep one option per `id`.
5. Drop any option slower than the fastest by more than 15 minutes or 50%,
   whichever is larger.
6. Sort fastest first, keep four, and tag them: `fastest`, `changes:N`,
   `jr-only` (every line's operator starts with `JR`), and `cheapest` (task 14).

With `prefer` (a list of line ids), the option with that `id` comes first,
and if it isn't there, `preferMissing: true` is set on the answer.

- [ ] Write tests (Tokyo data):
  - Tokyo Station to Shinjuku Gyoen gives at least two options with
    different `id`s.
  - The first is tagged `fastest`.
  - Every option's legs add up to its `seconds / 60` (within 1).
  - `prefer` with the second option's lines puts it first.
- [ ] Write tests with the model (Kyoto) for the same things.
- [ ] Implement, then make `japanTransit` add `options` to its answer and keep
      `seconds`, `lines` and `polyline` as they are for everything already
      using them.
- [ ] Run the tests, then commit.

### Task 5: line codes, operators and colours in the data

**Files:**
- Create: `scripts/transit/line-codes.mjs`, holding codes by mini-tokyo-3d
  railway id, and by model operator and line name for the Osaka, Kyoto,
  Nagoya, Fukuoka and Sapporo subways
- Modify:
  - `scripts/transit/build-tokyo.mjs`: lines become
    `[name, colour, vehicle, operator, code]`, plus
    `operators: [[name, colour]]`;
  - `scripts/transit/build-gtfs.mjs`: the operator from `agency.txt`, and the
    train type from the trip, where the feed has one;
  - `scripts/transit/wikidata.mjs` and `build-japan.mjs`: line colours (P465)
    into each line's `c`;
- Regenerate: `data/transit/tokyo-rail.json`, `open-rail.json` and
  `japan-rail.json`
- Test: `tests/timetable.test.mjs` and `tests/railModel.test.mjs`
  - Tokyo's `Marunouchi Line` has code `M`, colour `F62E36` and operator
    `Tokyo Metro`.
  - `JR Yamanote Line` has code `JY`, and its shape is `square`.
  - Most model lines in Osaka have a colour.

- [ ] Write the tests, rebuild the three files with the scripts, run the
      tests, and check the files are no more than 5% bigger. Commit.

## Step 2: the panel and the map

### Task 6: badges and marks

**Files:**
- Create: `components/TrainBits.jsx`, exporting `LineBadge`, `OperatorMark`,
  `ICCard`, `ExitBadge`, `PlatformChip`, `WalkIcon` and `TagChip`
- Create: `components/TrainBits.module.css`

These follow the mockup:
- **LineBadge:** white, a 3px ring in the line's colour, and the code in
  `#141413`. Round, or square with a 6px radius for JR. Without a code it is
  a 4px bar in the line's colour and the name.
- **OperatorMark:** 16px tall, white initials on the operator's colour.
- **ExitBadge:** `#f2c230` with `#141413` text.

Check them by eye in the browser in task 9.

### Task 7: the `TrainOptions` panel

**Files:**
- Create: `components/TrainOptions.jsx` and `components/TrainOptions.module.css`
- Modify: `lib/geo.js`: `routeBetween` returns `options` as they come

**Props:** `{ answer, title, sub, mode: 'plan'|'now', picked, onPick(optionId), onUse(optionId|null), onLeg(option, legIndex) }`

**Behaviour, as in the spec:**
- **Cards** with tags, the IC fare, a journey bar on a shared time scale, the
  badges and a summary.
- **The bar tooltip** is full width, under the bar, with an arrow at the piece
  pointed at.
- **An opened card** has a divider and its steps:
  - a train step's stop count opens to list the stations in between;
  - tapping a train step calls `onLeg`;
  - the next train shows beside "Every N min".
- **The fare** is one line for one operator, and a line per operator plus an
  `IC card` total for several.
- **Use / Remove**, with "Saved to the trip for next time."
- **The destination** ends the steps with a map marker.

### Task 8: the hop chip opens the panel

**Files:** modify `components/LegLine.jsx`, `components/MapView.jsx` and
`components/Itinerary.jsx`.

- **The train chip** shows the first option's badges, its minutes and its
  fare. A saved route adds a pin.
- **Its tooltip** names the lines and ends `Click for other routes`.
- **Clicking it** in Japan, where the answer has `options`, opens the panel:
  - **On the trip map** it takes the stop list's place, with `‹ Your stops`.
  - **In the itinerary** it opens the trip map's panel for that hop.
- **Other ways** (walk, drive, and transit outside Japan) keep today's
  click-to-draw.

### Task 9: the map draws the shown option

**Files:** modify `components/GoogleMap.jsx` (`drawLines`) and
`components/MapView.jsx` (`linesFor`).

- **One hop's lines:** a hop's route line may carry
  `{ segments: [{ path, colour, kind }], faint: [path[]], marks: [{ at, kind, label }] }`.
  - Each ride segment is drawn solid in its line's colour, and each walk
    dotted.
  - The other options are drawn faint grey underneath.
  - The marks are station dots, the badges where you board, the exit badge
    and walk labels (`3 min` and the walking icon).
- **Hovering** a segment or a faint option shows a tooltip on an overlay, in
  the same three rows as the panel's tooltips. Clicking a faint option shows
  it.
- [ ] Check in the browser, at desktop and phone widths, with a seeded Tokyo
      trip, then commit.

## Step 3: departures

### Task 10: `lib/departures` and `/api/departures`

**Files:**
- Create: `lib/departures.js` and `app/api/departures/route.js`
- Test: `tests/departures.test.mjs`

**Produces:**
- `departures(net, { from, to, option, leg, after, until = 1620 })` returns
  `{ trains: [{ leaves, arrives, type }], last: { leaves, arrives } }`:
  - `leaves` are departures of that leg's line and direction from its boarding
    stop, from `after` onwards;
  - `arrives` is planned with `earliestJourney(..., { only: the option's lines })`
    from just before `leaves`;
  - a train that never reaches the stop you get off at is left out.
- **The route:** POST `{ from, to, lines, leg, after, day }`, and it answers
  with the same.

- [ ] Write tests:
  - The trains are in order.
  - All of them come after `after`.
  - The last train is the last of the day.
  - Arrivals are never before departures.
  - A day past midnight works (`after` 1430).
  - A Chuo Special Rapid that skips a stop is left out for that stop.
- [ ] Implement it, run the tests, then commit.

### Task 11: the departures view and the time picker

**Files:**
- Create: `components/Departures.jsx`, `components/TimePicker.jsx` and their
  CSS modules

**What it has:**
- **The header:** the line, the operator mark, `Station → toward X`, the
  platform chip, and the last train at the top.
- **Leave at:** one 12-hour `TimePicker`, showing the current time until it
  is changed.
- **The trains:** the next five, then **More**, which lists the rest of the
  day without the last train. `in N min` shows only while the picker still
  shows the current time.
- **TimePicker:** our own component, not `<input type=time>`. It is a button
  showing `10:02am`, and it opens a small panel with hour, minute (in steps of
  5) and am/pm columns. It works with the keyboard (the arrow keys) and is
  labelled for screen readers.

## Step 4: saving the route

### Task 12: `activities.transit_pick`

**Files:**
- Create: `supabase/migrations/20261002090000_transit_pick.sql`
- Modify:
  - `supabase/schema.sql` (the column);
  - the activity update path in `lib/` (find where an activity is saved);
  - `TrainOptions` `onUse`;
  - `/api/routes`, so it takes `prefer`;
  - `useLegs`, so it sends the hop's pick.
- Test: `tests/travel.test.mjs`
  - A pick whose `after` isn't the current stop before is ignored.

## Step 5: fares

### Task 13: GTFS fares into `open-rail.json`

`build-gtfs.mjs` reads `fare_attributes.txt` and `fare_rules.txt` (by origin
and destination zone) for each feed and writes
`fares: [[operatorIndex, fromZone, toZone, yen]]`. Rebuild the file, and test
two known Kumamoto tram fares.

### Task 14: `lib/fares`

**Files:**
- Create: `lib/fares.js`
- Test: `tests/fares.test.mjs`

**Produces:** `fareFor(option, data) → { total, parts: [{ operator, yen }] } | null`.

**The rules:**
- **Tokyo Metro** IC: 178 / 209 / 252 / 293 / 324 for 1–6 / 7–11 / 12–19 /
  20–27 / 28–40 km.
- **Toei** IC: its bands.
- **Tokyo Metro to Toei:** ¥70 off.
- **JR East:** its 2026 table, once it can be read.
- **Rides one after another on one operator** count as one fare, by their
  total distance.
- **The open feeds** use their zone fares.
- **Anything unknown** makes the whole fare `null`.

**Tests:** both edges of each band, the discount, and an unknown operator
giving `null`.

## Step 6: exits, platforms and logos (when their hosts are allowed)

### Task 15: `scripts/transit/osm-stations.mjs` → `data/transit/stations-extra.json`

The script asks Overpass for station entrances (`railway=subway_entrance` and
`railway=train_station_entrance`, with `ref` and `name`) and for platforms in
route relations (`public_transport=platform`, with `local_ref` or `ref`, for
each route's direction).

`trainOptions` then fills in each walk's `exit` (the entrance nearest the
place) and each ride's `platform`. The Terms page credits OpenStreetMap
(ODbL).

### Task 16: operator logos

The logos are SVGs from Wikimedia Commons, checked one by one for a licence
that allows them, kept in `public/operators/` with a list of credits, and
shown by `OperatorMark` where one exists.

## Finishing

- In the browser, at desktop and phone widths:
  - a Tokyo hop, with its options, bar tooltip, steps, departures, Use and the
    map;
  - a Kyoto hop, estimated, with no departures;
  - a Kumamoto tram.
- Update the README's "Train times in Japan" section.
- Push and check the PR.
