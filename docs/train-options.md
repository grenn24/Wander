# Train options in Japan

Comparing ways to take the train between two stops: different lines, what
each costs, when the trains leave, and which one to use next time. Builds on
the Japan train times already in the app (`lib/timetable`, `lib/railModel`,
`lib/railTransit`). Mockup: the "Train options mockup" artifact; its numbers
are placeholders.

## What the traveller sees

### Times

Every time in the app is 12-hour (`10:06am`), never 24-hour. All times go
through `fmtTime` in `lib/util`, including the timetable's own clock
(`clock()` in `lib/timetable` returns `HH:MM` and stays internal).

### The hop between two stops

The train chip shows the line badges, the time and the IC fare:
`(M) 24m · ¥209`. Estimates keep their `~`. A hop with a saved route shows a
pin icon on the chip. The tooltip names the lines (`Chuo Rapid → Marunouchi`),
adds `· estimated` outside the timetables, and ends `Click for other routes`.
Clicking the chip opens the train options.

### Train options

- **Where:** on desktop it replaces the stop list in the map's right-hand
  panel, with `‹ Back` to go back; it closes by itself when its hop leaves the
  map (another day picked). On the phone it takes the map's sheet in the same
  way, without the Explore and My stops tabs; put away, the sheet is a
  `Trains` button that brings it back. It is also the Transit tab of the
  directions sheet, and the itinerary's train chip opens it as a sheet of its
  own.
- **Sheets on the phone:** each one can be pulled up by its grip, or stepped
  up with the arrow keys on the map's: the map's sheet from put away to open
  to the whole screen, the itinerary's sheet to the whole screen (and down
  off the screen to close it), and the directions sheet's trains over all of
  the map but a strip.
- **When:** a hop in Japan has its trains from the moment the trip opens,
  whatever the map's Routes setting, since the app answers them itself at no
  cost; the itinerary and the stop list show its train chip straight away.
- **Planning versus now:** the trip map plans the trip's day with usual
  weekday times ("Usual weekday trip around 10am"). The directions sheet plans
  from now ("Leave now · 10:02am from Tokyo Station").
- **Cards:** two to four options, fastest first. Each card has:
  - the minutes;
  - tags with icons: Fastest (bolt), Cheapest (¥), N change(s) (arrows),
    JR only (ticket), and a saved route shown by a pin icon with no word;
  - the IC fare with a contactless-card icon;
  - a journey bar on a time scale shared by every card: walking light grey,
    waiting dark grey, each train in its line's colour;
  - the line badges and a summary ("Every 4 min · no change").
- **Bar tooltip (desktop):** hovering a piece of the bar opens a tooltip below
  the bar, as wide as the card, with an arrow at the piece. It has three rows:
  - badges or the walking icon, the exit badge, and a title;
  - from → to · minutes;
  - grey detail: the operator mark, stops and frequency.
- **An opened card:** a divider, then the steps.
  - **Walks:** the last one starts with the exit badge (`Exit 2`).
  - **The destination** ends the steps with a map-marker icon in the stop's
    pin colour, not the walking line's dots.
  - **Trains:** the line badge; the boarding station with a platform chip;
    the line, then the operator mark and name; the train's type where it
    has one, then direction · stops · minutes (`Rapid toward Takao · 3 stops ·
    8 min`);
    how often the trains run and, where there is a timetable, the next one
    (`Every 5 min · next 10:07am`); the station you get off at.
  - **The stop count opens:** tapping `3 stops` lists the stations passed in
    between (Kanda, Ochanomizu), with their times where there is a timetable.
    It leaves out the station you board at and the one you get off at, which
    are already shown. Tapping again closes it.
  - **Tapping a train step** anywhere else opens its departures, as in Google
    Maps. There's no separate button: the step itself responds on hover and
    press so it reads as something to tap.
- **Fare:** one operator is one line: `[IC] IC card · [op] Tokyo Metro ¥209`.
  Several operators get a line each, then an `IC card` total.
- **Saving:** a **Use** button. Once used, it reads **Remove** at once, with
  "Saved to the trip for next time." underneath, while the hop is asked for
  again with the route saved; the hop keeps its trains meanwhile.
