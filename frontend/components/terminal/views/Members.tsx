import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// MEMB (members and weights), GWGT (sector weights), MRR (members ranked
// by return), WEIB (breadth) and LVI (unusual volume), for SPX, INDU, NDX.

interface Row {
  symbol: string; name: string | null; weight: number; sector: string | null; price: number | null; change_pct: number | null
  volume: number | null; change_52w_pct: number | null; high_52w: number | null; low_52w: number | null; from_high_pct: number | null
  vs_50d_pct: number | null; vs_200d_pct: number | null; avg_volume_3m: number | null; pe: number | null; market_cap: number | null
  volume_ratio: number | null
}
interface Sector { sector: string; weight: number; members: number; change_pct: number | null }
interface Breadth {
  members: number; advancing: number; declining: number; unchanged: number; new_highs: number; new_lows: number
  above_50d_pct: number | null; above_200d_pct: number | null; up_volume_pct: number | null
}
interface Members { index: string; name: string; fund: string; as_of: string | null; rows: Row[]; sectors: Sector[]; breadth: Breadth }

const INDICES = ['SPX', 'INDU', 'NDX']
const RANKS: Record<string, { head: string; get: (r: Row) => number | null }> = {
  '1D': { head: 'Today', get: r => r.change_pct },
  '52W': { head: '52 weeks', get: r => r.change_52w_pct },
  '50D': { head: 'vs 50-day', get: r => r.vs_50d_pct },
  '200D': { head: 'vs 200-day', get: r => r.vs_200d_pct },
  HIGH: { head: 'From 52-week high', get: r => r.from_high_pct },
}

