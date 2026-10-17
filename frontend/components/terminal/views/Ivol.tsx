import { Fetched, Kv, Note, Table } from '../kit'
import XYChart from '../XYChart'
import type { ViewProps } from './types'
import { useVol, volPct, volPts } from './vol'
import { expiryLabel } from './options'

export default function Ivol({ command }: ViewProps) {
  const { data, error, loading } = useVol(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {v => {
        const rv30 = v.realized['30d']
        const ratio = v.iv30 && rv30 ? v.iv30 / rv30 : null
        return (
          <div className="space-y-4">
            <p className="text-[13px] tabular-nums">
              30-day implied <b>{volPct(v.iv30)}</b> against 30-day realized <b>{volPct(rv30)}</b>
              {ratio != null && <> · options price {ratio >= 1 ? `${ratio.toFixed(2)}× more` : `${(1 / ratio).toFixed(2)}× less`} movement than the stock has shown</>}
            </p>
            <XYChart
              series={[{ label: 'At-the-money implied volatility by days to expiry', cls: 'stroke-sky-500',
                points: v.term.map(t => ({ x: t.days, y: t.atm })) }]}
              xFmt={d => `${Math.round(d)}d`} yFmt={y => `${(y * 100).toFixed(0)}%`} />
            <Table rows={v.skew} rowKey={s => String(s.expiry)}
              columns={[
                { head: 'Expiry', align: 'left', cell: s => expiryLabel(s.expiry) },
                { head: 'Days', cell: s => Math.round(s.days) },
                { head: 'ATM vol', cell: s => volPct(s.atm) },
                { head: '25Δ risk reversal', cell: s => volPts(s.risk_reversal) },
                { head: '25Δ butterfly', cell: s => volPts(s.butterfly) },
              ]} />
            <Kv data={{ put_call_volume: v.put_call.volume, put_call_open_interest: v.put_call.open_interest }} />
            <Note>
              Solved from bid/ask midpoints across {v.term.length} expiries. A bump in one expiry usually means an event
              inside it, such as earnings. Risk reversal is call minus put volatility at 25 delta; negative means
              protection costs more than upside.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