- **The map:**
  - **With a hop's options open**, the map draws that hop alone: the shown
    option in its line colours, with station dots, badges where you board,
    the exit badge, and walking labels (`3 min` and the walking icon). Other
    hops and the other options are not drawn; the cards switch between them.
  - **Hovering the shown route:** a train shows its badge and line, then
    from → to · minutes, then the operator · stops · frequency. A walk shows
    the exit and its minutes.
  - **Hovering a train route with no options open** thickens it and shows its
    badges and lines, then the destination · minutes · fare, then the changes
    and "click to show". Clicking opens that hop's options.

### Departures

- **Opening it:** by tapping a train step. On desktop it replaces
  the panel's content, with `‹ Train options` to go back. On the phone it is
  full screen with a back arrow.
- **The header:** the line badge, name and operator mark; `Tokyo → toward
  Ogikubo` with the platform chip.
- **Leave at:** a single time picker, with no Now button. It shows the
  current time until you change it. The picker is our own component, not the
  browser's, and is 12-hour.
- **Train types:** where a line runs more than one type (Local, Rapid,
  Special Rapid), each row shows its type. A train that doesn't stop where you
  get off is left out.
- **The list:** under `Leaves` and `Arrives` column labels, the next five
  trains you can still catch. Each shows when it leaves, `in N min` (only
  while the picker still shows the current time) and when you arrive at the
  destination. Tapping one selects it, and the first is selected to start.
- **More:** extends the list to the end of the service day, leaving out the
  last train, which always closes the list, below More (`Last train
  12:13am`, arriving `12:32am`).
- **Another day:** a trip on a later day shows that day's timetable, weekday
  or weekend, from the planned leaving time.
- **Where it exists:** only where there is a real timetable, which is Tokyo
  and the open regional feeds. Elsewhere the step says `Every ~N min`, and
  tapping it does nothing, so it doesn't respond as if it could be tapped.

### Badges and marks

- **Line badges:** a white badge with a ring in the line's colour and its
  letters. Round for subway and private lines (G, M, E), a rounded square for
  JR (JY, JC). Shinkansen gets a train icon in the line's colour. A line with
  no letters gets a bar in its colour and its short name.
- **Operator marks:** the operator's real logo from Wikimedia Commons where its
  licence allows, kept in the repo with its credit. Otherwise its initials on
  its colour (`TM`, `JR`).
- **The IC card icon** is a generic contactless card, not Suica or PASMO,
  which are trademarks.

## How it works

### Options

`/api/routes` keeps its current answer for transit and adds `options`, up to
four.

**Finding the options:**
1. Plan the fastest route, as now.
2. Re-plan once for each line it rides, with that line left out.
3. Re-plan once more with each change made costly, which gives the fewest
   changes.
4. Keep one option per distinct sequence of lines.
5. Drop any option slower than the fastest by more than the larger of
   15 minutes and 50%.

**Tagging them:**
- Fastest.
- Cheapest, only when every option's fare is known.
- The number of changes.
- JR only.

**What each option has:**
- `seconds`;
- `fare`: `{ total, parts: [{ operator, yen }] }`, or `null`;
- `legs`, each walk, wait or ride, with:
  - `minutes` and a polyline per leg, so each line is drawn in its own colour;
  - `line`: `{ id, name, code, colour, shape, operator }`;
  - `from`, `to`, `toward`, `type` and `every` (trains per hour, as minutes);
  - `stops`: the stations passed in between, each with its time where there is
    a timetable;
  - `next`: the next departure, where there is a timetable;
  - `platform` and `exit`, where known.

**Changes to the planners:**
- **Timetable (`lib/timetable`, CSA):** lines it may not use, a cost per
  change, and legs that carry stop counts, direction and frequency.
- **Model (`lib/railModel`, Dijkstra):** lines it may not use and a cost per
  change. Frequency comes from the service counts it already has.

### Departures

`/api/departures` takes `{ hop, option, leg, date, from }`. It returns the
departures from that leg's station, line and direction, from the given time to
the end of the service day (03:00), and the last train. Each departure comes
with its arrival at the destination, planned over the option's own lines, so
an option with a change gets the right arrival. "More" asks for the rest of
the day.

