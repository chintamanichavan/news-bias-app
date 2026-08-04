'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useHorizontalRail } from '@/lib/useHorizontalRail'
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
  { href: '/insights', label: 'Insights' },
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

  // The tab strip overflows below ~1024px with its scrollbar hidden, so the
  // trailing tabs (Weather, Insights, Stats) are off-screen with nothing to
  // suggest they exist — and, on a desktop mouse, no way to reach them. The
  // shared rail hook supplies wheel, drag and the edge state behind the fades;
  // centring the active tab is TopNav's own.
  const rail = useHorizontalRail<HTMLElement>()
  const stripRef = useRef<HTMLElement | null>(null)
  const centered = useRef(false)
  const edges = { left: rail.canLeft, right: rail.canRight }

  // Stable identity: an inline arrow would be a new ref callback every render,
  // so React would detach and re-attach the node, re-running the hook's effect
  // and rebinding every listener on each pass.
  const setStrip = useCallback((el: HTMLElement | null) => {
    stripRef.current = el
    rail.ref(el)
  }, [rail.ref])   // eslint-disable-line react-hooks/exhaustive-deps

  /** Scroll the current tab to the middle of the strip. */
  const centerActive = useCallback((behavior: ScrollBehavior) => {
    const el = stripRef.current
    const active = el?.querySelector<HTMLElement>('[data-active="true"]')
    if (!el || !active) return
    // Rect deltas, not offsetLeft — the positioned wrapper is the offsetParent,
    // so offsetLeft would be measured from the wrong origin.
    const strip = el.getBoundingClientRect()
    const tab = active.getBoundingClientRect()
    const target = el.scrollLeft + (tab.left - strip.left) - (el.clientWidth - tab.width) / 2
    el.scrollTo({ left: Math.max(0, target), behavior })
  }, [])

  useEffect(() => {
    const el = stripRef.current
    if (!el) return
    // The strip's real width only exists after the flex row settles and fonts
    // load. Measuring once on mount reads the pre-layout width, which makes
    // centring a no-op — so re-run on every reflow, and re-centre until the
    // strip has actually reached its final width.
    const ro = new ResizeObserver(() => {
      // Wait for the strip to actually become scrollable before centring —
      // firing on the first reflow burns the attempt while scrollWidth still
      // equals clientWidth, which is why a heavy page like /weather used to
      // load with its own tab off-screen.
      if (!centered.current && el.scrollWidth > el.clientWidth) {
        centered.current = true
        centerActive('auto')
      }
    })
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => ro.disconnect()
  }, [centerActive])

  // Landing directly on /weather should not leave its own tab off-screen.
  useEffect(() => {
    centered.current = false
    const id = requestAnimationFrame(() => {
      const el = stripRef.current
      if (el && el.scrollWidth > el.clientWidth) {
        centered.current = true
        centerActive('smooth')
      }
    })
    return () => cancelAnimationFrame(id)
  }, [pathname, centerActive])
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
        <div className="relative flex items-center min-w-0 flex-1 justify-end">
          {/* Edge fades: the only cue that more tabs exist off-screen. */}
          <span
            aria-hidden
            className={`pointer-events-none absolute left-0 inset-y-0 w-8 z-10 bg-gradient-to-r from-background to-transparent transition-opacity duration-200 ${
              edges.left ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <span
            aria-hidden
            className={`pointer-events-none absolute right-[100px] inset-y-0 w-8 z-10 bg-gradient-to-l from-background to-transparent transition-opacity duration-200 ${
              edges.right ? 'opacity-100' : 'opacity-0'
            }`}
          />
          <nav
            ref={setStrip}
            className="flex items-center gap-0.5 text-[13px] flex-nowrap overflow-x-auto min-w-0 scroll-smooth [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]"
          >
          {NAV_ITEMS.map(item => {
            const active = isActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                data-active={active}
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
          </nav>
          {/* Outside the scroll strip so it stays reachable at any width. */}
          <div className="ml-1 shrink-0 relative z-20">
            <ThemeToggle />
          </div>
        </div>
      </div>
    </header>
  )
}
