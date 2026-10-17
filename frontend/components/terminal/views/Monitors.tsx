import { useState } from 'react'
import { Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { useFx, rateText } from './fx'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// WEIF, GMM, IRR, MRV, CRYP, FX24, HALT, GRR and FXCA.

function useMonitor<T>(name: string) {
  return useResource<T>(`/api/terminal/monitor/${name}`, { freshMs: 60_000 })
}

interface FutRow { future: string; spot: string; name: string; future_price: number; future_change_pct: number | null; spot_price: number | null; spot_change_pct: number | null; basis: number | null; premium_pct: number | null }

export function Weif({ run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: FutRow[]; missing: string }>('weif')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.future} onRow={r => run(`${r.future.replace('=F', '1')} COMDTY GP 1M`)} columns={[
            { head: 'Future', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.future}</span></span> },
            { head: 'Future', cell: r => price(r.future_price) },
            { head: 'Change', cell: r => pct(r.future_change_pct), className: r => tone(r.future_change_pct) },
            { head: 'Index', cell: r => price(r.spot_price) },
            { head: 'Change', cell: r => pct(r.spot_change_pct), className: r => tone(r.spot_change_pct) },
            { head: 'Basis', cell: r => (r.basis == null ? '—' : r.basis.toFixed(2)) },
            { head: 'Premium', cell: r => pct(r.premium_pct) },
          ]} />
          <Note>Front-month index futures against their index. Before the open the future is the market&apos;s only live read; the premium is mostly interest less dividends to expiry. {d.missing}</Note>
        </div>
      )}
    </Fetched>
  )
}

interface MacroRow { symbol: string; name: string; kind: string; last: number; date: string; change_pct: number; sd_pct: number; z: number | null }

export function Gmm({ run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: MacroRow[] }>('gmm')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`G ${r.symbol} 1Y`)} columns={[
            { head: 'Market', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.kind}</span></span> },
            { head: 'Last', cell: r => price(r.last) },
            { head: 'Move', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
            { head: 'Usual day', cell: r => `±${r.sd_pct.toFixed(2)}%` },
            { head: 'Std devs', cell: r => (r.z == null ? '—' : `${r.z > 0 ? '+' : ''}${r.z.toFixed(1)}`), className: r => (Math.abs(r.z ?? 0) >= 2 ? 'font-semibold' : '') },
            { head: 'As of', align: 'left', cell: r => <span className="text-muted-foreground">{r.date}</span> },
          ]} />
          <Note>The last day&apos;s move in each market against the standard deviation of its daily moves over the year before, biggest surprises first. Yields move in percent of the yield, not in basis points.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface IrrRow { symbol: string; name: string; country: string; years: Record<string, number>; ytd: number }

