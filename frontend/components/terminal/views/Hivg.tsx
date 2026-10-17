import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useVol, volPct } from './vol'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { day } from '@/lib/terminal/numbers'

export default function Hivg({ command }: ViewProps) {
  const { data, error, loading } = useVol(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {v => {
        const first = v.iv_history[0]?.date
        const series = [{ label: 'realized, 30 days', points: v.realized_30d, cls: 'stroke-muted-foreground' }]
        if (v.iv_history.length > 1) {
          series.push({ label: 'implied, 30 days', points: v.iv_history.map(h => ({ t: h.date, v: h.iv30 * 100 })), cls: 'stroke-sky-500' })
        }
        return (
          <div className="space-y-3">
            <TimeSeriesChart series={series} H={200} unit="%" yFmt={y => y.toFixed(0)} />
            <ChartLegend items={series.map(s => ({ label: s.label, cls: s.cls }))} />
            <Table rows={Object.entries(v.realized)} rowKey={([k]) => k}
              columns={[
                { head: 'Window', align: 'left', cell: ([k]) => `${k.replace('d', '')} trading days` },
                { head: 'Realized', cell: ([, x]) => volPct(x) },
                { head: 'Implied 30d minus realized', cell: ([, x]) => (x != null && v.iv30 != null ? `${((v.iv30 - x) * 100).toFixed(1)} pts` : '—') },
              ]} />
            <Note>
              Free sources keep no history of implied volatility, so Artha records one 30-day reading a day for each
              security asked about. This one has {v.iv_history.length} reading{v.iv_history.length === 1 ? '' : 's'} since {day(first)};
              the implied line appears from the second day. Realized volatility goes back a year.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
