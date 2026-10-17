import { Fetched, Note, Table } from '../kit'
import XYChart from '../XYChart'
import type { ViewProps } from './types'
import { useVol, volPct, volPts, type SkewRow } from './vol'
import { expiryLabel } from './options'

const COLOURS = ['stroke-foreground', 'stroke-sky-500', 'stroke-amber-500']

/** Three smiles: the expiries nearest a month, three months and a year. */
function pickThree(rows: SkewRow[]): SkewRow[] {
  const near = (days: number) => rows.reduce((a, b) => (Math.abs(b.days - days) < Math.abs(a.days - days) ? b : a), rows[0])
  const picked = [near(30), near(90), near(365)]
  return picked.filter((r, i) => r && picked.indexOf(r) === i)
}

export default function Skew({ command }: ViewProps) {
  const { data, error, loading } = useVol(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {v => {
        const shown = pickThree(v.skew)
        return (
          <div className="space-y-3">
            <XYChart
              series={shown.map((s, i) => ({
                label: `${expiryLabel(s.expiry)} (${Math.round(s.days)}d)`, cls: COLOURS[i],
                points: s.smile.filter(p => p.moneyness >= 0.7 && p.moneyness <= 1.3).map(p => ({ x: p.moneyness, y: p.iv })),
              }))}
              xFmt={m => `${(m * 100).toFixed(0)}%`} yFmt={y => `${(y * 100).toFixed(0)}%`} />
            <Table rows={v.skew} rowKey={s => String(s.expiry)}
              columns={[
                { head: 'Expiry', align: 'left', cell: s => expiryLabel(s.expiry) },
                { head: '25Δ put', cell: s => volPct(s.put_25d) },
                { head: 'ATM', cell: s => volPct(s.atm) },
                { head: '25Δ call', cell: s => volPct(s.call_25d) },
                { head: 'Risk reversal', cell: s => volPts(s.risk_reversal) },
              ]} />
            <Note>
              Strike as a share of today&rsquo;s price across the bottom. Out-of-the-money puts on the left, calls on the
              right, contracts without a bid left out. A smile that falls to the right is the usual stock skew: crash
              protection costs more.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
