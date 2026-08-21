'use client';

/**
 * What the app shows while it is fetching something.
 *
 * A plane flying a route it draws behind it — the same shape as the brand
 * mark, and a picture of what the app is for. A spinner would say "busy"; this
 * says "busy with a trip", which is the only thing this app is ever busy with.
 *
 * The path is defined once and used for both the drawn line and the plane's
 * offset-path, so the plane cannot drift off the route it is drawing.
 *
 * `label` is announced to screen readers, so it should say what is being
 * waited for rather than "loading".
 */

const PATH = 'M9,42 C38,4 80,6 111,24';

export default function Loading({ label = 'Loading', full = false, className = '' }) {
  return (
    <div className={`loader${full ? ' loader-full' : ''}${className ? ` ${className}` : ''}`}
      role="status" aria-live="polite">
      <svg className="loader-art" viewBox="0 0 120 52" aria-hidden="true">
        {/* Where the route goes... */}
        <path className="loader-track" d={PATH} />
        {/* ...and how far along it we are. */}
        <path className="loader-trail" d={PATH} pathLength="1" />
        <circle className="loader-pin" cx="9" cy="42" r="3.2" />
        <circle className="loader-pin loader-pin-to" cx="111" cy="24" r="3.2" />
        <g className="loader-plane" style={{ offsetPath: `path("${PATH}")` }}>
          <path d="M-5,-4.5 L7,0 L-5,4.5 L-2.2,0 Z" />
        </g>
      </svg>
      <span className="loader-label">{label}</span>
    </div>
  );
}
