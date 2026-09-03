import { Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import ViewportInsets from '@/components/ViewportInsets';
import Tips from '@/components/Tips';
import './globals.css';

/*
 * Three faces, each doing one job.
 *
 * next/font self-hosts them at build time, so there is no request to Google at
 * runtime and no flash of unstyled text — the metrics are known before the
 * page paints.
 */

// Interface and body. Warmer and rounder than the system stack without giving
// up legibility in the dense itinerary rows.
const sans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-sans',
});

// The big moments only — the landing headline, page titles, trip names. An
// editorial serif is what makes a travel page feel like a travel page.
const serif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
});

// Times, costs and booking references. Real tabular figures matter here: the
// time column is read as a vertical axis, so digits have to line up.
const mono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono',
});

/*
 * Proving to Google that this site is ours.
 *
 * Search Console will take either a meta tag or a file at the root. The tag is
 * the easier of the two to deploy — one environment variable, no rebuild of
 * anything else — and it has to be on the homepage specifically, which is why
 * it lives in the root layout rather than on a page.
 *
 * Set GOOGLE_SITE_VERIFICATION to the content value Search Console gives you;
 * without it nothing is emitted.
 */
const VERIFY = process.env.GOOGLE_SITE_VERIFICATION || '';

export const metadata = {
  title: 'Wander — travel itinerary planner',
  description: 'Plan trips day by day: timeline, map, budget, packing list. Live collaboration.',
  ...(VERIFY && !VERIFY.startsWith('REPLACE_WITH')
    ? { verification: { google: VERIFY } } : {}),
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbf8f1' },
    { media: '(prefers-color-scheme: dark)', color: '#201d18' },
  ],
};

const themeScript = `try{var t=localStorage.getItem('tp.theme');if(t){document.documentElement.setAttribute('data-theme',t)}}catch(e){}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <ViewportInsets />
        {children}
        {/* One tooltip for the whole app, at the root so the landing page has
            it too — it is outside the provider that wraps everything else. */}
        <Tips />
      </body>
    </html>
  );
}
