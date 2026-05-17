'use client'

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

interface FeedSidebarProps {
  sources: Source[]
  filters: Filters
  onFiltersChange: React.Dispatch<React.SetStateAction<Filters>>
}

const CATEGORY_META: Record<string, { label: string; color: string; emoji: string }> = {
  finance:     { label: 'Finance',     color: '#16a34a', emoji: '📈' },
  geopolitics: { label: 'Geopolitics', color: '#4f46e5', emoji: '🌐' },
  science:     { label: 'Science',     color: '#7c3aed', emoji: '🔬' },
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
}

export default function FeedSidebar({ sources, filters, onFiltersChange }: FeedSidebarProps) {
  // Group: category → topic → sources
  const grouped: Record<string, Record<string, Source[]>> = {}
  for (const s of sources) {
    const cat = s.category || 'general'
    const top = s.topic || 'other'
    grouped[cat] ??= {}
    grouped[cat][top] ??= []
    grouped[cat][top].push(s)
  }

  const allCategories = Object.keys(CATEGORY_META).filter(c => grouped[c])

  return (
    <aside className="w-60 shrink-0 hidden lg:block">
      <div className="sticky top-6 space-y-6">
        {/* Category filter chips */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Browse
          </h3>
          <button
            onClick={() => onFiltersChange({ ...filters, category: null, sourceId: null })}
            className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors mb-1 ${
              filters.category === null && filters.sourceId === null
                ? 'bg-primary text-primary-foreground font-medium'
                : 'hover:bg-muted text-foreground'
            }`}
          >
            All
          </button>
          {allCategories.map(cat => {
            const meta = CATEGORY_META[cat]
            const isActive = filters.category === cat && !filters.sourceId
            return (
              <button
                key={cat}
                onClick={() => onFiltersChange({ ...filters, category: cat, sourceId: null })}
                className={`w-full text-left text-sm px-3 py-1.5 rounded-lg transition-colors mb-1 flex items-center gap-2 ${
                  isActive ? 'bg-primary text-primary-foreground font-medium' : 'hover:bg-muted'
                }`}
              >
                <span>{meta.emoji}</span>
                <span>{meta.label}</span>
              </button>
            )
          })}
        </div>

        {/* Sources grouped by topic */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Sources
          </h3>
          {allCategories.map(cat => {
            const meta = CATEGORY_META[cat]
            const topics = grouped[cat]
            return (
              <div key={cat} className="mb-4">
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1.5"
                   style={{ color: meta.color }}>
                  {meta.emoji} {meta.label}
                </p>
                {Object.entries(topics).map(([topicId, srcList]) => (
                  <div key={topicId} className="mb-2">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70 px-3 py-0.5">
                      {TOPIC_LABEL[topicId] ?? topicId}
                    </p>
                    {srcList.map(src => (
                      <button
                        key={src.id}
                        onClick={() => onFiltersChange({ ...filters, sourceId: src.id, category: null })}
                        className={`w-full text-left text-xs px-3 py-1 rounded-lg transition-colors ${
                          filters.sourceId === src.id
                            ? 'bg-primary/10 text-foreground font-medium'
                            : 'hover:bg-muted text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {src.name}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </aside>
  )
}
