import { useEffect, useMemo, useState } from 'react'
import { Fetched, Note, Table } from '../kit'
import XYChart from '../XYChart'
import { expiryAtLeast, expiryLabel, premium, useChain, type Chain } from './options'
import type { ViewProps } from './types'
import { breakEvens, netCost, pnl, positionGreeks, type Leg, type Market } from '@/lib/terminal/scenario'
import { pct, tone } from '@/lib/terminal/numbers'

// Each preset is legs at strike steps from the at-the-money strike.
type Spec = { kind: 'C' | 'P' | 'S'; qty: number; step: number }
const PRESETS: Record<string, { name: string; legs: Spec[] }> = {
  CALL: { name: 'Long call', legs: [{ kind: 'C', qty: 1, step: 0 }] },
  PUT: { name: 'Long put', legs: [{ kind: 'P', qty: 1, step: 0 }] },
  COVERED: { name: 'Covered call', legs: [{ kind: 'S', qty: 100, step: 0 }, { kind: 'C', qty: -1, step: 2 }] },
  PROTECT: { name: 'Protective put', legs: [{ kind: 'S', qty: 100, step: 0 }, { kind: 'P', qty: 1, step: -2 }] },
  BULL: { name: 'Bull call spread', legs: [{ kind: 'C', qty: 1, step: 0 }, { kind: 'C', qty: -1, step: 3 }] },
  BEAR: { name: 'Bear put spread', legs: [{ kind: 'P', qty: 1, step: 0 }, { kind: 'P', qty: -1, step: -3 }] },
  STRADDLE: { name: 'Straddle', legs: [{ kind: 'C', qty: 1, step: 0 }, { kind: 'P', qty: 1, step: 0 }] },
  STRANGLE: { name: 'Strangle', legs: [{ kind: 'C', qty: 1, step: 2 }, { kind: 'P', qty: 1, step: -2 }] },
  CONDOR: { name: 'Iron condor', legs: [
    { kind: 'P', qty: 1, step: -4 }, { kind: 'P', qty: -1, step: -2 }, { kind: 'C', qty: -1, step: 2 }, { kind: 'C', qty: 1, step: 4 },
  ] },
}

const MOVES = [-20, -10, -5, 0, 5, 10, 20]

/** The strikes where both a call and a put trade with a price and a volatility. */
function liquidStrikes(c: Chain): number[] {
  return c.rows.filter(r => r.call?.mid && r.call.iv && r.put?.mid && r.put.iv).map(r => r.strike)
}

function legFor(c: Chain, kind: 'C' | 'P' | 'S', qty: number, strike: number): Leg {
  if (kind === 'S') return { kind, qty, strike: 0, entry: c.spot, iv: 0 }
  const row = c.rows.find(r => r.strike === strike)
  const side = kind === 'C' ? row?.call : row?.put
  return { kind, qty, strike, entry: side?.mid ?? 0, iv: side?.iv ?? 0.3 }
}

function build(c: Chain, preset: string): Leg[] {
  const strikes = liquidStrikes(c)
  if (strikes.length === 0) return []
  const atm = strikes.reduce((a, b, i) => (Math.abs(b - c.spot) < Math.abs(strikes[a] - c.spot) ? i : a), 0)
  return PRESETS[preset].legs.map(l => legFor(c, l.kind, l.qty, strikes[Math.min(strikes.length - 1, Math.max(0, atm + l.step))]))
}

