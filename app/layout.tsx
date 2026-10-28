import type { Metadata, Viewport } from 'next';
import { Inter, Newsreader } from 'next/font/google';
import { Suspense } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteFooter, SiteHeader } from '@/components/site';
import { FeedbackWidget, FlashMessages } from '@/components/site-client';
import { currentUser, flag } from '@/lib/server';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const newsreader = Newsreader({ subsets: ['latin'], variable: '--font-newsreader', display: 'swap', style: ['normal', 'italic'] });

export const metadata: Metadata = {
  title: { default: 'RentAPlace', template: '%s · RentAPlace' },
  description: 'Thoughtful homes. Memorable little escapes. Find your next place with RentAPlace.',
  icons: { icon: [{ url: '/img/brand/favicon-32.png', sizes: '32x32', type: 'image/png' }], apple: '/img/brand/apple-touch-icon.png' },
};

export const viewport: Viewport = { themeColor: '#214c40' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en" className={`${inter.variable} ${newsreader.variable}`}>
      <body className="flex min-h-svh flex-col">
        <TooltipProvider>
          <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">Skip to content</a>
          <SiteHeader user={user} />
          <main id="main" className="flex-1">{children}</main>
          <SiteFooter />
          <Suspense>
            <FlashMessages />
            {flag('guest_feedback') ? <FeedbackWidget /> : null}
          </Suspense>
          <Toaster position="bottom-left" richColors closeButton />
        </TooltipProvider>
      </body>
    </html>
  );
}