function Bar({ value, max, cls }: { value: number; max: number; cls: string }) {
  return <div className="h-2 rounded bg-muted"><div className={`h-2 rounded ${cls}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} /></div>
}

export default function Members({ command, run }: ViewProps) {
  const fromSecurity = command.security?.label.split(' ')[0]?.toUpperCase()
  const fromArgs = command.args.map(a => a.toUpperCase()).find(a => INDICES.includes(a))
  const code = (fromSecurity && INDICES.includes(fromSecurity) ? fromSecurity : fromArgs) ?? 'SPX'
  const rank = command.args.map(a => a.toUpperCase()).find(a => a in RANKS) ?? '1D'
  const ok = !fromSecurity || INDICES.includes(fromSecurity)
  const { data, error, loading } = useResource<Members>(ok ? `/api/terminal/members/${code}` : null, { freshMs: 60_000 })
  if (!ok) return <Fail message={`${command.fn} covers ${INDICES.join(', ')}. Try ${command.fn} INDU.`} />

  const chips = (
    <div className="flex flex-wrap gap-1">
      {INDICES.map(i => (
        <button key={i} onClick={() => run(`${command.fn} ${i}${command.fn === 'MRR' ? ` ${rank}` : ''}`)}
          className={`text-[11px] px-2 py-0.5 rounded-full ${i === code ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{i}</button>
      ))}
      {command.fn === 'MRR' && Object.keys(RANKS).map(k => (
        <button key={k} onClick={() => run(`MRR ${code} ${k}`)}
          className={`text-[11px] px-2 py-0.5 rounded-full ${k === rank ? 'bg-indigo-600 text-white font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{RANKS[k].head}</button>
      ))}
    </div>
  )

  return (
    <div className="space-y-3">
      {chips}
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const source = <Note>{d.name}: members and weights from {d.fund}&apos;s holdings{d.as_of ? ` of ${d.as_of}` : ''}; sectors from the eleven sector SPDR funds; quotes about 15 minutes late.</Note>
          if (command.fn === 'GWGT') {
            const max = Math.max(...d.sectors.map(s => s.weight))
            return (
              <>
                <Table rows={d.sectors} rowKey={s => s.sector} columns={[
                  { head: 'Sector', align: 'left', cell: s => <b>{s.sector}</b> },
                  { head: 'Members', cell: s => s.members },
                  { head: 'Weight', cell: s => pct(s.weight * 100, false) },
                  { head: '', align: 'left', cell: s => <div className="w-40"><Bar value={s.weight} max={max} cls="bg-indigo-500" /></div> },
                  { head: 'Today', cell: s => pct(s.change_pct), className: s => tone(s.change_pct) },
                ]} />
                <p className="news-section-label">Largest members</p>
                <Table rows={d.rows.slice(0, 15)} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)} columns={[
                  { head: 'Member', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
                  { head: 'Sector', align: 'left', cell: r => r.sector ?? '—' },
                  { head: 'Weight', cell: r => pct(r.weight * 100, false) },
                ]} />
                <p className="text-[12px] text-muted-foreground tabular-nums">The ten largest are {pct(d.rows.slice(0, 10).reduce((a, r) => a + r.weight, 0) * 100, false)} of the index.</p>
                {source}
              </>
            )
          }
          if (command.fn === 'WEIB') {
            const b = d.breadth
            const items: [string, string][] = [
              ['Advancing', `${b.advancing} (${pct((b.advancing / b.members) * 100, false)})`],
              ['Declining', `${b.declining} (${pct((b.declining / b.members) * 100, false)})`],
              ['Unchanged', String(b.unchanged)],
              ['Advance/decline ratio', b.declining ? (b.advancing / b.declining).toFixed(2) : '—'],
              ['Volume in rising members', pct(b.up_volume_pct, false)],
              ['Within 1% of a 52-week high', String(b.new_highs)],
              ['Within 1% of a 52-week low', String(b.new_lows)],
              ['Above their 50-day average', pct(b.above_50d_pct, false)],
              ['Above their 200-day average', pct(b.above_200d_pct, false)],
            ]
            return (
              <>
                <Table rows={items} rowKey={r => r[0]} columns={[
                  { head: `${d.name} breadth`, align: 'left', cell: r => r[0] },
                  { head: '', cell: r => <b>{r[1]}</b> },
                ]} />
                <p className="news-section-label">By sector, today</p>
                <Table rows={d.sectors} rowKey={s => s.sector} columns={[
                  { head: 'Sector', align: 'left', cell: s => s.sector },
                  { head: 'Advancing', cell: s => d.rows.filter(r => (r.sector ?? 'Other') === s.sector && (r.change_pct ?? 0) > 0).length },
                  { head: 'Declining', cell: s => d.rows.filter(r => (r.sector ?? 'Other') === s.sector && (r.change_pct ?? 0) < 0).length },
                  { head: 'Weighted move', cell: s => pct(s.change_pct), className: s => tone(s.change_pct) },
                ]} />
                <Note>Breadth of the {b.members} members of the {d.name}, not of a whole exchange. A member counts as at a high or low within 1% of it.</Note>
              </>
            )
          }
          if (command.fn === 'LVI') {
            const unusual = d.rows.filter(r => r.volume_ratio != null).sort((a, b) => b.volume_ratio! - a.volume_ratio!).slice(0, 40)
            return (
              <>
                <Table rows={unusual} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} GIP`)} columns={[
                  { head: 'Member', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
                  { head: 'Volume today', cell: r => big(r.volume) },
                  { head: '3-month average', cell: r => big(r.avg_volume_3m) },
                  { head: 'Times average', cell: r => `${r.volume_ratio!.toFixed(2)}×`, className: r => (r.volume_ratio! >= 2 ? 'font-semibold text-amber-600 dark:text-amber-400' : '') },
                  { head: 'Today', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
                ]} />
                <Note>Members trading the most against their three-month average daily volume. Early in a session every ratio is low; it is the ranking that matters.</Note>
              </>
            )
          }
          if (command.fn === 'MRR') {
            const get = RANKS[rank].get
            const ranked = d.rows.filter(r => get(r) != null).sort((a, b) => get(b)! - get(a)!)
            return (
              <>
                <Table rows={ranked} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)} columns={[
                  { head: '#', align: 'left', cell: r => ranked.indexOf(r) + 1 },
                  { head: 'Member', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
                  { head: 'Sector', align: 'left', cell: r => r.sector ?? '—' },
                  { head: RANKS[rank].head, cell: r => pct(get(r)), className: r => tone(get(r)) },
                  { head: 'Weight', cell: r => pct(r.weight * 100, false) },
                ]} />
                {source}
              </>
            )
          }
          return (
            <>
              <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)} columns={[
                { head: 'Member', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
                { head: 'Sector', align: 'left', cell: r => r.sector ?? '—' },
                { head: 'Weight', cell: r => pct(r.weight * 100, false) },
                { head: 'Price', cell: r => price(r.price) },
                { head: 'Today', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
                { head: '52 weeks', cell: r => pct(r.change_52w_pct), className: r => tone(r.change_52w_pct) },
                { head: 'P/E', cell: r => (r.pe == null ? '—' : r.pe.toFixed(1)) },
                { head: 'Market cap', cell: r => big(r.market_cap) },
              ]} />
              {source}
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
