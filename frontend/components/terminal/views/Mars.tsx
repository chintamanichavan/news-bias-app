import { Fetched, Kv, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, day, pct, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Scenario { name: string; start: string; end: string; portfolio: number | null; benchmark: number | null; covered_weight: number; missing: string[] }
interface Mars {
  empty?: boolean; value: number; volatility: number | null; beta: number | null
  var_95: [number, number] | null; var_99: [number, number] | null
  max_drawdown_1y: number; max_drawdown_5y: number; days: number
  scenarios: Scenario[]; shocks: { market: number; portfolio: number | null }[]
  positions: { symbol: string; weight: number | null; beta: number | null }[]
}

const p100 = (v: number | null | undefined, signed = true) => pct(v == null ? null : v * 100, signed)

export default function Mars({ run }: ViewProps) {
  const { data, error, loading } = useResource<Mars>('/api/terminal/risk', { freshMs: 10 * 60_000 })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {m => m.empty ? <Note>No holdings to measure. <button className="underline" onClick={() => run('PRTU')}>Load them with PRTU</button>.</Note> : (
        <div className="space-y-4">
          <div className="max-w-md">
          <Kv data={{
            value: m.value, volatility_pct: m.volatility == null ? null : m.volatility * 100, beta: m.beta,
            one_day_var_95_pct: m.var_95 ? m.var_95[0] * 100 : null, one_day_var_95_dollars: m.var_95 ? m.var_95[0] * m.value : null,
            shortfall_95_pct: m.var_95 ? m.var_95[1] * 100 : null, one_day_var_99_pct: m.var_99 ? m.var_99[0] * 100 : null,
            max_drawdown_1y_pct: m.max_drawdown_1y * 100, max_drawdown_5y_pct: m.max_drawdown_5y * 100,
          }} />
          </div>
          <div>
            <p className="news-section-label mb-1">Today&rsquo;s holdings in past sell-offs</p>
            <Table rows={m.scenarios} rowKey={s => s.name}
              columns={[
                { head: 'Episode', align: 'left', cell: s => s.name },
                { head: 'Window', align: 'left', cell: s => `${day(s.start)} – ${day(s.end)}` },
                { head: 'Your book', cell: s => p100(s.portfolio), className: s => `font-semibold ${tone(s.portfolio)}` },
                { head: 'S&P 500 (SPY)', cell: s => p100(s.benchmark), className: s => tone(s.benchmark) },
                { head: 'In dollars', cell: s => (s.portfolio == null ? '—' : big(s.portfolio * m.value)) },
                { head: 'Left out', align: 'left', cell: s => (s.missing.length ? `${s.missing.join(', ')} (not listed then)` : '') },
              ]} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="news-section-label mb-1">If the market falls, by beta</p>
              <Table rows={m.shocks} rowKey={s => String(s.market)}
                columns={[
                  { head: 'Market', align: 'left', cell: s => p100(s.market) },
                  { head: 'Your book', cell: s => p100(s.portfolio), className: s => tone(s.portfolio) },
                  { head: 'Dollars', cell: s => (s.portfolio == null ? '—' : big(s.portfolio * m.value)) },
                ]} />
            </div>
            <div>
              <p className="news-section-label mb-1">Beta of each holding (1 year)</p>
              <Table rows={m.positions} rowKey={p => p.symbol}
                columns={[
                  { head: 'Security', align: 'left', cell: p => p.symbol },
                  { head: 'Weight', cell: p => p100(p.weight, false) },
                  { head: 'Beta', cell: p => (p.beta == null ? '—' : p.beta.toFixed(2)) },
                ]} />
            </div>
          </div>
          <Note>
            Historical: the last {m.days} trading days of today&rsquo;s holdings at today&rsquo;s weights, dividends
            included. Value at risk is the one-day loss not exceeded on 95% (or 99%) of those days; shortfall is the
            average loss on the days beyond it. Past sell-offs replay each holding&rsquo;s own return over the window.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
