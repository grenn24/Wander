import { fileURLToPath } from 'node:url';
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  eslint: { ignoreDuringBuilds: true },
  // AVIF first: the landing atlas is the heaviest thing the site serves, and
  // AVIF carries that kind of soft, flat artwork at a fraction of WebP.
  // `qualities` lists the ones asked for, which Next 16 will insist on.
  images: { formats: ['image/avif', 'image/webp'], qualities: [60, 75] },
  // Guides were journeys until September 2026, and a page that has been read,
  // linked or indexed under the old address should still open.
  async redirects() {
    return [
      { source: '/journeys', destination: '/guides', permanent: true },
      { source: '/journeys/:slug', destination: '/guides/:slug', permanent: true },
      // Share links used to live at /?join=<code>. Doing it here rather than in
      // the landing page, which would have to read the query string and so be
      // built again for every visitor instead of once. Next carries the old
      // query along (/join/<code>?join=<code>), which the join page ignores.
      {
        source: '/',
        has: [{ type: 'query', key: 'join', value: '(?<code>.+)' }],
        destination: '/join/:code',
        permanent: false,
      },
    ];
  },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
};
export default nextConfig;
