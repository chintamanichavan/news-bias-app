import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Row { symbol: string; name: string | null; weight: number; price: number; change_pct: number; contribution_pct: number; points: number }

interface Movers {
  index: string; name: string; level: number; change: number; change_pct: number; weights_as_of: string | null; fund: string
  members: number; quoted: number; explained_points: number; advancers: number; decliners: number; rows: Row[]
}

const INDICES = ['SPX', 'INDU', 'NDX']
const pts = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`

/** MOV: which members moved the index today. "MOV", "MOV INDU", "NDX INDEX MOV". */
export default function Mov({ command, run }: ViewProps) {
  const named = (command.security?.label.split(' ')[0] ?? command.args[0] ?? 'SPX').toUpperCase()
  const ok = INDICES.includes(named)
  const { data, error, loading } = useResource<Movers>(ok ? `/api/terminal/mov/${named}` : null, { freshMs: 60_000 })
  if (!ok) return <Fail message={`MOV covers ${INDICES.join(', ')}. Try MOV INDU.`} />

  const side = (rows: Row[], title: string) => (
    <div className="min-w-0">
      <p className="news-section-label mb-1">{title}</p>
      <Table rows={rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} GIP`)}
        columns={[
          { head: 'Member', align: 'left', cell: r => <b>{r.symbol}</b> },
          { head: 'Change', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
          { head: 'Points', cell: r => pts(r.points), className: r => tone(r.points) },
        ]} />
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex gap-1">
        {INDICES.map(i => (
          <button key={i} onClick={() => run(`MOV ${i}`)}
            className={`text-[11px] px-2 py-0.5 rounded-full ${i === named ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{i}</button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const up = d.rows.filter(r => r.points > 0).slice(0, 10)
          const down = d.rows.filter(r => r.points < 0).slice(0, 10)
          return (
            <>
              <p className="text-[13px] tabular-nums">
                <b>{d.name}</b> {price(d.level)} <span className={tone(d.change)}>{pts(d.change)} ({pct(d.change_pct)})</span>.{' '}
                {d.advancers} up, {d.decliners} down. Members explain {pts(d.explained_points)} points.
              </p>
              <div className="grid sm:grid-cols-2 gap-4">
                {side(up, 'Pushed it up most')}
                {side(down, 'Pulled it down most')}
              </div>
              <p className="news-section-label">Every member</p>
              <Table rows={d.rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol} DES`)}
                columns={[
                  { head: 'Member', align: 'left', cell: r => <span><b>{r.symbol}</b> <span className="text-muted-foreground">{r.name}</span></span> },
                  { head: 'Weight', cell: r => pct(r.weight * 100, false) },
                  { head: 'Price', cell: r => price(r.price) },
                  { head: 'Change', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
                  { head: 'Index %', cell: r => `${r.contribution_pct > 0 ? '+' : ''}${r.contribution_pct.toFixed(3)}`, className: r => tone(r.contribution_pct) },
                  { head: 'Points', cell: r => pts(r.points), className: r => tone(r.points) },
                ]} />
              <Note>
                Each member&apos;s weight at the last close times its change today. Weights are {d.fund}&apos;s published
                holdings{d.weights_as_of ? ` as of ${d.weights_as_of}` : ''}, which track the index to within the fund&apos;s
                cash. {d.quoted} of {d.members} members quoted. Quotes are about 15 minutes late.
              </Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
