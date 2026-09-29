'use client';
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

/**
 * The hero's answer to its own headline, doing the job.
 *
 * "Describe the trip, get the plan" asks to be taken on faith, and the three
 * things the line beneath it promises — every day laid out, mapped, and the
 * cost totalled — are exactly what this shows happening: a day fills in stop by
 * stop, a pin drops on the map for each and the route draws to it, and the day's
 * total follows. Then a sentence is typed into the add line and the stop it
 * describes joins the day. Then the day steps aside for a different city.
 *
 * It is drawn finished. What the server sends, and what anyone sees who has
 * asked for less motion or has no script, is a complete day with a map — not an
 * empty card waiting for JavaScript to fill it. Once the page is up and the
 * sheet is on screen it leaves that day to be read, then steps aside for the
 * next city and builds it from nothing, asking for its last stop in words.
 *
 * Every scene holds four stops whether they are showing or not, so the card
 * keeps one height and the page never reflows beneath it — stops fade and lift
 * rather than being added and removed, which is also what gives them an exit.
 *
 * It runs only while on screen and in a visible tab, and it can be paused: it
 * starts on its own and goes on for longer than anyone needs to read it, which
 * is the case for a control.
 */

// The route runs through these in order; `at` is where each sits on the map,
// which is drawn 480 wide by 128 tall. Kept within x 90–390 because the map is
// cropped, not squashed, on a narrow card. The last stop of each is the one
// that is asked for in words (`ask`).
const SCENES = [
  {
    id: 'jp', place: 'Japan, December', day: 'Day 3', date: 'Fri 4 Dec', symbol: '¥',
    stops: [
      { time: '9:00 am', name: 'Senso-ji temple', meta: 'Sightseeing, Asakusa', cost: 0, at: [300, 30] },
      { time: '11:30 am', name: 'Tsukiji Outer Market', meta: 'Food and drink, Tsukiji', cost: 2500, at: [238, 72] },
      { time: '2:00 pm', name: 'teamLab Planets', meta: 'Activity, Toyosu', cost: 3800, at: [322, 100] },
      { time: '6:30 pm', name: 'Ichiran ramen', meta: 'Food and drink, Shibuya', cost: 1800, at: [142, 88], ask: 'Ramen in Shibuya after dark' },
    ],
  },
  {
    id: 'pt', place: 'Portugal, May', day: 'Day 2', date: 'Tue 6 May', symbol: '€',
    stops: [
      { time: '9:30 am', name: 'Pastéis de Belém', meta: 'Food and drink, Belém', cost: 6, at: [112, 86] },
      { time: '1:00 pm', name: 'Time Out Market', meta: 'Food and drink, Cais do Sodré', cost: 22, at: [204, 80] },
      { time: '5:00 pm', name: 'Miradouro de Santa Luzia', meta: 'Sightseeing, Alfama', cost: 0, at: [300, 46] },
      { time: '9:30 pm', name: 'Fado at Mesa de Frades', meta: 'Activity, Alfama', cost: 45, at: [340, 72], ask: 'Fado in Alfama, after dinner' },
    ],
  },
  {
    id: 'kr', place: 'Seoul, October', day: 'Day 5', date: 'Sat 11 Oct', symbol: '₩',
    stops: [
      { time: '9:30 am', name: 'Gyeongbokgung', meta: 'Sightseeing, Jongno', cost: 3000, at: [252, 28] },
      { time: '12:30 pm', name: 'Tosokchon samgyetang', meta: 'Food and drink, Sejongno', cost: 20000, at: [206, 52] },
      { time: '3:00 pm', name: 'Bukchon Hanok Village', meta: 'Sightseeing, Gahoe-dong', cost: 0, at: [298, 48] },
      { time: '6:10 pm', name: 'Namsan cable car', meta: 'Activity, Namsan', cost: 14000, at: [268, 100], ask: 'Namsan at sunset' },
    ],
  },
];

const BUILD = 520; // between the stops that arrive on their own
const TYPE = 38; // per character
const HOLD = 2600; // a finished day, left to be read before anything is added
const SETTLE = 2400; // the same, once the fourth stop is in

/** A gentle bend between two pins, so the route reads as travelled, not ruled. */
function leg([ax, ay], [bx, by], flip) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  const bend = Math.min(16, len * 0.18) * (flip ? -1 : 1);
  const cx = (ax + bx) / 2 + (-dy / len) * bend;
  const cy = (ay + by) / 2 + (dx / len) * bend;
  return `M ${ax} ${ay} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${bx} ${by}`;
}

const money = (symbol, n) => `${symbol}${n.toLocaleString('en-US')}`;

