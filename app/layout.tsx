import type { Metadata } from 'next';
import { Manrope, Geist_Mono } from 'next/font/google';
import './globals.css';

const manrope = Manrope({
  variable: '--font-manrope',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: 'Devansh Sureka — Blog Automation Dashboard',
  description: 'Live blog counts by automation variation, with record-level publishing details.',
  openGraph: {
    title: 'Devansh Sureka — Blog Automation Dashboard',
    description: 'All Univest blog automation systems in one live view.',
    images: [{ url: '/og.png', width: 1680, height: 945, alt: 'BlogDesk editorial operations dashboard' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Devansh Sureka — Blog Automation Dashboard',
    description: 'All Univest blog automation systems in one live view.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${manrope.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
