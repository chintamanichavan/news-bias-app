import { useEffect, useState } from 'react'
import { Fetched, Note } from '../kit'
import { expiryAtLeast, expiryDate, expiryLabel, premium, useChain, type Chain } from './options'
import type { ViewProps } from './types'
import { greeks, parseContract, price as bsPrice, type Kind } from '@/lib/terminal/bs'

interface Pick { kind: Kind; strike: number; expiry: number }

/** The contract OV opens on: the one named, else the at-the-money call
 *  about a month out. */
function choose(chain: Chain, named: ReturnType<typeof parseContract>): Pick | null {
  if (named) {
    const expiry = chain.expirations.find(e => expiryDate(e) === named.expiry)
    return expiry ? { kind: named.kind, strike: named.strike, expiry } : null
  }
  const atm = chain.rows.reduce((a, b) => (Math.abs(b.strike - chain.spot) < Math.abs(a.strike - chain.spot) ? b : a), chain.rows[0])
  return atm ? { kind: 'C', strike: atm.strike, expiry: chain.expiry } : null
}

function Field({ label, value, onChange, step }: { label: string; value: number; onChange: (v: number) => void; step: number }) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-muted-foreground">
      {label}
      <input type="number" step={step} value={Number.isFinite(value) ? Number(value.toFixed(step < 1 ? 2 : 1)) : ''}
        onChange={e => onChange(Number(e.target.value))}
        className="w-28 font-mono text-[12.5px] text-foreground bg-muted/40 border border-border rounded px-2 py-1 outline-none focus:border-foreground/40" />
    </label>
  )
}

export default function Ov({ command, run }: ViewProps) {
  const sec = command.security!
  const named = command.args[0] ? parseContract(command.args[0]) : null
  // first load the nearest chain for its list of expiries, then the chosen one
  const nearest = useChain(sec.symbol, null)
  const target = nearest.data
    ? (named ? nearest.data.expirations.find(e => expiryDate(e) === named.expiry) ?? null
      : expiryAtLeast(nearest.data.expirations, 25))
    : null
  const chosen = useChain(sec.symbol, target)

  if (command.args[0] && !named) return <Note>{command.args[0]} is not an option symbol. Pick one from OMON.</Note>
  return (
    <Fetched data={chosen.data && target ? chosen.data : null} error={nearest.error ?? chosen.error} loading={nearest.loading || chosen.loading || !target}>
      {c => <Valuation chain={c} pick={choose(c, named)} openChain={() => run(`${sec.label} OMON`)} />}
    </Fetched>
  )
}

function Valuation({ chain, pick, openChain }: { chain: Chain; pick: Pick | null; openChain: () => void }) {
  const row = pick && chain.rows.find(r => r.strike === pick.strike)
  const side = pick && row ? (pick.kind === 'C' ? row.call : row.put) : undefined
  const market = { s: chain.spot, vol: side?.iv ?? 0.3, days: chain.years * 365, r: chain.rate, q: chain.dividend_yield }
  const [x, setX] = useState(market)
  useEffect(() => { setX(market) }, [chain.expiry, pick?.strike, pick?.kind])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!pick || !side) return <Note>That contract is not listed. <button onClick={openChain} className="underline">Open the chain</button>.</Note>
  const input = { s: x.s, k: pick.strike, t: x.days / 365, r: x.r, q: x.q, vol: x.vol }
  const value = bsPrice(pick.kind, input)
  const g = greeks(pick.kind, input)
  const gap = side.mid != null ? value - side.mid : null

  return (
    <div className="space-y-4">
      <p className="text-[13px]">
        <b>{side.symbol}</b> · {pick.kind === 'C' ? 'call' : 'put'} {pick.strike} expiring {expiryLabel(pick.expiry)}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] tabular-nums">
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Bid / ask</div>{premium(side.bid)} / {premium(side.ask)}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Midpoint</div>{premium(side.mid)}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Implied vol</div>{side.iv != null ? `${(side.iv * 100).toFixed(1)}%` : '—'}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Volume / OI</div>{side.volume ?? 0} / {side.open_interest ?? 0}</div>
      </div>
      <div className="flex flex-wrap gap-3 items-end">
        <Field label="Underlying" value={x.s} step={1} onChange={s => setX({ ...x, s })} />
        <Field label="Volatility %" value={x.vol * 100} step={0.5} onChange={v => setX({ ...x, vol: v / 100 })} />
        <Field label="Days left" value={x.days} step={1} onChange={days => setX({ ...x, days })} />
        <Field label="Rate %" value={x.r * 100} step={0.05} onChange={r => setX({ ...x, r: r / 100 })} />
        <Field label="Dividend %" value={x.q * 100} step={0.05} onChange={q => setX({ ...x, q: q / 100 })} />
        <button onClick={() => setX(market)} className="text-[11px] px-2 py-1 rounded-full bg-muted/60 hover:bg-muted">Reset to market</button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-[12px] tabular-nums">
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Model value</div><b className="text-lg">{premium(value)}</b>
          {gap != null && <div className="text-[10.5px] text-muted-foreground">{gap >= 0 ? '+' : ''}{gap.toFixed(2)} vs midpoint</div>}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Delta</div>{g.delta.toFixed(3)}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Gamma</div>{g.gamma.toFixed(4)}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Theta / day</div>{g.theta.toFixed(3)}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Vega / vol pt</div>{g.vega.toFixed(3)}</div>
      </div>
      <Note>
        Change any input to see the value move. At the market inputs the model value equals the midpoint, since the
        volatility is solved from it. European Black-Scholes-Merton; per contract of 100 shares, multiply by 100.
      </Note>
    </div>
  )
}