export default function Osa({ command, run }: ViewProps) {
  const sec = command.security!
  const preset = PRESETS[command.args[0]?.toUpperCase() ?? ''] ? command.args[0].toUpperCase() : 'CALL'
  const [expiry, setExpiry] = useState<number | null>(null)
  const nearest = useChain(sec.symbol, null)
  const target = expiry ?? (nearest.data ? expiryAtLeast(nearest.data.expirations, 25) : null)
  const chosen = useChain(sec.symbol, target)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {Object.entries(PRESETS).map(([key, p]) => (
          <button key={key} onClick={() => run(`${sec.label} OSA ${key}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full ${key === preset
              ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {p.name}
          </button>
        ))}
      </div>
      <Fetched data={chosen.data && target ? chosen.data : null} error={nearest.error ?? chosen.error}
        loading={nearest.loading || chosen.loading || !target}>
        {c => <Scenario chain={c} preset={preset} onExpiry={setExpiry} />}
      </Fetched>
    </div>
  )
}

function Scenario({ chain, preset, onExpiry }: { chain: Chain; preset: string; onExpiry: (e: number) => void }) {
  const [legs, setLegs] = useState<Leg[]>(() => build(chain, preset))
  useEffect(() => { setLegs(build(chain, preset)) }, [chain.expiry, preset])  // eslint-disable-line react-hooks/exhaustive-deps
  const strikes = useMemo(() => liquidStrikes(chain), [chain])
  const m: Market = { spot: chain.spot, days: chain.years * 365, r: chain.rate, q: chain.dividend_yield }

  if (legs.length === 0) return <Note>No strikes with prices on both sides for this expiry.</Note>
  const lo = chain.spot * 0.7, hi = chain.spot * 1.3
  const grid = Array.from({ length: 61 }, (_, i) => lo + ((hi - lo) * i) / 60)
  const curve = (daysPassed: number) => grid.map(s => ({ x: s, y: pnl(legs, m, { spot: s, daysPassed, volShift: 0 }) }))
  const atExpiry = curve(m.days)
  const g = positionGreeks(legs, m)
  const cost = netCost(legs)
  const be = breakEvens(legs, m, lo, hi)
  // whole dollars; anything that rounds to zero is shown as $0, never −$0
  const money = (v: number) => `${Math.round(v) < 0 ? '−' : ''}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`

  const setLeg = (i: number, patch: Partial<Leg>) =>
    setLegs(ls => ls.map((l, j) => (j === i ? legFor(chain, l.kind, patch.qty ?? l.qty, patch.strike ?? l.strike) : l)))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1">
        {chain.expirations.slice(0, 14).map(e => (
          <button key={e} onClick={() => onExpiry(e)}
            className={`text-[11px] px-2 py-0.5 rounded-full tabular-nums ${e === chain.expiry
              ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
            {expiryLabel(e)}
          </button>
        ))}
      </div>
      <Table rows={legs.map((l, i) => ({ ...l, i }))} rowKey={l => String(l.i)}
        columns={[
          { head: 'Leg', align: 'left', cell: l => (l.kind === 'S' ? 'Stock' : l.kind === 'C' ? 'Call' : 'Put') },
          { head: 'Quantity', cell: l => (
            <input type="number" value={l.qty} step={l.kind === 'S' ? 100 : 1} onChange={e => setLeg(l.i, { qty: Number(e.target.value) })}
              className="w-20 text-right font-mono bg-muted/40 border border-border rounded px-1.5 py-0.5" />) },
          { head: 'Strike', cell: l => (l.kind === 'S' ? '—' : (
            <select value={l.strike} onChange={e => setLeg(l.i, { strike: Number(e.target.value) })}
              className="font-mono bg-muted/40 border border-border rounded px-1 py-0.5">
              {strikes.map(k => <option key={k} value={k}>{k}</option>)}
            </select>)) },
          { head: 'Price', cell: l => premium(l.entry) },
          { head: 'Vol', cell: l => (l.kind === 'S' ? '—' : `${(l.iv * 100).toFixed(1)}%`) },
        ]} />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-[12px] tabular-nums">
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">{cost >= 0 ? 'Costs' : 'Collects'}</div><b>{money(Math.abs(cost))}</b></div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Break-even at expiry</div>{be.length ? be.map(b => b.toFixed(2)).join(' and ') : 'none in ±30%'}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Best / worst at expiry (±30%)</div>
          {money(Math.max(...atExpiry.map(p => p.y)))} / {money(Math.min(...atExpiry.map(p => p.y)))}</div>
        <div><div className="text-muted-foreground text-[10px] uppercase tracking-wider">Δ shares · θ/day · vega/pt</div>
          {g.delta.toFixed(0)} · {money(g.theta)} · {money(g.vega)}</div>
      </div>
      <XYChart zeroLine
        series={[
          { label: 'Today', cls: 'stroke-sky-500', points: curve(0) },
          { label: 'Halfway', cls: 'stroke-amber-500', points: curve(m.days / 2) },
          { label: 'At expiry', cls: 'stroke-foreground', points: atExpiry },
        ]}
        xFmt={x => x.toFixed(0)} yFmt={y => money(y)} />
      <Table rows={MOVES} rowKey={mv => String(mv)}
        columns={[
          { head: 'Underlying move', align: 'left', cell: mv => `${pct(mv)} to ${(chain.spot * (1 + mv / 100)).toFixed(2)}` },
          ...[['Today', 0], ['Halfway', m.days / 2], ['At expiry', m.days]].map(([head, daysPassed]) => ({
            head: head as string,
            cell: (mv: number) => money(pnl(legs, m, { spot: chain.spot * (1 + mv / 100), daysPassed: daysPassed as number, volShift: 0 })),
            className: (mv: number) => tone(pnl(legs, m, { spot: chain.spot * (1 + mv / 100), daysPassed: daysPassed as number, volShift: 0 })),
          })),
        ]} />
      <Note>
        Profit or loss of the whole position in dollars (100 shares a contract), at midpoint prices, with volatility
        held at each leg&rsquo;s implied level. Commissions and the bid/ask spread are left out; real fills cost more.
      </Note>
    </div>
  )
}