### Fares (`lib/fares`)

IC fares only, and never a guess. A fare that isn't known is not shown.

- **Open regional feeds:** their own GTFS fares (`fare_attributes` and
  `fare_rules`), packed into `open-rail.json` when it is built.
- **Tokyo:**
  - Tokyo Metro and Toei: their distance bands.
  - JR East: its fare table since 14 March 2026.
  - Tokyo Metro to Toei: a ¥70 transfer discount.
  - Distance is the sum of the along-line hops ridden on each operator.
  - Other private lines have no fare until their tables are added.
- **Elsewhere in Japan:** no fare at first.

### The saved route

- **Storage:** a new column, `activities.transit_pick jsonb`, holding
  `{ after: <previous activity id>, lines: [line ids] }`. Use sets it and
  Remove clears it. It belongs to the stop the hop arrives at, and is ignored
  once the stop before it changes, for example when the day is reordered.
- **Planning with it:** the option on the saved lines comes first, with fresh
  times. If those lines aren't running then, the fastest comes first, with a
  note.
- **Sharing:** it syncs to everyone on the trip like the rest of the activity.

### Exits and platforms

- **Exits in greater Tokyo** come with the timetables: mini-tokyo-3d lists
  each station's exits with their positions and names (`Exit A2`,
  `North Exit`), about 1,700 of them, mostly the subways' and the
  underground stations'. `build-tokyo` keeps them in `tokyo-rail.json`, and
  the walk off the last train leaves by the one nearest where you are going;
  the map draws that walk from the station through the exit.
- **Platforms, and exits elsewhere** come from OpenStreetMap
  (`scripts/transit/osm-stations.mjs`, from Overpass or the regional extracts
  `scripts/transit/osm-extract.py` reads): station entrances with a number
  or a side (`Exit 3`, `East Exit`), and each railway route's stops in order
  with the platform it uses there (`Platform 1 or 2` where it varies). They
  are in `data/transit/stations/<country>.json`, and `lib/stationDetails.js`
  fills a ride's platform (its line's route, the right way round) and the
  last walk's exit wherever the timetable has not. The Terms page credits
  OpenStreetMap (ODbL). Anything not known is not shown.

### Train types

The Tokyo timetable already gives every train its type (Local, Rapid, Chuo
Special Rapid…), and the planner passes it along with each train. The open
regional feeds keep a type where the feed has one, added when
`open-rail.json` is built. Elsewhere in Japan the estimate has no individual
trains, so no type.

### Line codes and colours

- **Codes:** a hand-kept table of station-numbering letters for greater Tokyo,
  and for the Osaka, Kyoto, Nagoya, Fukuoka and Sapporo subways.
- **Colours** for lines elsewhere come from Wikidata (P465), added to the
  existing Wikidata step of `build-japan`.

## Hosts needed

Each feature below is left out until its host is allowed. Everything else
ships without them.

- `overpass-api.de`: platforms, and exits outside greater Tokyo.
- `jreast.co.jp`: the JR East fare table.
- `commons.wikimedia.org` and `upload.wikimedia.org`: operator logos.

## Order of work

1. Options in both planners and the API, line codes and colours, and the
   12-hour rule.
2. The options panel on desktop and phone, the hop chip, the map drawing and
   tooltips, and the bar tooltips.
3. Departures and the time picker.
4. The saved route: the migration, Use and Remove, and the planner preferring
   it.
5. Fares: the regional feeds, then Tokyo Metro and Toei, then JR East.
6. Exits, platforms and operator logos, as their hosts allow.

## Testing

- **Unit tests:**
  - options: each option has a different line sequence, a left-out line is
    never used, and the tags are right;
  - fares: the edges of each band, the transfer discount, and an unknown fare
    giving `null`;
  - departures: only catchable trains, "More", the last train and the service
    day past midnight;
  - 12-hour formatting;
  - the saved route: matching it, and dropping it after a reorder.
- **In the browser:** a seeded trip with a Tokyo hop, a Kyoto hop and a
  Kumamoto tram, at desktop and phone widths.

## Not in this

- Live delays.
- Which car is nearest the exit.
- A JR Pass setting.
- Buses and ferries.
