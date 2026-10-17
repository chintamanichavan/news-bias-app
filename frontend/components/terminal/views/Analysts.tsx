import { Table } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { day, pct, price, tone } from '@/lib/terminal/numbers'

const BARS: [string, 'strongBuy' | 'buy' | 'hold' | 'sell' | 'strongSell', string][] = [
  ['Strong buy', 'strongBuy', 'bg-emerald-600'], ['Buy', 'buy', 'bg-emerald-400'], ['Hold', 'hold', 'bg-muted-foreground/40'],
  ['Sell', 'sell', 'bg-red-400'], ['Strong sell', 'strongSell', 'bg-red-600'],
]

export default function Analysts({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="analysts" missing="No analyst coverage is published for this security.">
      {a => {
        const now = a.trend[0]
        const total = now ? BARS.reduce((s, [, k]) => s + now[k], 0) : 0
        const upside = a.targets.mean && a.price ? (a.targets.mean / a.price - 1) * 100 : null
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-[13px] tabular-nums">
              <span>Mean target <b>{price(a.targets.mean)}</b> <span className={tone(upside)}>({pct(upside)} from {price(a.price)})</span></span>
              <span className="text-muted-foreground">range {price(a.targets.low)}–{price(a.targets.high)}</span>
              <span className="text-muted-foreground">{a.opinions ?? '—'} analysts · rating {a.rating_mean?.toFixed(2) ?? '—'} (1 strong buy, 5 sell)</span>
            </div>
            {now && total > 0 && (
              <div>
                <div className="flex h-3 rounded overflow-hidden">
                  {BARS.map(([label, k, cls]) => now[k] > 0 && (
                    <div key={k} className={cls} style={{ width: `${(now[k] / total) * 100}%` }} title={`${label}: ${now[k]}`} />
                  ))}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {BARS.map(([label, k]) => `${label} ${now[k]}`).join(' · ')}
                </p>
              </div>
            )}
            <div>
              <p className="news-section-label mb-1">Recent rating and target changes</p>
              <Table
                rows={a.changes}
                rowKey={(c, i) => `${c.date}-${c.firm}-${i}`}
                columns={[
                  { head: 'Date', align: 'left', cell: c => day(c.date) },
                  { head: 'Firm', align: 'left', cell: c => c.firm },
                  { head: 'Rating', align: 'left', cell: c => (c.from && c.from !== c.to ? `${c.from} → ${c.to}` : c.to ?? '—') },
                  { head: 'Target', cell: c => (c.target ? `${c.prior_target ? `${price(c.prior_target)} → ` : ''}${price(c.target)}` : '—') },
                ]}
              />
            </div>
          </div>
        )
      }}
    </CompanySection>
  )
}
