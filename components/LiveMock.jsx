'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * The hero preview, planning itself.
 *
 * The headline promises "describe the trip, get the plan", and a still
 * screenshot beside it asks you to take that on faith. So this does the thing:
 * a day fills in stop by stop, a sentence gets typed into the add line, and
 * the stop it describes appears. Then the day clears and a different city
 * takes its turn.
 *
 * Every scene holds four rows whether they are showing or not, so the card
 * keeps one height and the page never reflows underneath it — rows fade and
 * lift rather than being added and removed, which is also what gives them an
 * exit as well as an entrance.
 *
 * It runs only while on screen, and not at all for prefers-reduced-motion,
 * where it simply shows a finished day.
 */

const SCENES = [
  {
    id: 'jp',
    title: 'Japan, December',
    day: 'Day 3',
    date: 'Fri, 4 Dec',
    prompt: 'teamLab Planets, late afternoon',
    rows: [
      { time: '9am', title: 'Senso-ji temple', meta: 'Sightseeing · Asakusa', cat: 'sightseeing', cost: '' },
      { time: '1:30pm', title: 'Ichiran ramen', meta: 'Food & drink · Shibuya', cat: 'food', cost: '¥1,800' },
      { time: '7:40pm', title: 'Shinkansen to Nagoya', meta: 'Transport · Tokyo Station', cat: 'transport', cost: '¥11,300' },
      { time: '4pm', title: 'teamLab Planets', meta: 'Activity · Toyosu', cat: 'activity', cost: '¥3,800' },
    ],
  },
  {
    id: 'pt',
    title: 'Portugal, May',
    day: 'Day 2',
    date: 'Tue, 6 May',
    prompt: 'fado in Alfama, after dinner',
    rows: [
      { time: '10am', title: 'Tram 28 to Graça', meta: 'Transport · Martim Moniz', cat: 'transport', cost: '€3' },
      { time: '12:30pm', title: 'Time Out Market', meta: 'Food & drink · Cais do Sodré', cat: 'food', cost: '€22' },
      { time: '5pm', title: 'Miradouro da Graça', meta: 'Sightseeing · Graça', cat: 'sightseeing', cost: '' },
      { time: '9:30pm', title: 'Fado at Mesa de Frades', meta: 'Activity · Alfama', cat: 'activity', cost: '€45' },
    ],
  },
  {
    id: 'kr',
    title: 'Seoul, October',
    day: 'Day 5',
    date: 'Sat, 11 Oct',
    prompt: 'Namsan at sunset',
    rows: [
      { time: '9:30am', title: 'Gyeongbokgung', meta: 'Sightseeing · Jongno', cat: 'sightseeing', cost: '₩3,000' },
      { time: '1pm', title: 'Tosokchon samgyetang', meta: 'Food & drink · Sejongno', cat: 'food', cost: '₩20,000' },
      { time: '3pm', title: 'Bukchon Hanok Village', meta: 'Sightseeing · Gahoe-dong', cat: 'sightseeing', cost: '' },
      { time: '6:10pm', title: 'Namsan cable car', meta: 'Activity · Namsan', cat: 'activity', cost: '₩14,000' },
    ],
  },
];

const BUILD = 560; // between the rows that arrive on their own
const TYPE = 34; // per character
const SETTLE = 2100; // how long a finished day is left to be read

export default function LiveMock() {
  const [scene, setScene] = useState(0);
  const [shown, setShown] = useState(0);
  const [typed, setTyped] = useState('');
  const [typing, setTyping] = useState(false);
  const [active, setActive] = useState(false);
  const [still, setStill] = useState(false);
  const ref = useRef(null);
  const timers = useRef([]);

  // Only animate while it is actually being looked at.
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (typeof window !== 'undefined'
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true);
      setShown(4);
      return undefined;
    }
    if (typeof IntersectionObserver === 'undefined') { setActive(true); return undefined; }
    const io = new IntersectionObserver(
      ([e]) => setActive(e.isIntersecting),
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (still || !active) return undefined;
    let alive = true;

    const sleep = (ms) => new Promise((done) => {
      const t = setTimeout(done, ms);
      timers.current.push(t);
    });

    (async () => {
      // Pick up from whichever scene was showing when it left the viewport.
      for (let i = scene; alive; i = (i + 1) % SCENES.length) {
        const s = SCENES[i];
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

        // Then you ask for one more, in words.
        setTyping(true);
        await sleep(520); if (!alive) return;
        for (let c = 1; c <= s.prompt.length; c += 1) {
          setTyped(s.prompt.slice(0, c));
          await sleep(TYPE); if (!alive) return;
        }
        await sleep(460); if (!alive) return;

        setTyped('');
        setTyping(false);
        setShown(4);
        await sleep(SETTLE); if (!alive) return;

        // And the day steps aside for the next city.
        setShown(0);
        await sleep(760); if (!alive) return;
      }
    })();

    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
    // `scene` is read once as a starting point; adding it would restart the
    // loop on every step it takes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [still, active]);

  const s = SCENES[scene];

  return (
    <div className="mock" ref={ref}>
      <div className="mock-bar">
        <span className="mock-dot" /><span className="mock-dot" /><span className="mock-dot" />
        <span className="mock-title" key={s.id}>{s.title}</span>
      </div>
      <div className="mock-body">
        <div className="mock-dayhead">
          <span className="day-num">{s.day}</span>
          <span className="mock-daydate">{s.date}</span>
          <span className="today-badge">Today</span>
        </div>

        {s.rows.map((r, i) => (
          <div
            className="mock-act"
            key={`${s.id}-${r.title}`}
            data-state={i < shown ? 'in' : 'out'}
            style={{ transitionDelay: `${i * 40}ms` }}
          >
            <span className="mock-time">{r.time}</span>
            <span className="mock-main">
              <span className="mock-name">
                <span className={`dot cat-${r.cat}`} />{r.title}
              </span>
              <span className="mock-meta">{r.meta}</span>
            </span>
            {r.cost ? <span className="mock-cost">{r.cost}</span> : null}
          </div>
        ))}

        {/* Once the caret is up the hint has to go, or the placeholder looks
            like the thing being typed. */}
        <div className="mock-add" data-typing={typing ? 'yes' : 'no'}>
          {typing ? typed : (still ? 'Add to the day — try “9am Senso-ji”' : (
            <span className="mock-hint">Add anything, in your own words</span>
          ))}
          {typing ? <span className="mock-caret" aria-hidden="true" /> : null}
        </div>
      </div>
    </div>
  );
}