export default function HeroSheet() {
  const [scene, setScene] = useState(0);
  const [shown, setShown] = useState(4); // stops on the sheet: all four when it arrives
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(false); // on screen, in a visible tab, motion allowed
  const [paused, setPaused] = useState(false);
  const rootRef = useRef(null);
  // Where the loop picks up after a pause or a scroll away: which scene, and
  // whether the sheet is empty, showing three stops, or showing all four. It is
  // showing all four when the page arrives.
  const at = useRef({ scene: 0, phase: 'four' });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let visible = false;
    const update = () => {
      setActive(visible && !media.matches && document.visibilityState !== 'hidden');
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    }, { threshold: 0.3 });
    observer.observe(el);
    media.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      observer.disconnect();
      media.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);

  useEffect(() => {
    if (!active || paused) return undefined;
    let alive = true;
    const timers = new Set();
    const sleep = (ms) => new Promise((done) => {
      const t = setTimeout(() => { timers.delete(t); done(); }, ms);
      timers.add(t);
    });

    (async () => {
      let { scene: i, phase } = at.current;
      // A sheet that was already showing its day when this began — as it is on
      // arrival, or after a pause — is given a moment to be read first.
      let fresh = false;
      while (alive) {
        const s = SCENES[i];

        if (phase === 'empty') {
          setScene(i);
          setShown(0);
          setTyped('');
          setTyping(false);
          await sleep(460); if (!alive) return;
          // The day fills in, one stop at a time.
          for (let r = 1; r <= 3; r += 1) {
            setShown(r);
            await sleep(BUILD); if (!alive) return;
          }
          phase = 'three';
          at.current = { scene: i, phase };
          fresh = true;
        }

        if (phase === 'three') {
          // Then you ask for one more, in words.
          setTyped('');
          setTyping(false);
          await sleep(fresh ? 380 : HOLD); if (!alive) return;
          const ask = s.stops[3].ask;
          setTyping(true);
          await sleep(420); if (!alive) return;
          for (let c = 1; c <= ask.length; c += 1) {
            setTyped(ask.slice(0, c));
            await sleep(TYPE); if (!alive) return;
          }
          await sleep(420); if (!alive) return;
          setTyped('');
          setTyping(false);
          setShown(4);
          phase = 'four';
          at.current = { scene: i, phase };
        }

        // And the day steps aside for the next city. Recorded before the wait,
        // so a pause in the middle of it does not resume onto an empty sheet
        // believing it is a full one.
        await sleep(SETTLE); if (!alive) return;
        setShown(0);
        i = (i + 1) % SCENES.length;
        phase = 'empty';
        at.current = { scene: i, phase };
        fresh = false;
        await sleep(700); if (!alive) return;
      }
    })();

    return () => {
      alive = false;
      timers.forEach(clearTimeout);
    };
  }, [active, paused]);

  const s = SCENES[scene];
  const total = s.stops.slice(0, shown).reduce((sum, stop) => sum + stop.cost, 0);

  return (
    <div className="lp-hero-visual">
      <div className="lp-sheet" ref={rootRef} role="img"
        aria-label="An example day plan: a map with numbered stops, the time and cost of each, and the day's total.">
        <div className="lp-sheet-head">
          <span className="lp-sheet-place" key={s.id}>{s.place}</span>
          <span className="lp-sheet-day">{s.day}, {s.date}</span>
        </div>

        <svg className="lp-sheet-map" viewBox="0 0 480 128" preserveAspectRatio="xMidYMid slice" focusable="false">
          <path className="lp-map-park" d="M30 34 C 40 14 92 10 112 24 C 128 36 108 56 78 58 C 50 60 22 50 30 34 Z" />
          <path className="lp-map-park" d="M368 44 C 378 26 424 22 442 36 C 458 48 440 68 410 70 C 384 72 358 60 368 44 Z" />
          <path className="lp-map-water" d="M0 110 C 70 96 140 122 226 106 S 390 90 480 104 L480 128 L0 128 Z" />
          <path className="lp-map-road" d="M0 30 C 120 24 200 46 300 34 S 430 22 480 30" />
          <path className="lp-map-road" d="M120 0 C 128 40 112 80 124 128" />
          <path className="lp-map-road" d="M250 0 C 240 44 262 84 252 128" />
          <path className="lp-map-street" d="M0 78 C 100 70 180 90 270 76 S 420 66 480 72" />
          <path className="lp-map-street" d="M360 0 C 372 40 352 84 366 128" />
          <path className="lp-map-street" d="M170 0 C 176 30 164 62 172 100" />
          <path className="lp-map-street" d="M300 0 C 296 34 310 70 302 108" />
          <g key={s.id}>
            {s.stops.slice(0, -1).map((stop, i) => (
              <path key={`leg-${i}`} className="lp-map-leg" pathLength="1"
                d={leg(stop.at, s.stops[i + 1].at, i % 2 === 1)} data-on={i + 1 < shown} />
            ))}
            {s.stops.map((stop, i) => (
              <g key={`pin-${i}`} transform={`translate(${stop.at[0]} ${stop.at[1]})`}>
                <g className="lp-map-pin" data-on={i < shown}>
                  <circle r="11" />
                  <text>{i + 1}</text>
                </g>
              </g>
            ))}
          </g>
        </svg>

        <div className="lp-sheet-stops">
          {s.stops.map((stop, i) => (
            <div className="lp-stop" key={`${s.id}-${i}`} data-state={i < shown ? 'in' : 'out'}>
              <span className="lp-stop-time">{stop.time}</span>
              <span className="lp-stop-n">{i + 1}</span>
              <span className="lp-stop-main">
                <span className="lp-stop-name">{stop.name}</span>
                <span className="lp-stop-meta">{stop.meta}</span>
              </span>
              <span className="lp-stop-cost">{stop.cost ? money(s.symbol, stop.cost) : ''}</span>
            </div>
          ))}
        </div>

        <div className="lp-sheet-foot">
          {/* Once the caret is up the hint has to go, or the placeholder looks
              like the thing being typed. */}
          <div className="lp-ask" data-typing={typing ? 'yes' : 'no'}>
            {typing ? typed : 'Add anything, in your own words'}
            {typing ? <span className="lp-caret" aria-hidden="true" /> : null}
          </div>
          <div className="lp-total">
            <span>Day total</span>
            <b>{shown ? money(s.symbol, total) : '—'}</b>
          </div>
        </div>
      </div>

      {/* Outside the picture, because a control cannot live inside something
          hidden from assistive technology. Where less motion is asked for
          there is nothing to pause, and CSS puts it away (app/landing.css). */}
      <button className="lp-pause" type="button" onClick={() => setPaused((p) => !p)}>
        {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
        {paused ? 'Play animation' : 'Pause animation'}
      </button>
    </div>
  );
}
