import { fileURLToPath } from 'node:url';
/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  eslint: { ignoreDuringBuilds: true },
  // AVIF first: the landing atlas is the heaviest thing the site serves, and
  // AVIF carries that kind of soft, flat artwork at a fraction of WebP.
  images: { formats: ['image/avif', 'image/webp'] },
  async headers() {
    return [{ source: '/sw.js', headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }] }];
  },
};
export default nextConfig;
