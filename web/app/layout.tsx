import type { Metadata } from 'next';
import { Instrument_Serif, Inter, JetBrains_Mono, Syne } from 'next/font/google';
import './globals.css';
import { Frame } from '@/components/primitives';
import { SiteFooter } from '@/components/SiteFooter';

/*
 * Self-hosted through next/font rather than a <link> to Google's CDN: it
 * removes a third-party request from every page load and the render-blocking
 * stylesheet with it. The CSS variables are consumed by the @theme block in
 * globals.css.
 */
const instrumentSerif = Instrument_Serif({
  subsets: ['latin'],
  weight: '400',
  display: 'swap',
  variable: '--font-instrument-serif',
});

const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

const syne = Syne({
  subsets: ['latin'],
  weight: ['700', '800'],
  display: 'swap',
  variable: '--font-syne',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-jetbrains-mono',
});

export const metadata: Metadata = {
  title: {
    default: 'Encode — the agent that fixes what breaks, paid per incident',
    template: '%s · Encode',
  },
  description:
    'Encode diagnoses a real incident in your repo, drafts a patch, runs your tests against it, and opens a PR. One payment, quoted up front, settled on Celo over x402.',
  openGraph: {
    title: 'Encode — the agent that fixes what breaks, paid per incident',
    description:
      'Automated incident diagnosis and repair, priced per incident and settled in stablecoins over x402 on Celo. It opens a PR; it never merges and never deploys.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body
        className={`${instrumentSerif.variable} ${inter.variable} ${syne.variable} ${jetbrainsMono.variable}`}
      >
        {/* First focusable thing on the page, and visible only once focused. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-0 focus:top-0 focus:z-20 focus:bg-ink focus:px-4 focus:py-2.5 focus:text-[0.85rem] focus:text-white"
        >
          Skip to content
        </a>

        <Frame>
          {children}
          <SiteFooter />
        </Frame>
      </body>
    </html>
  );
}
