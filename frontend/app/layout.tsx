import type { Metadata } from 'next'
import localFont from 'next/font/local'
import { Newsreader } from 'next/font/google'
import './globals.css'
import { Toaster } from 'sonner'
import TopNav from '@/components/TopNav'

// Runs before React hydrates → no flash-of-wrong-theme.
const themeBootScript = `
  try {
    var t = localStorage.getItem('theme') || 'system';
    var dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {}
`

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-sans',
  weight: '100 900',
})

// Editorial serif for headlines + article body. Newsreader is the open-source
// font closest in feel to Apple's New York / NYT editorial serifs — designed
// specifically for news-style display + reading sizes.
const newsreader = Newsreader({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  display: 'swap',
  variable: '--font-serif',
})

export const metadata: Metadata = {
  title: 'ClearLens — Unbiased News',
  description: 'Read the news with political bias clearly shown.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${newsreader.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen overflow-x-hidden">
        <TopNav />
        <main>{children}</main>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