export function Irr({ command, run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: IrrRow[] }>('irr')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const years = Array.from(new Set(d.rows.flatMap(r => Object.keys(r.years)))).sort().reverse()
        const year = command.args[0] && years.includes(command.args[0]) ? command.args[0] : years[0]
        const ranked = [...d.rows].filter(r => r.years[year] != null).sort((a, b) => b.years[year] - a.years[year])
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1">
              {years.map(y => (
                <button key={y} onClick={() => run(`IRR ${y}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${y === year ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{y}</button>
              ))}
            </div>
            <Table rows={ranked} rowKey={r => r.symbol} onRow={r => run(`G ${r.symbol} 5Y`)} columns={[
              { head: '#', align: 'left', cell: r => ranked.indexOf(r) + 1 },
              { head: 'Index', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.country}</span></span> },
              { head: year, cell: r => pct(r.years[year]), className: r => tone(r.years[year]) },
              ...years.filter(y => y !== year).slice(0, 4).map(y => ({ head: y, cell: (r: IrrRow) => pct(r.years[y] ?? null), className: (r: IrrRow) => tone(r.years[y] ?? null) })),
            ]} />
            <Note>Price return in local currency for each calendar year (the latest year to date), from each year&apos;s last close. Dividends are left out, which flatters low-yield markets.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface MrvRow { symbol: string; country: string; pe: number | null; dividend_yield: number | null; price_to_book: number | null; change_52w_pct: number | null; change_pct: number | null }

export function Mrv({ run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: MrvRow[] }>('mrv')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={[...d.rows].sort((a, b) => (a.pe ?? 99) - (b.pe ?? 99))} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)} columns={[
            { head: 'Market', align: 'left', cell: r => <span><b>{r.country}</b> <span className="text-muted-foreground">{r.symbol}</span></span> },
            { head: 'P/E', cell: r => (r.pe == null ? '—' : r.pe.toFixed(1)) },
            { head: 'Earnings yield', cell: r => (r.pe ? pct(100 / r.pe, false) : '—') },
            { head: 'Dividend yield', cell: r => (r.dividend_yield == null ? '—' : pct(r.dividend_yield, false)) },
            { head: 'Price/book', cell: r => (r.price_to_book == null ? '—' : r.price_to_book.toFixed(2)) },
            { head: '52 weeks', cell: r => pct(r.change_52w_pct), className: r => tone(r.change_52w_pct) },
          ]} />
          <Note>Valuation of each market through its iShares country fund (SPY for the US), as Yahoo reports it: trailing P/E and yield of the fund&apos;s holdings, cheapest first. Funds hold the large companies, not the whole market.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface CoinRow { symbol: string; name: string; price: number; change_pct: number | null; volume: number | null; market_cap: number | null }

export function Cryp({ run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: CoinRow[] }>('cryp')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} GP 1Y`)} columns={[
            { head: 'Coin', align: 'left', cell: r => <span><b>{r.symbol.replace('-USD', '')}</b> <span className="text-muted-foreground">{r.name.replace(/ USD$/, '')}</span></span> },
            { head: 'Price', cell: r => price(r.price) },
            { head: '24 hours', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
            { head: 'Volume', cell: r => big(r.volume) },
            { head: 'Market cap', cell: r => big(r.market_cap) },
          ]} />
          <Note>The fifty largest cryptocurrencies by market value, in dollars, from Yahoo. Crypto trades all day, every day; the change is over the last 24 hours.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Fx24 { pairs: { pair: string; sessions: Record<string, { net_pct: number; per_day_abs_pct: number }>; bars: number }[]; sessions: { name: string; utc: string }[] }

export function FxSessions() {
  const { data, error, loading } = useMonitor<Fx24>('fx24')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.pairs} rowKey={r => r.pair} columns={[
            { head: 'Pair', align: 'left', cell: r => <b>{r.pair.length === 3 ? `USD${r.pair}` : r.pair}</b> },
            ...d.sessions.map(s => ({ head: `${s.name} net`, cell: (r: Fx24['pairs'][number]) => pct(r.sessions[s.name].net_pct), className: (r: Fx24['pairs'][number]) => tone(r.sessions[s.name].net_pct) })),
            ...d.sessions.map(s => ({ head: `${s.name} activity`, cell: (r: Fx24['pairs'][number]) => `${r.sessions[s.name].per_day_abs_pct.toFixed(2)}%` })),
          ]} />
          <Note>
            The last month split by trading session ({d.sessions.map(s => `${s.name} ${s.utc} UTC`).join(', ')}), from 30-minute bars. Net is
            the move made in that session over the month; activity is the day&apos;s summed absolute 30-minute moves, a measure of how much it trades.
          </Note>
        </div>
      )}
    </Fetched>
  )
}

interface Halt { symbol: string; name: string; market: string; reason: string; reason_text: string; halt_date: string; halt_time: string; resume_quote_time: string | null; resume_trade_time: string | null }

export function Halts({ run }: ViewProps) {
  const { data, error, loading } = useMonitor<{ rows: Halt[] }>('halt')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => d.rows.length === 0 ? <Note>No trading halts in Nasdaq&apos;s current list.</Note> : (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={(r, i) => `${r.symbol}${r.halt_time}${i}`} onRow={r => run(`${r.symbol} DES`)} columns={[
            { head: 'Halted', align: 'left', cell: r => `${r.halt_date} ${r.halt_time.slice(0, 8)}` },
            { head: 'Security', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
            { head: 'Market', align: 'left', cell: r => r.market },
            { head: 'Reason', align: 'left', cell: r => `${r.reason_text} (${r.reason})` },
            { head: 'Resumes', align: 'left', cell: r => (r.resume_trade_time ? r.resume_trade_time.slice(0, 8) : 'not yet') },
          ]} />
          <Note>Nasdaq Trader&apos;s halt list, which covers every US-listed stock, Eastern time. Volatility pauses (LUDP) usually last five minutes.</Note>
        </div>
      )}
    </Fetched>
  )
}

