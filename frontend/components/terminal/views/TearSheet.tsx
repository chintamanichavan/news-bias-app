// TEAR: one printable page about a company, from the screens already built.

import { Kv, Note } from '../kit'
import { useDossier } from './dossier'
import { usePrices } from './Chart'
import { useCompany } from './company'
import PriceChart from '@/components/PriceChart'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { rangeChange } from '@/lib/terminal/series'

export default function TearSheet({ symbol }: { symbol: string }) {
  const dossier = useDossier(symbol).data
  const prices = usePrices(symbol, '1y').data
  const company = useCompany(symbol).data
  if (!dossier) return <Note>Loading {symbol}…</Note>
  const id = dossier.profile?.identity
  const p = dossier.profile
  const years = dossier.fundamentals_history?.fiscal_years.slice(-5).reverse() ?? []
  const year = prices ? rangeChange(prices.series) : null
  const targets = company?.analysts?.targets
  return (
    <article className="space-y-4 text-[12px]">
      <header className="flex items-baseline justify-between gap-4 border-b border-border pb-2">
        <div>
          <h2 className="font-serif text-2xl font-bold leading-tight">{id?.long_name ?? symbol}</h2>
          <p className="text-muted-foreground">{[symbol, id?.exchange, id?.sector, id?.industry, id?.country].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="text-right tabular-nums">
          <div className="text-2xl font-bold">{price(dossier.price.last)}</div>
          <div className={tone(year)}>{pct(year)} over a year</div>
        </div>
      </header>
      {id?.summary && <p className="leading-relaxed line-clamp-5">{id.summary}</p>}
      {prices && <PriceChart series={prices.series} height={180} />}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        <Kv title="Valuation" data={p?.valuation} />
        <Kv title="Profitability" data={p?.profitability} />
        <Kv title="Dividends" data={p?.dividends} />
      </div>
      {years.length > 0 && (
        <table className="w-full tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
              {['Year', 'Revenue', 'Net income', 'EPS', 'Free cash flow', 'ROE'].map(h => <th key={h} className="py-1 px-2 text-right first:text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {years.map(y => (
              <tr key={String(y.fy)} className="border-b border-border/40">
                <td className="py-1 px-2">{y.fy}</td>
                <td className="py-1 px-2 text-right">{big(y.revenue)}</td>
                <td className="py-1 px-2 text-right">{big(y.net_income)}</td>
                <td className="py-1 px-2 text-right">{y.eps_diluted?.toFixed(2) ?? '—'}</td>
                <td className="py-1 px-2 text-right">{big(y.fcf)}</td>
                <td className="py-1 px-2 text-right">{pct(y.roe_pct, false)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {targets?.mean && (
        <p>
          Analysts ({company?.analysts?.opinions ?? '—'}): mean target <b>{price(targets.mean)}</b>, range {price(targets.low)}–{price(targets.high)}
          {company?.events?.earnings_dates[0] ? `. Next earnings ${company.events.earnings_dates[0]}.` : '.'}
        </p>
      )}
      <p className="text-[10px] text-muted-foreground">
        Artha tear sheet, {new Date().toLocaleDateString('en-GB', { dateStyle: 'long' })}. Prices about 15 minutes late;
        financials as filed with the SEC. Research, not advice.
      </p>
    </article>
  )
}
