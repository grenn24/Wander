import { Plus_Jakarta_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import ViewportInsets from '@/components/ViewportInsets';
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

export const metadata = {
  title: 'Wander — travel itinerary planner',
  description: 'Plan trips day by day: timeline, map, budget, packing list. Live collaboration.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fcfcfb' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1a19' },
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
      </body>
    </html>
  );
}
