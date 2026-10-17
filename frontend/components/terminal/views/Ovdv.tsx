import { Fetched, Note } from '../kit'
import type { ViewProps } from './types'
import { useVol } from './vol'
import { expiryLabel } from './options'

/** Lighter for low volatility, darker for high, within this surface. */
export function shade(iv: number | null, lo: number, hi: number): string {
  if (iv == null) return 'transparent'
  const f = hi > lo ? (iv - lo) / (hi - lo) : 0.5
  return `hsl(205 85% 50% / ${(0.08 + 0.62 * f).toFixed(2)})`
}

export default function Ovdv({ command }: ViewProps) {
  const { data, error, loading } = useVol(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {v => {
        const all = v.surface.flatMap(r => r.iv).filter((x): x is number => x != null)
        const lo = Math.min(...all), hi = Math.max(...all)
        return (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-1.5 px-2 text-left">Expiry</th>
                    {v.moneyness.map(m => <th key={m} className="py-1.5 px-2 text-right">{(m * 100).toFixed(0)}%</th>)}
                  </tr>
                </thead>
                <tbody>
                  {v.surface.map(r => (
                    <tr key={r.expiry} className="border-b border-border/30">
                      <td className="py-1.5 px-2 whitespace-nowrap">{expiryLabel(r.expiry)} <span className="text-muted-foreground">{Math.round(r.days)}d</span></td>
                      {r.iv.map((x, i) => (
                        <td key={i} className="py-1.5 px-2 text-right" style={{ background: shade(x, lo, hi) }}>
                          {x == null ? '' : (x * 100).toFixed(1)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              Implied volatility (%) by strike as a share of today&rsquo;s price, across expiries. Blank where no
              traded contract reaches that strike; values are interpolated between listed strikes, never extrapolated.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
