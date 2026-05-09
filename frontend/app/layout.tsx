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
      <body className="font-sans antialiased bg-background text-foreground min-h-screen">
        <header className="sticky top-0 z-50 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2 font-bold text-lg tracking-tight">
              <span className="text-primary">ClearLens</span>
              <span className="text-xs font-normal text-muted-foreground hidden sm:inline">
                Bias-aware news
              </span>
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                ⭐ Top
              </Link>
              <Link
                href="/feed"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                All
              </Link>
              <Link
                href="/signals"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                🎯 Signals
              </Link>
              <Link
                href="/stories"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                Same Story
              </Link>
              <Link
                href="/markets"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                📈 Markets
              </Link>
              <Link
                href="/weather"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
              >
                🌤️ Weather
              </Link>
              <Link
                href="/stats"
                className="px-3 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
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
