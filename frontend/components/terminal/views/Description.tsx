import { Fetched, Kv, Note } from '../kit'
import { useDossier } from './dossier'
import type { ViewProps } from './types'
import { pct, price, tone } from '@/lib/terminal/numbers'

export default function Description({ command }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useDossier(sec.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        if (d.error) return <Note>{d.error}</Note>
        const p = d.profile
        const id = p?.identity
        return (
          <div className="space-y-4">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-serif text-xl font-bold leading-tight truncate">{id?.long_name ?? d.name ?? d.symbol}</h3>
                <p className="text-[11px] text-muted-foreground">
                  {[id?.exchange, id?.currency, id?.sector, id?.industry, id?.country].filter(Boolean).join(' · ')}
                </p>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xl font-bold tabular-nums">{price(d.price.last)}</div>
                <div className={`text-[11px] tabular-nums ${tone(d.price.vs_52w_high_pct)}`}>
                  {pct(d.price.vs_52w_high_pct)} from 52-week high
                </div>
              </div>
            </div>
            {id?.summary && <p className="text-[12px] leading-relaxed line-clamp-4">{id.summary}</p>}
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
              <Kv title="Valuation" data={p?.valuation} />
              <Kv title="Trading" data={p?.trading} />
              <Kv title="Profitability" data={p?.profitability} />
              <Kv title="Balance sheet" data={p?.balance} />
              <Kv title="Growth" data={p?.growth} />
              <Kv title="Dividends" data={p?.dividends} />
              <Kv title="Analysts" data={p?.analyst} />
              <Kv title="Shares" data={p?.shares} />
            </div>
            <Note>
              Next earnings: {p?.calendar.next_earnings ?? 'not published'}.
              {id?.employees ? ` Employees: ${id.employees.toLocaleString()}.` : ''}
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
