import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { argSymbol } from '@/lib/terminal/parse'
import { useResource } from '@/lib/useResource'

// VM, OVI, MOSO, CWS, OSCH, VSV, VCAL and CDVM, on Cboe's delayed chains.

const CBOE = "Cboe's public delayed option quotes, 15 minutes late."
const vol = (v: number | null | undefined) => (v == null ? '—' : v.toFixed(1))

function useTool<T>(kind: string, params: Record<string, string | number | null | undefined> = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '').map(([k, v]) => [k, String(v)]))
  return useResource<T>(`/api/terminal/optools/${kind}${q.toString() ? `?${q}` : ''}`, { freshMs: 5 * 60_000 })
}

interface Vm { family: { symbol: string; name: string; level: number; change_pct: number | null }[]; curve_shape: string | null; names: { symbol: string; iv30: number | null; iv30_change: number | null; price: number | null }[] }

export function VolMonitor({ command, run }: ViewProps) {
  const list = [command.security?.symbol, ...command.args.map(argSymbol)].filter(Boolean).join(',')
  const { data, error, loading } = useTool<Vm>('vm', { symbols: list || null })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          {d.curve_shape && <p className="text-[13px]">The VIX curve is in <b>{d.curve_shape}</b>: three-month implied volatility is {d.curve_shape.startsWith('contango') ? 'above' : 'below'} one-month.</p>}
          <div className="grid sm:grid-cols-2 gap-4">
            <Table rows={d.family} rowKey={r => r.symbol} onRow={r => run(`${r.symbol.replace('^', '')} INDEX GP 1Y`)} columns={[
              { head: 'Index', align: 'left', cell: r => <span><b>{r.symbol.replace('^', '')}</b> <span className="text-muted-foreground">{r.name}</span></span> },
              { head: 'Level', cell: r => r.level.toFixed(2) },
              { head: 'Change', cell: r => pct(r.change_pct), className: r => tone(r.change_pct == null ? null : -r.change_pct) },
            ]} />
            <Table rows={d.names} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} IVOL`)} columns={[
              { head: 'Security', align: 'left', cell: r => <b>{r.symbol}</b> },
              { head: '30-day implied vol', cell: r => vol(r.iv30) },
              { head: 'Price', cell: r => price(r.price) },
            ]} />
          </div>
          <Note>Cboe&apos;s volatility indices from Yahoo, and each security&apos;s 30-day implied volatility from {CBOE} Name your own list: VM AAPL TSLA NVDA.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Act { symbol: string; price: number | null; change_pct: number | null; iv30: number | null; call_volume: number; put_volume: number; volume: number; open_interest: number; volume_to_oi: number | null; put_call: number | null }
interface Contract { underlying: string; symbol: string; expiry: string; kind: string; strike: number; volume: number; open_interest: number; iv: number | null; delta: number | null; bid: number; ask: number; last: number | null }

export function OptionActivity({ command, run }: ViewProps) {
  const { data, error, loading } = useTool<{ names: Act[]; contracts: Contract[]; universe: number }>('activity')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => command.fn === 'MOSO' ? (
        <div className="space-y-3">
          <Table rows={d.contracts} rowKey={c => c.symbol} onRow={c => run(`${c.underlying} OMON`)} columns={[
            { head: 'Contract', align: 'left', cell: c => <span><b>{c.underlying}</b> {c.expiry} {c.strike} {c.kind === 'C' ? 'call' : 'put'}</span> },
            { head: 'Volume', cell: c => c.volume.toLocaleString('en-US') },
            { head: 'Open interest', cell: c => c.open_interest.toLocaleString('en-US') },
            { head: 'Vol / OI', cell: c => (c.open_interest ? (c.volume / c.open_interest).toFixed(1) : '—') },
            { head: 'Last', cell: c => (c.last == null ? '—' : c.last.toFixed(2)) },
            { head: 'IV', cell: c => (c.iv == null ? '—' : `${(c.iv * 100).toFixed(1)}%`) },
            { head: 'Delta', cell: c => (c.delta == null ? '—' : c.delta.toFixed(2)) },
          ]} />
          <Note>The most traded contracts of the last session across {d.universe} of the most active US option names. {CBOE}</Note>
        </div>
      ) : (
        <div className="space-y-3">
          <Table rows={d.names} rowKey={a => a.symbol} onRow={a => run(`${a.symbol} OMON`)} columns={[
            { head: 'Security', align: 'left', cell: a => <b>{a.symbol}</b> },
            { head: 'Volume', cell: a => big(a.volume) },
            { head: 'Open interest', cell: a => big(a.open_interest) },
            { head: 'Volume / OI', cell: a => (a.volume_to_oi == null ? '—' : a.volume_to_oi.toFixed(2)), className: a => ((a.volume_to_oi ?? 0) > 0.5 ? 'font-semibold text-amber-600 dark:text-amber-400' : '') },
            { head: 'Put/call', cell: a => (a.put_call == null ? '—' : a.put_call.toFixed(2)) },
            { head: '30-day IV', cell: a => vol(a.iv30) },
            { head: 'Stock today', cell: a => pct(a.change_pct), className: a => tone(a.change_pct) },
          ]} />
          <Note>Option volume against open interest, highest first: volume near or above open interest means new positions are being opened, not old ones traded. {d.universe} names. {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Cw { expiry: string; days: number; strike: number; bid: number; delta: number | null; open_interest: number; static_pct: number; if_called_pct: number; static_annual_pct: number; if_called_annual_pct: number; breakeven: number; protection_pct: number }

export function CoveredCalls({ command, run }: ViewProps) {
  const sec = command.security!
  const { data, error, loading } = useTool<{ price: number; rows: Cw[] }>('cws', { symbol: sec.symbol })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Note>No bid calls between today&apos;s price and 15% above it.</Note> : (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => `${r.expiry}${r.strike}`} onRow={() => run(`${sec.label} OMON`)} columns={[
            { head: 'Expiry', align: 'left', cell: r => `${r.expiry} (${r.days}d)` },
            { head: 'Strike', cell: r => r.strike.toFixed(2) },
            { head: 'Bid', cell: r => r.bid.toFixed(2) },
            { head: 'Delta', cell: r => r.delta?.toFixed(2) ?? '—' },
            { head: 'If unchanged', cell: r => pct(r.static_pct, false) },
            { head: 'If called', cell: r => pct(r.if_called_pct, false) },
            { head: 'Called, a year', cell: r => pct(r.if_called_annual_pct, false) },
            { head: 'Breakeven', cell: r => price(r.breakeven) },
          ]} />
          <Note>Buy {sec.label} at {price(d.price)} and sell one call at its bid, held to expiry. If unchanged: you keep the premium. If called: the shares go at the strike. Delta is roughly the chance of being called. Dividends and costs left out. {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Opt { symbol: string; expiry: string; kind: string; strike: number; bid: number; ask: number; iv: number | null; delta: number | null; gamma: number | null; theta: number | null; vega: number | null; volume: number; open_interest: number }

function range(args: string[], key: string, fallback: [number, number]): [number, number] {
  const i = args.findIndex(a => a.toUpperCase() === key)
  const m = i >= 0 ? args[i + 1]?.match(/^([\d.]+)-([\d.]+)$/) : null
  return m ? [Number(m[1]), Number(m[2])] : fallback
}

export function OptionSearch({ command, run }: ViewProps) {
  const sec = command.security!
  const [d0, d1] = range(command.args, 'DAYS', [0, 400])
  const [x0, x1] = range(command.args, 'DELTA', [0, 1])
  const up = command.args.map(a => a.toUpperCase())
  const side = up.includes('CALLS') ? 'C' : up.includes('PUTS') ? 'P' : null
  const vi = up.indexOf('VOL')
  const minVol = vi >= 0 ? Number(command.args[vi + 1]) || 0 : 0
  const { data, error, loading } = useTool<{ price: number; rows: Opt[]; matched: number }>('search', {
    symbol: sec.symbol, min_days: d0, max_days: d1, min_delta: x0, max_delta: x1, side, min_volume: minVol })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[12px] text-muted-foreground">{d.matched} contracts match{d.matched > 300 ? '; the first 300 shown' : ''}. Filters: {sec.label} OSCH DAYS 20-60 DELTA 0.2-0.3 CALLS VOL 100.</p>
          <Table rows={d.rows} rowKey={o => o.symbol} onRow={() => run(`${sec.label} OMON`)} columns={[
            { head: 'Expiry', align: 'left', cell: o => o.expiry },
            { head: 'Type', align: 'left', cell: o => (o.kind === 'C' ? 'call' : 'put') },
            { head: 'Strike', cell: o => o.strike.toFixed(2) },
            { head: 'Bid', cell: o => o.bid.toFixed(2) },
            { head: 'Ask', cell: o => o.ask.toFixed(2) },
            { head: 'IV', cell: o => (o.iv == null ? '—' : `${(o.iv * 100).toFixed(1)}%`) },
            { head: 'Delta', cell: o => o.delta?.toFixed(3) ?? '—' },
            { head: 'Theta', cell: o => o.theta?.toFixed(3) ?? '—' },
            { head: 'Volume', cell: o => o.volume.toLocaleString('en-US') },
            { head: 'Open int.', cell: o => o.open_interest.toLocaleString('en-US') },
          ]} />
          <Note>Every listed {sec.label} option that meets the filters, with Cboe&apos;s implied volatility and greeks. {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Vsv { days: number; fair_vol_strike: number; variance_strike: number; realized_vol: number; cboe_iv30: number | null; legs: { expiry: string; days: number; vol: number; forward: number; k0: number; strikes: number }[] }

export function VarianceSwap({ command }: ViewProps) {
  const sec = command.security!
  const days = Number(command.args[0]) || 30
  const { data, error, loading } = useTool<Vsv>('vsv', { symbol: sec.symbol, days })
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px] tabular-nums">Fair {d.days}-day variance swap strike <b className="text-[16px]">{d.fair_vol_strike.toFixed(2)}</b> volatility points; realised over the last {d.days} trading days {d.realized_vol.toFixed(2)}; Cboe&apos;s at-the-money 30-day implied {vol(d.cboe_iv30)}.</p>
          <Table rows={d.legs} rowKey={l => l.expiry} columns={[
            { head: 'Expiry', align: 'left', cell: l => `${l.expiry} (${l.days}d)` },
            { head: 'Replicated vol', cell: l => (l.vol * 100).toFixed(2) },
            { head: 'Forward', cell: l => price(l.forward) },
            { head: 'K0', cell: l => price(l.k0) },
            { head: 'Strikes used', cell: l => l.strikes },
          ]} />
          <Note>By replication, the Cboe VIX method on {sec.label}&apos;s own options: out-of-the-money puts and calls weighted by one over strike squared, for the two expiries either side of {d.days} days, interpolated in total variance. On the S&amp;P 500 it reproduces the VIX. It sits above at-the-money volatility because it prices the whole smile. {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Move { symbol: string; earnings?: string; expiry?: string; strike?: number; straddle?: number; price?: number; implied_move_pct?: number; iv30?: number | null; error?: string }

export function EarningsMoves({ command, run }: ViewProps) {
  const names = [command.security?.symbol, ...command.args.map(argSymbol)].filter(Boolean) as string[]
  const { data, error, loading } = useTool<{ rows: Move[] }>('vcal', { symbols: names.join(',') || null })
  if (!names.length) return <Note>Name the companies: VCAL AAPL MSFT NVDA NFLX.</Note>
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={[...d.rows].sort((a, b) => (a.earnings ?? '9').localeCompare(b.earnings ?? '9'))} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} EVTS`)} columns={[
            { head: 'Company', align: 'left', cell: r => <b>{r.symbol}</b> },
            { head: 'Reports', align: 'left', cell: r => r.earnings ?? '—' },
            { head: 'Expiry used', align: 'left', cell: r => r.expiry ?? '' },
            { head: 'Straddle', cell: r => (r.straddle == null ? '—' : r.straddle.toFixed(2)) },
            { head: 'Implied move', cell: r => (r.implied_move_pct == null ? '—' : `±${r.implied_move_pct.toFixed(1)}%`), className: () => 'font-semibold' },
            { head: '30-day IV', cell: r => vol(r.iv30) },
            { head: 'Note', align: 'left', cell: r => <span className="text-muted-foreground">{r.error ?? ''}</span> },
          ]} />
          <Note>The move the options price for each report: the at-the-money straddle of the first expiry after the earnings date, over the share price. It includes the days around the report too, so it slightly overstates the earnings-day move. {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Cd { future: string; fund: string; name: string; hv20: number | null; hv60: number | null; hv250: number | null; fund_iv30: number | null }

export function CommodityVol({ run }: ViewProps) {
  const { data, error, loading } = useTool<{ rows: Cd[] }>('cdvm')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Fail message="No commodity data just now." /> : (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.future} onRow={r => run(`${r.future.replace('=F', '1')} COMDTY GP 1Y`)} columns={[
            { head: 'Commodity', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.future}</span></span> },
            { head: 'Realised 20d', cell: r => vol(r.hv20) },
            { head: 'Realised 60d', cell: r => vol(r.hv60) },
            { head: 'Realised 1y', cell: r => vol(r.hv250) },
            { head: 'Implied 30d', cell: r => vol(r.fund_iv30) },
            { head: 'Fund', align: 'left', cell: r => <span className="text-muted-foreground">{r.fund}</span> },
          ]} />
          <Note>Realised volatility of the front futures contract from Yahoo, and implied volatility from the options on the fund that tracks it, which is not the same as options on the future itself (those are CME data). {CBOE}</Note>
        </div>
      )}
    </Fetched>
  )
}
