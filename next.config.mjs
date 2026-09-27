import { fileURLToPath } from 'node:url';
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  eslint: { ignoreDuringBuilds: true },
  // AVIF first: the landing atlas is the heaviest thing the site serves, and
  // AVIF carries that kind of soft, flat artwork at a fraction of WebP.
  images: { formats: ['image/avif', 'image/webp'] },
  // Guides were journeys until September 2026, and a page that has been read,
  // linked or indexed under the old address should still open.
  async redirects() {
    return [
      { source: '/journeys', destination: '/guides', permanent: true },
      { source: '/journeys/:slug', destination: '/guides/:slug', permanent: true },
    ];
  },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
};
export default nextConfig;
