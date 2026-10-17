import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { argSymbol } from '@/lib/terminal/parse'
import { useResource } from '@/lib/useResource'

// FREP, MIFA, FPC, FSTA, WETF and CETF.

interface Trailing { period: string; fund: number | null; category: number | null }
interface Report {
  symbol: string; name: string | null; category: string | null; family: string | null; type: string | null; expense_ratio: number | null
  turnover: number | null; assets: number | null; yield: number | null; beta_3y: number | null; trailing: Trailing[]
  annual: { year: string; fund: number | null }[]
  risk: { period: string; alpha: number | null; beta: number | null; meanAnnualReturn: number | null; rSquared: number | null; stdDev: number | null; sharpeRatio: number | null }[]
  holdings: { symbol: string; name: string; weight: number | null }[]; sectors: { sector: string; weight: number }[]
  ratings: { rating: string; weight: number }[]; asset_mix: Record<string, number | null>; error?: string
}

const p100 = (v: number | null | undefined, signed = true) => (v == null ? '—' : pct(v * 100, signed))
const nice = (k: string) => k.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())

function useFund<T>(kind: string, params: string) {
  return useResource<T>(`/api/terminal/funds/${kind}?${params}`, { freshMs: 60 * 60_000 })
}

export function FundReport({ command, run }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useFund<Report>('report', `symbol=${encodeURIComponent(sec.symbol)}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px]"><b>{d.name}</b> · {d.category ?? '—'} · {d.family ?? ''} · expense {p100(d.expense_ratio, false)} · assets {big(d.assets)} · yield {p100(d.yield, false)}{d.turnover != null ? ` · turnover ${p100(d.turnover, false)}` : ''}</p>
          {command.fn === 'MIFA' ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <p className="news-section-label mb-1">Top holdings</p>
                <Table rows={d.holdings} rowKey={h => h.symbol ?? h.name} onRow={h => h.symbol && run(`${h.symbol} DES`)} columns={[
                  { head: 'Holding', align: 'left', cell: h => <span><b>{h.symbol}</b> <span className="text-muted-foreground">{h.name}</span></span> },
                  { head: 'Weight', cell: h => p100(h.weight, false) },
                ]} />
              </div>
              <div className="space-y-3">
                <Table rows={Object.entries(d.asset_mix).filter(([, v]) => v)} rowKey={r => r[0]} columns={[
                  { head: 'Asset mix', align: 'left', cell: r => nice(r[0].replace('Position', '')) }, { head: '', cell: r => p100(r[1], false) },
                ]} />
                {d.sectors.length > 0 && <Table rows={d.sectors} rowKey={s => s.sector} columns={[
                  { head: 'Sector', align: 'left', cell: s => nice(s.sector) }, { head: 'Weight', cell: s => p100(s.weight, false) },
                ]} />}
                {d.ratings.length > 0 && <Table rows={d.ratings} rowKey={r => r.rating} columns={[
                  { head: 'Credit rating', align: 'left', cell: r => nice(r.rating) }, { head: 'Weight', cell: r => p100(r.weight, false) },
                ]} />}
              </div>
            </div>
          ) : (
            <>
              <Table rows={d.trailing.filter(t => t.fund != null)} rowKey={t => t.period} columns={[
                { head: 'Total return', align: 'left', cell: t => t.period },
                { head: d.symbol, cell: t => p100(t.fund), className: t => tone(t.fund) },
                { head: 'Category', cell: t => p100(t.category), className: t => tone(t.category) },
                { head: 'Ahead by', cell: t => (t.fund == null || t.category == null ? '—' : p100(t.fund - t.category)), className: t => tone(t.fund == null || t.category == null ? null : t.fund - t.category) },
              ]} />
              {d.risk.length > 0 && <Table rows={d.risk} rowKey={r => r.period} columns={[
                { head: 'Risk', align: 'left', cell: r => r.period },
                { head: 'Volatility', cell: r => (r.stdDev == null ? '—' : `${r.stdDev.toFixed(1)}%`) },
                { head: 'Sharpe', cell: r => r.sharpeRatio?.toFixed(2) ?? '—' },
                { head: 'Beta', cell: r => r.beta?.toFixed(2) ?? '—' },
                { head: 'Alpha', cell: r => r.alpha?.toFixed(2) ?? '—' },
                { head: 'R²', cell: r => r.rSquared?.toFixed(0) ?? '—' },
              ]} />}
              {d.annual.length > 0 && <Table rows={d.annual} rowKey={a => a.year} columns={[
                { head: 'Year', align: 'left', cell: a => a.year }, { head: 'Return', cell: a => p100(a.fund), className: a => tone(a.fund) },
              ]} />}
            </>
          )}
          <Note>Fund terms, returns against its Morningstar category, risk figures and holdings as Yahoo reports them. {command.fn === 'MIFA' ? 'Yahoo lists the top ten holdings; the full list is in the fund’s N-PORT filing (CF).' : 'Returns over several years are per year.'}</Note>
        </div>
      )}
    </Fetched>
  )
}

export function FundCompare({ command, run }: ViewProps) {
  const names = [command.security?.symbol, ...command.args.map(argSymbol)].filter(Boolean) as string[]
  const list = names.length ? names : ['SPY', 'VFIAX', 'QQQ', 'VTI', 'ARKK', 'AGG']
  const { data, error, loading } = useFund<{ rows: Report[] }>('compare', `symbols=${encodeURIComponent(list.join(','))}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const get = (r: Report, p: string) => r.trailing?.find(t => t.period === p)?.fund ?? null
        const rows = [...d.rows].sort((a, b) => (get(b, '1 year') ?? -9) - (get(a, '1 year') ?? -9))
        return (
          <div className="space-y-3">
            <Table rows={rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} FREP`)} columns={[
              { head: 'Fund', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.error ?? r.category}</span></span> },
              ...['Year to date', '1 year', '3 years, a year', '5 years, a year', '10 years, a year'].map(p => ({
                head: p.replace(', a year', ' p.a.'), cell: (r: Report) => p100(get(r, p)), className: (r: Report) => tone(get(r, p)) })),
              { head: 'Expense', cell: r => p100(r.expense_ratio, false) },
              { head: 'Assets', cell: r => big(r.assets) },
            ]} />
            <Note>Total returns ranked by one year. Name your own list: FPC VFIAX FXAIX SWPPX. Returns from Yahoo, net of fees.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Style { months: number; from: string; to: string; weights: { symbol: string; style: string; weight: number }[]; r_squared: number; tracking_error: number; selection_return: number }

export function FundStyle({ command }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useFund<Style>('style', `symbol=${encodeURIComponent(sec.symbol)}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          {d.weights.map(w => (
            <div key={w.symbol} className="flex items-center gap-2 text-[12px] tabular-nums">
              <span className="w-40">{w.style} <span className="text-muted-foreground">{w.symbol}</span></span>
              <div className="flex-1 h-3 bg-muted rounded"><div className="h-3 rounded bg-indigo-500" style={{ width: `${w.weight * 100}%` }} /></div>
              <span className="w-14 text-right">{(w.weight * 100).toFixed(1)}%</span>
            </div>
          ))}
          <p className="text-[13px] tabular-nums">Style explains <b>{(d.r_squared * 100).toFixed(1)}%</b> of the variance; tracking error against the style mix {(d.tracking_error * 100).toFixed(1)}% a year; selection return {pct(d.selection_return * 100)} a year.</p>
          <Note>Sharpe&apos;s returns-based style analysis: {sec.label}&apos;s monthly total returns, {d.from} to {d.to} ({d.months} months), as the mix of style funds that tracks them best, with weights that are positive and add to 100%. What style does not explain is the manager&apos;s own selection.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Etf { symbol: string; name: string; price: number; change_pct: number | null; change_52w_pct: number | null; yield: number | null; duration: number | null; expense_ratio: number | null; assets: number | null; category: string | null; ytd: number | null }

export function EtfMonitor({ command, run }: ViewProps) {
  const kind = command.fn === 'WETF' ? 'bond' : 'commodity'
  const { data, error, loading } = useFund<{ rows: Etf[] }>(kind, '')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} FREP`)} columns={[
            { head: 'Fund', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.category ?? r.name}</span></span> },
            { head: 'Price', cell: r => price(r.price) },
            { head: 'Today', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
            { head: 'Year to date', cell: r => p100(r.ytd), className: r => tone(r.ytd) },
            { head: '52 weeks', cell: r => pct(r.change_52w_pct), className: r => tone(r.change_52w_pct) },
            ...(kind === 'bond' ? [
              { head: 'Yield', cell: (r: Etf) => p100(r.yield, false) },
              { head: 'Rate sensitivity', cell: (r: Etf) => (r.duration == null ? '—' : r.duration.toFixed(1)) },
            ] : []),
            { head: 'Expense', cell: r => p100(r.expense_ratio, false) },
            { head: 'Assets', cell: r => big(r.assets) },
          ]} />
          <Note>
            {kind === 'bond'
              ? 'Bond funds from cash to long Treasuries, credit, munis and mortgages. Rate sensitivity is measured, not stated: the percent a fund moved per one-point move in the 10-year yield over the last year. Long-bond funds read below their stated duration because 30-year yields move less than the 10-year; credit funds read low because spreads often narrow as yields rise.'
              : 'Commodity funds: metals held in vaults, and futures funds that roll contracts (whose returns can lag the spot price when the curve slopes up).'}
          </Note>
        </div>
      )}
    </Fetched>
  )
}
