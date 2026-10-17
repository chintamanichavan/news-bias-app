import { Fetched, Kv, Note } from '../kit'
import { useDossier } from './dossier'
import type { ViewProps } from './types'
import { TimeSeriesChart } from '@/components/quantviz'

export default function Risk({ command }: ViewProps) {
  const { data, error, loading } = useDossier(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4">
            <Kv title={`Against ${d.relative.benchmark}`} data={{ beta: d.relative.beta, correlation: d.relative.correlation }} />
            <Kv title="Return and spread, a year" data={d.moments} />
            <Kv title="Risk-adjusted" data={d.risk_adjusted} />
            <Kv title="Bad days" data={{
              var_95_pct: d.tails.var_95_pct, var_99_pct: d.tails.var_99_pct,
              cvar_95_pct: d.tails.cvar_95_pct, cvar_99_pct: d.tails.cvar_99_pct,
            }} />
          </div>
          {d.rolling_vol_30d.length > 1 && (
            <div>
              <p className="news-section-label mb-1.5">30-day volatility, yearly %</p>
              <TimeSeriesChart
                series={[{ label: 'vol', points: d.rolling_vol_30d.map(p => ({ t: p.date, v: p.vol })), cls: 'stroke-indigo-500' }]}
                H={120} unit="%" />
            </div>
          )}
          <Note>From {d.observations} daily closes, {d.span.from} to {d.span.to}.</Note>
        </div>
      )}
    </Fetched>
  )
}
