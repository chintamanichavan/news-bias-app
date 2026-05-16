import type { Metadata } from 'next'
import localFont from 'next/font/local'
import './globals.css'
import { Toaster } from 'sonner'
import Link from 'next/link'
import ThemeToggle from '@/components/ThemeToggle'

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

export const metadata: Metadata = {
  title: 'ClearLens — Unbiased News',
  description: 'Read the news with political bias clearly shown.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={geistSans.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body className="font-sans antialiased bg-background text-foreground min-h-screen overflow-x-hidden">
        <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 min-w-0">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight shrink-0">
              <span className="text-primary">ClearLens</span>
              <span className="text-xs font-normal text-muted-foreground hidden sm:inline">
                Bias-aware news
              </span>
            </Link>
            <nav
              className="flex items-center gap-1 text-sm flex-nowrap overflow-x-auto min-w-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]"
            >
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                ⭐ Top
              </Link>
              <Link
                href="/digest"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                ⚡ Digest
              </Link>
              <Link
                href="/feed"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                All
              </Link>
              <Link
                href="/signals"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                🎯 Signals
              </Link>
              <Link
                href="/stories"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                Same Story
              </Link>
              <Link
                href="/markets"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                📈 Markets
              </Link>
              <Link
                href="/weather"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                🌤️ Weather
              </Link>
              <Link
                href="/stats"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
              >
                Model Stats
              </Link>
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main>{children}</main>
        <Toaster richColors position="bottom-right" />
      </body>
    </html>
  )
}
