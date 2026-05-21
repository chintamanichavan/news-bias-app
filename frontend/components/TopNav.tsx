'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import ThemeToggle from '@/components/ThemeToggle'

const NAV_ITEMS: { href: string; label: string }[] = [
  { href: '/',        label: 'Top' },
  { href: '/digest',  label: 'Digest' },
  { href: '/feed',    label: 'Feed' },
  { href: '/stories', label: 'Same Story' },
  { href: '/markets', label: 'Markets' },
  { href: '/weather', label: 'Weather' },
  { href: '/stats',   label: 'Stats' },
]

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function TopNav() {
  const pathname = usePathname() ?? '/'
  // Hairline divider only appears after the user has scrolled — mimics
  // macOS toolbars where the separator is dynamic.
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <header className={`sticky top-0 z-50 bg-background/80 backdrop-blur-xl supports-[backdrop-filter]:bg-background/65 transition-shadow ${scrolled ? 'shadow-[0_1px_0_0_hsl(var(--border))]' : ''}`}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-3 min-w-0">
        <Link
          href="/"
          className="flex items-baseline gap-1 font-bold text-[19px] tracking-tight shrink-0"
        >
          <span>ClearLens</span>
          <span className="text-[10px] uppercase tracking-[0.18em] text-[hsl(var(--accent-news))] font-semibold relative -top-px">News</span>
        </Link>
        <nav
          className="flex items-center gap-0.5 text-[13px] flex-nowrap overflow-x-auto min-w-0 [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]"
        >
          {NAV_ITEMS.map(item => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={[
                  'relative px-3 py-1.5 rounded-full transition-colors shrink-0 whitespace-nowrap font-medium',
                  active
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {item.label}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-1/2 -translate-x-1/2 -bottom-[12px] h-[2px] w-6 rounded-full"
                    style={{ background: 'hsl(var(--accent-news))' }}
                  />
                )}
              </Link>
            )
          })}
          <div className="ml-1 shrink-0">
            <ThemeToggle />
          </div>
        </nav>
      </div>
    </header>
  )
}
