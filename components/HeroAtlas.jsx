import Image from 'next/image';

/**
 * The hero's paper map. Still: the one thing on the page that moves is the day
 * being planned beside it (HeroSheet), and a map that also drew its own routes
 * would be two things competing for the same glance.
 *
 * Decorative, so it is hidden from assistive technology and from print, and it
 * is a server component — nothing here needs a script.
 */
export default function HeroAtlas() {
  return (
    <div className="lp-atlas" aria-hidden="true">
      {/*
        * The heaviest thing on the page, so it goes through next/image: cut to
        * the width of the screen asking and served as AVIF where that is
        * understood, rather than 186 kB of full-width WebP to a phone. It is
        * what the eye lands on with the headline, so it is not deferred.
        */}
      <Image className="lp-atlas-paper" src="/artwork/hero-atlas.webp" width={1920} height={1086}
        sizes="100vw" quality={60} priority alt="" draggable={false} />
      {/* One route, along the edge where the map has detail and the copy does not. */}
      <svg className="lp-atlas-routes" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice" focusable="false">
        <g>
          <path d="M 1220 65 C 1270 175 1405 130 1450 235 S 1370 440 1520 590" />
          <circle cx="1220" cy="65" r="5" /><circle cx="1450" cy="235" r="5" /><circle cx="1520" cy="590" r="5" />
        </g>
      </svg>
    </div>
  );
}
