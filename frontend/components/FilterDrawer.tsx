'use client'

import { useEffect } from 'react'
import { X } from 'lucide-react'

interface Source {
  id: string
  name: string
  category: string
  topic?: string
}

interface Filters {
  category: string | null
  sourceId: string | null
  lookbackHours: number | null
  includeAll: boolean
}

// Channel-logo style: square-rounded tile with a category-toned background +
// initial. Mirrors the way Apple News renders publisher logos in its sidebar.
const CATEGORY_META: Record<string, {
  label: string
  dotColor: string
  logoBg: string
  logoText: string
}> = {
  finance:     { label: 'Finance',     dotColor: 'bg-emerald-500',
                 logoBg: 'bg-emerald-600', logoText: 'text-white' },
  geopolitics: { label: 'Geopolitics', dotColor: 'bg-indigo-500',
                 logoBg: 'bg-indigo-600',  logoText: 'text-white' },
  science:     { label: 'Science',     dotColor: 'bg-violet-500',
                 logoBg: 'bg-violet-600',  logoText: 'text-white' },
}

interface Props {
  open: boolean
  onClose: () => void
  sources: Source[]
  filters: Filters
  onFiltersChange: React.Dispatch<React.SetStateAction<Filters>>
}

export default function FilterDrawer({ open, onClose, sources, filters, onFiltersChange }: Props) {
  // Esc to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Bucket sources by category
  const sourcesByCat: Record<string, Source[]> = {}
  for (const s of sources) {
    const cat = s.category || 'general'
    sourcesByCat[cat] ??= []
    sourcesByCat[cat].push(s)
  }
  for (const cat of Object.keys(sourcesByCat)) {
    sourcesByCat[cat].sort((a, b) => a.name.localeCompare(b.name))
  }

  const categories = Object.keys(CATEGORY_META).filter(c => sourcesByCat[c]?.length)
  const followingSources = categories.flatMap(c => sourcesByCat[c])

  const todayActive = !filters.category && !filters.sourceId

  function pickCategory(cat: string | null) {
    onFiltersChange(f => ({ ...f, category: cat, sourceId: null }))
    onClose()
  }
  function pickSource(sid: string) {
    onFiltersChange(f => ({ ...f, sourceId: sid, category: null }))
    onClose()
  }
  function clearAll() {
    onFiltersChange(f => ({ ...f, category: null, sourceId: null }))
    onClose()
  }

  return (
    <>
      {/* Backdrop — light, like clicking outside an inspector */}
      <div
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-150 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Sidebar — translucent gray, no white-card chrome. Mirrors Apple News
          macOS source list aesthetic. */}
      <aside
        role="dialog"
        aria-label="Browse"
        aria-modal="true"
        className={`fixed left-0 top-0 z-50 h-full w-[260px] sm:w-[280px] flex flex-col transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          background: 'hsl(30 8% 95%)',
          borderRight: '1px solid hsl(30 6% 88%)',
        }}
      >
        {/* Title bar — leaves room for the macOS-style traffic-light position */}
        <div className="shrink-0 flex items-center justify-between pl-4 pr-2.5 pt-3 pb-1.5">
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground/85">
            News
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-6 w-6 rounded-md text-muted-foreground hover:bg-foreground/5 transition-colors flex items-center justify-center"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>

        {/* Body — scrollable rail */}
        <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-4">
          {/* Top items: pinned, no section header (mirrors News+/Today/Sports in Apple News) */}
          <ul className="py-1">
            <SidebarItem
              active={todayActive}
              onClick={clearAll}
              icon={<TodayIcon />}
              label="Today"
            />
          </ul>

          {/* FOLLOWING — every source we ingest, with channel-logo tile */}
          {followingSources.length > 0 && (
            <>
              <SectionHeader title="Following" />
              <ul>
                {followingSources.map(src => {
                  const meta = CATEGORY_META[src.category] ?? CATEGORY_META.finance
                  return (
                    <SidebarItem
                      key={src.id}
                      active={filters.sourceId === src.id}
                      onClick={() => pickSource(src.id)}
                      icon={<ChannelLogo name={src.name} bg={meta.logoBg} text={meta.logoText} />}
                      label={src.name}
                    />
                  )
                })}
              </ul>
            </>
          )}

          {/* CHANNELS & TOPICS — categories with their dot color */}
          {categories.length > 0 && (
            <>
              <SectionHeader title="Channels & Topics" />
              <ul>
                {categories.map(cat => {
                  const meta = CATEGORY_META[cat]
                  const isActive = filters.category === cat && !filters.sourceId
                  return (
                    <SidebarItem
                      key={cat}
                      active={isActive}
                      onClick={() => pickCategory(cat)}
                      icon={
                        <span
                          aria-hidden
                          className={`h-2.5 w-2.5 rounded-full ${meta.dotColor}`}
                        />
                      }
                      label={meta.label}
                      compact
                    />
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </aside>
    </>
  )
}

function SectionHeader({ title }: { title: string }) {
  return (
    <p className="px-3 pt-4 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground/80">
      {title}
    </p>
  )
}

interface SidebarItemProps {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  /** Compact variant — used for Channels & Topics where the icon is just a dot */
  compact?: boolean
}

function SidebarItem({ active, onClick, icon, label, compact = false }: SidebarItemProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={`w-full flex items-center gap-${compact ? '2.5' : '2'} rounded-md transition-colors text-left ${
          compact ? 'px-3 py-1.5' : 'px-2 py-1'
        } ${
          active
            ? 'bg-foreground/10 text-foreground'
            : 'hover:bg-foreground/[0.06] text-foreground/90'
        }`}
      >
        <span className={`shrink-0 flex items-center justify-center ${compact ? 'w-3.5' : ''}`}>
          {icon}
        </span>
        <span className={`flex-1 min-w-0 truncate font-medium tracking-tight ${compact ? 'text-[13px]' : 'text-[13.5px]'}`}>
          {label}
        </span>
      </button>
    </li>
  )
}

function ChannelLogo({ name, bg, text }: { name: string; bg: string; text: string }) {
  // First initial in a 28px square with rounded corners — Apple News
  // publisher-logo placeholder when there's no real image.
  const initial = name.replace(/[^A-Za-z0-9]/g, '').charAt(0).toUpperCase() || '•'
  return (
    <span
      aria-hidden
      className={`h-7 w-7 rounded-md flex items-center justify-center text-[12px] font-bold leading-none ${bg} ${text}`}
    >
      {initial}
    </span>
  )
}

function TodayIcon() {
  // Apple-News-style "Today" red glyph — sun-burst stylized as 4 strokes.
  return (
    <span
      aria-hidden
      className="h-7 w-7 rounded-md flex items-center justify-center bg-[hsl(var(--accent-news))] text-white"
    >
      <svg viewBox="0 0 14 14" className="w-3.5 h-3.5" fill="none">
        <path
          d="M7 1.5v2M7 10.5v2M1.5 7h2M10.5 7h2M3 3l1.4 1.4M9.6 9.6L11 11M3 11l1.4-1.4M9.6 4.4L11 3"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="7" cy="7" r="2" fill="currentColor" />
      </svg>
    </span>
  )
}
