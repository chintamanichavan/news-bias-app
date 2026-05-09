import { Card } from '@/components/ui/card'

export interface Signal {
  id: string
  source: string
  question: string
  description: string | null
  category: string
  yes_price: number
  yes_change_24h: number
  volume_24h: number
  volume_total: number
  end_date: string | null
  url: string | null
  image_url: string | null
}

const CATEGORY_META: Record<string, { label: string; color: string; emoji: string }> = {
  macro:       { label: 'Macro',       color: '#16a34a', emoji: '📈' },
  geopolitics: { label: 'Geopolitics', color: '#4f46e5', emoji: '🌐' },
  politics:    { label: 'Politics',    color: '#d97706', emoji: '🗳' },
  crypto:      { label: 'Crypto',      color: '#f59e0b', emoji: '₿' },
  finance:     { label: 'Finance',     color: '#0891b2', emoji: '💰' },
}

function formatVolume(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  return `$${v.toFixed(0)}`
}

function formatExpiry(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const days = Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (days < 0) return 'expired'
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days < 30) return `${days}d`
  if (days < 365) return `${Math.round(days / 30)}mo`
  return `${Math.round(days / 365)}y`
}

function changeBadge(change: number): { color: string; bg: string; arrow: string; text: string } {
  const pts = Math.abs(change * 100)
  if (change > 0.005) {
    return {
      color: 'text-emerald-700 dark:text-emerald-300',
      bg: 'bg-emerald-100 dark:bg-emerald-950/40',
      arrow: '↑',
      text: `+${pts.toFixed(0)}pts`,
    }
  }
  if (change < -0.005) {
    return {
      color: 'text-rose-700 dark:text-rose-300',
      bg: 'bg-rose-100 dark:bg-rose-950/40',
      arrow: '↓',
      text: `−${pts.toFixed(0)}pts`,
    }
  }
  return {
    color: 'text-muted-foreground',
    bg: 'bg-muted',
    arrow: '→',
    text: 'flat',
  }
}

function priceColor(p: number): string {
  // Use a temperature gradient: low=blue (unlikely), mid=gray, high=green (likely)
  if (p >= 0.65) return 'text-emerald-600 dark:text-emerald-400'
  if (p >= 0.35) return 'text-foreground'
  return 'text-slate-500 dark:text-slate-400'
}

export default function SignalCard({ signal }: { signal: Signal }) {
  const cat = CATEGORY_META[signal.category] ?? CATEGORY_META.finance
  const change = changeBadge(signal.yes_change_24h)
  const pct = Math.round(signal.yes_price * 100)
  const borderTint =
    signal.yes_change_24h > 0.005 ? 'border-l-emerald-400' :
    signal.yes_change_24h < -0.005 ? 'border-l-rose-400' :
    'border-l-border'

  return (
    <a
      href={signal.url ?? '#'}
      target="_blank"
      rel="noopener noreferrer"
      className="block group"
    >
      <Card className={`overflow-hidden h-full transition-all hover:shadow-md hover:-translate-y-0.5 border-l-4 ${borderTint}`}>
        <div className="p-4 flex flex-col gap-2.5">
          {/* Top row: category + change */}
          <div className="flex items-center justify-between gap-2">
            <span
              className="text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1"
              style={{ color: cat.color }}
            >
              <span>{cat.emoji}</span>
              <span>{cat.label}</span>
            </span>
            <span className={`text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded ${change.bg} ${change.color}`}>
              {change.arrow} {change.text}
            </span>
          </div>

          {/* Big % */}
          <div className="flex items-baseline gap-2">
            <span className={`text-4xl font-bold tabular-nums tracking-tight ${priceColor(signal.yes_price)}`}>
              {pct}%
            </span>
            <span className="text-xs text-muted-foreground">YES</span>
          </div>

          {/* Question */}
          <p className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
            {signal.question}
          </p>

          {/* Footer */}
          <div className="flex items-center justify-between pt-1 text-[11px] text-muted-foreground tabular-nums">
            <span>📊 {formatVolume(signal.volume_24h)} 24h</span>
            {signal.end_date && (
              <span>⏱ {formatExpiry(signal.end_date)}</span>
            )}
          </div>
        </div>
      </Card>
    </a>
  )
}