type Key = '1d' | '1w' | '1m' | '3m' | 'ytd' | '1y'
type IndRow = { symbol: string; name: string; price: number } & Record<Key, number | null>
const PERIODS: Record<string, Key> = { '1D': '1d', '1W': '1w', '1M': '1m', '3M': '3m', YTD: 'ytd', '1Y': '1y' }

export function Grr({ command, run }: ViewProps) {
  const arg = (command.args[0] ?? '1M').toUpperCase()
  const key = PERIODS[arg] ?? '1m'
  const { data, error, loading } = useResource<{ sectors: IndRow[]; industries: IndRow[] }>('/api/terminal/industries')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {Object.entries(PERIODS).map(([a, k]) => (
          <button key={a} onClick={() => run(`GRR ${a}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${k === key ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{a}</button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const rows = [...d.sectors.map(r => ({ ...r, level: 'Sector' })), ...d.industries.map(r => ({ ...r, level: 'Industry' }))]
            .filter(r => r[key] != null).sort((a, b) => b[key]! - a[key]!)
          return (
            <>
              <Table rows={rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} GP 1Y`)} columns={[
                { head: '#', align: 'left', cell: r => rows.indexOf(r) + 1 },
                { head: 'Group', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.level}, {r.symbol}</span></span> },
                { head: arg, cell: r => pct(r[key]), className: r => tone(r[key]) },
                { head: '1 year', cell: r => pct(r['1y']), className: r => tone(r['1y']) },
              ]} />
              <Note>US sectors and industries ranked by the return of the fund that tracks each one (sector SPDRs and industry ETFs).</Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}

export function Fxca({ command }: ViewProps) {
  const { data, error, loading } = useFx()
  const [amount, setAmount] = useState(command.args[0] && !isNaN(Number(command.args[0])) ? command.args[0] : '1000')
  const [from, setFrom] = useState((command.args[1] ?? 'USD').toUpperCase())
  const [to, setTo] = useState((command.args[2] ?? 'EUR').toUpperCase())
  const input = 'font-mono text-[13px] bg-muted/40 border border-border rounded-md px-2 py-1.5 outline-none focus:border-foreground/40'
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        // units of each currency for one dollar
        const perUsd: Record<string, number> = { USD: 1 }
        for (const c of d.currencies) perUsd[c.code] = c.pair.startsWith(c.code) ? 1 / c.rate : c.rate
        const codes = Object.keys(perUsd).sort()
        const value = Number(amount)
        const result = perUsd[from] && perUsd[to] && Number.isFinite(value) ? (value * perUsd[to]) / perUsd[from] : null
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <input value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" className={`${input} w-32`} aria-label="Amount" />
              <select value={from} onChange={e => setFrom(e.target.value)} className={input} aria-label="From">{codes.map(c => <option key={c}>{c}</option>)}</select>
              <span>to</span>
              <select value={to} onChange={e => setTo(e.target.value)} className={input} aria-label="To">{codes.map(c => <option key={c}>{c}</option>)}</select>
              <span className="text-[18px] font-bold tabular-nums">= {result == null ? '—' : result.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })} {to}</span>
            </div>
            {result != null && <p className="text-[12px] text-muted-foreground tabular-nums">1 {from} = {rateText(perUsd[to] / perUsd[from])} {to}; 1 {to} = {rateText(perUsd[from] / perUsd[to])} {from}</p>}
            <Note>At the latest daily rates from Yahoo, through the dollar, as of {d.currencies[0]?.as_of}. Banks and card schemes add a margin.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
