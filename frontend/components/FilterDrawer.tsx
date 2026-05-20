'use client'

import { useEffect } from 'react'

interface Source {
  id: string
  name: string
  category: string
  topic?: string
}

interface Filters {
  category: string | null
  sourceId: string | null
  minScore: number
  maxScore: number
  lookbackHours: number | null
  includeAll: boolean
}

const CATEGORY_META: Record<string, { label: string; tone: string; emoji: string }> = {
  finance:     { label: 'Finance',     tone: 'text-emerald-700', emoji: '📈' },
  geopolitics: { label: 'Geopolitics', tone: 'text-indigo-700',  emoji: '🌐' },
  science:     { label: 'Science',     tone: 'text-violet-700',  emoji: '🔬' },
}

const TOPIC_LABEL: Record<string, string> = {
  markets: 'Markets',
  macro: 'Macro / Economics',
  asset_mgmt: 'Asset Management',
  algo_trading: 'Algorithmic Trading',
  energy_commodities: 'Energy & Commodities',
  crypto: 'Crypto',
  central_banks: 'Central Banks',
  analysis: 'Analysis & Strategy',
  world_news: 'World News',
  defense_security: 'Defense & Security',
  astrophysics: 'Astrophysics',
  physics: 'Physics',
  math: 'Mathematics',
  math_physics: 'Math & Physics',
  statistics: 'Statistics',
  computer_science: 'Computer Science',
  general_science: 'General Science',
  economics: 'Economics',
  defense: 'Defense',
}

interface Props {
  open: boolean
  onClose: () => void
  sources: Source[]
  filters: Filters
  onFiltersChange: React.Dispatch<React.SetStateAction<Filters>>
}

export default function FilterDrawer({ open, onClose, sources, filters, onFiltersChange }: Props) {
  // Close on Esc
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Lock body scroll while drawer is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // Group sources by category → topic
  const grouped: Record<string, Record<string, Source[]>> = {}
  for (const s of sources) {
    const cat = s.category || 'general'
    const top = s.topic || 'other'
    grouped[cat] ??= {}
    grouped[cat][top] ??= []
    grouped[cat][top].push(s)
  }
  const categories = Object.keys(CATEGORY_META).filter(c => grouped[c])

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
      {/* Backdrop */}
      <div
        aria-hidden
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Filter feed"
        aria-modal="true"
        className={`fixed left-0 top-0 z-50 h-full w-[88vw] sm:w-80 bg-card shadow-2xl transition-transform duration-200 ease-out flex flex-col ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border/60">
          <h2 className="text-base font-semibold tracking-tight">Filter</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors text-xl leading-none -mr-1 px-2 py-1"
            aria-label="Close filters"
          >
            ×
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-6">
          {/* Section: Browse */}
          <section>
            <p className="news-section-label mb-3">Browse</p>
            <div className="space-y-1">
              <DrawerRow
                active={filters.category === null && filters.sourceId === null}
                onClick={clearAll}
                label="All"
              />
              {categories.map(cat => {
                const meta = CATEGORY_META[cat]
                const isActive = filters.category === cat && !filters.sourceId
                return (
                  <DrawerRow
                    key={cat}
                    active={isActive}
                    onClick={() => pickCategory(cat)}
                    label={`${meta.emoji} ${meta.label}`}
                  />
                )
              })}
            </div>
          </section>

          {/* Section: Sources */}
          <section>
            <p className="news-section-label mb-3">Sources</p>
            {categories.map(cat => {
              const meta = CATEGORY_META[cat]
              const topics = grouped[cat]
              return (
                <div key={cat} className="mb-5">
                  <p className={`text-[11px] font-medium uppercase tracking-[0.12em] mb-2 ${meta.tone}`}>
                    {meta.label}
                  </p>
                  {Object.entries(topics).map(([topicId, srcList]) => (
                    <div key={topicId} className="mb-2.5">
                      {topicId !== 'other' && (
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1">
                          {TOPIC_LABEL[topicId] ?? topicId}
                        </p>
                      )}
                      <div className="space-y-0.5">
                        {srcList.map(src => (
                          <DrawerRow
                            key={src.id}
                            active={filters.sourceId === src.id}
                            onClick={() => pickSource(src.id)}
                            label={src.name}
                            compact
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })}
          </section>
        </div>
      </aside>
    </>
  )
}

function DrawerRow({
  active, onClick, label, compact = false,
}: {
  active: boolean; onClick: () => void; label: string; compact?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg transition-colors ${
        compact ? 'px-3 py-1.5 text-[13px]' : 'px-3 py-2 text-[14px]'
      } ${
        active
          ? 'bg-foreground text-background font-medium'
          : 'hover:bg-muted text-foreground'
      }`}
    >
      {label}
    </button>
  )
}
