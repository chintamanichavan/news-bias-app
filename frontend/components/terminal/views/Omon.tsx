import { useState } from 'react'
import { Fetched, Note } from '../kit'
import { around, expiryLabel, premium, useChain, type Side } from './options'
import type { ViewProps } from './types'
import { big, price } from '@/lib/terminal/numbers'

const ivText = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}`)
const deltaText = (v: number | undefined) => (v == null ? '—' : v.toFixed(2))
const STRIKES_EACH_SIDE = 12

function cells(s: Side | undefined, reverse: boolean) {
  const values = s
    ? [big(s.open_interest), big(s.volume), ivText(s.iv), deltaText(s.delta), premium(s.bid), premium(s.ask)]
    : Array(6).fill('')
  return reverse ? [...values].reverse() : values
}

const HEAD = ['OI', 'Vol', 'IV %', 'Δ', 'Bid', 'Ask']

export default function Omon({ command, run }: ViewProps) {
  const sec = command.security!
  const [expiry, setExpiry] = useState<number | null>(null)
  const { data, error, loading } = useChain(sec.symbol, expiry)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {c => {
        const rows = around(c.rows, c.spot, STRIKES_EACH_SIDE)
        const open = (s?: Side) => s && run(`${sec.label} OV ${s.symbol}`)
        return (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1">
              {c.expirations.slice(0, 16).map(e => (
                <button key={e} onClick={() => setExpiry(e)}
                  className={`text-[11px] px-2 py-0.5 rounded-full tabular-nums ${e === c.expiry
                    ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
                  {expiryLabel(e)}
                </button>
              ))}
            </div>
            <p className="text-[12px] tabular-nums">
              Spot <b>{price(c.spot)}</b> · {Math.round(c.years * 365)} days · rate {(c.rate * 100).toFixed(2)}% ·
              dividend {(c.dividend_yield * 100).toFixed(2)}%
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[11.5px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th colSpan={6} className="text-center border-b border-border py-1">Calls</th>
                    <th />
                    <th colSpan={6} className="text-center border-b border-border py-1">Puts</th>
                  </tr>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    {HEAD.map(h => <th key={`c${h}`} className="py-1 px-1.5 text-right">{h}</th>)}
                    <th className="py-1 px-2 text-center">Strike</th>
                    {[...HEAD].reverse().map(h => <th key={`p${h}`} className="py-1 px-1.5 text-right">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.strike} className="border-b border-border/40 last:border-0">
                      {cells(r.call, false).map((v, i) => (
                        <td key={`c${i}`} onClick={() => open(r.call)}
                          className={`py-1 px-1.5 text-right cursor-pointer ${r.strike < c.spot ? 'bg-sky-500/10' : ''}`}>{v}</td>
                      ))}
                      <td className="py-1 px-2 text-center font-semibold">{r.strike}</td>
                      {cells(r.put, true).map((v, i) => (
                        <td key={`p${i}`} onClick={() => open(r.put)}
                          className={`py-1 px-1.5 text-right cursor-pointer ${r.strike > c.spot ? 'bg-sky-500/10' : ''}`}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              Shaded: in the money. IV and Δ are solved from each bid/ask midpoint with Black-Scholes-Merton, the Treasury rate
              for this maturity and the trailing dividend yield; Yahoo&rsquo;s own IVs assume roughly zero interest and run high on
              longer expiries. US stock options are American, so deep in-the-money puts are only approximate. Click a
              contract to value it.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
