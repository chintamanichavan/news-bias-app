import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, price } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Fill {
  id: number; symbol: string; side: 'buy' | 'sell'; quantity: number; type: string; filled_at: string
  fill_price: number; arrival_mid: number | null; vwap: number | null; notional: number
  vs_arrival_bps: number | null; vs_vwap_bps: number | null; cost_dollars: number | null
}

interface Report { fills: Fill[]; notional: number; vs_arrival_bps: number | null; vs_vwap_bps: number | null; cost_dollars: number }

// a cost is bad, so positive basis points are shown in red
const bps = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}`)
const costTone = (v: number | null) => (v == null || Math.abs(v) < 0.05 ? '' : v > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400')

export default function Tca({ run }: ViewProps) {
  const { data, error, loading } = useResource<Report>('/api/terminal/tca', { freshMs: 0 })
  return (
    <div className="space-y-3">
      <Fetched data={data} error={error} loading={loading}>
        {d => d.fills.length === 0 ? <Note>No filled paper orders yet. Place one with EMSX.</Note> : (
          <>
            <p className="text-[13px] tabular-nums">
              {d.fills.length} fill{d.fills.length === 1 ? '' : 's'}, ${big(d.notional)} traded. Cost against arrival{' '}
              <b className={costTone(d.vs_arrival_bps)}>{bps(d.vs_arrival_bps)} bp</b> (${big(d.cost_dollars)}), against the day&apos;s
              VWAP <b className={costTone(d.vs_vwap_bps)}>{bps(d.vs_vwap_bps)} bp</b>.
            </p>
            <Table rows={d.fills} rowKey={f => String(f.id)} onRow={f => run(`${f.symbol} GIP`)}
              columns={[
                { head: 'Filled', align: 'left', cell: f => new Date(f.filled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) },
                { head: 'Order', align: 'left', cell: f => <span>{f.side} {f.quantity.toLocaleString('en-US')} <b>{f.symbol}</b> {f.type}</span> },
                { head: 'Fill', cell: f => price(f.fill_price) },
                { head: 'Arrival', cell: f => price(f.arrival_mid) },
                { head: 'VWAP', cell: f => price(f.vwap) },
                { head: 'vs arrival bp', cell: f => bps(f.vs_arrival_bps), className: f => costTone(f.vs_arrival_bps) },
                { head: 'vs VWAP bp', cell: f => bps(f.vs_vwap_bps), className: f => costTone(f.vs_vwap_bps) },
                { head: 'Cost $', cell: f => big(f.cost_dollars), className: f => costTone(f.cost_dollars) },
              ]} />
          </>
        )}
      </Fetched>
      <Note>
        Basis points of cost: positive means the fill was worse than the reference (paid more on a buy, got less on a
        sale). Arrival is the bid/ask midpoint when the order was placed, so a market order&apos;s cost is about half the
        spread. VWAP is the volume-weighted price of the fill&apos;s New York trading day, from 5-minute bars; a fill after
        the close is set against that day&apos;s session. It is blank for fills older than five days. Totals are weighted
        by dollars traded.
      </Note>
    </div>
  )
}
