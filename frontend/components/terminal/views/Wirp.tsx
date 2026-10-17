import { Fetched, Note, Table } from '../kit'
import { day, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Step {
  meeting: string; rate_before: number; rate_after: number
  change_bp: number; since_today_bp: number; moves_priced: number
}
interface Wirp { effr: number; effr_date: string; target: { low: number; high: number } | null; path: Step[] }

const bp = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

/** "1.0 hike", "0.4 cut", "none" — moves priced since today, in quarter points */
export function movesText(n: number): string {
  if (Math.abs(n) < 0.05) return 'none'
  return `${Math.abs(n).toFixed(1)} ${n > 0 ? 'hike' : 'cut'}${Math.abs(n) >= 1.05 ? 's' : ''}`
}

export default function Wirp() {
  const { data, error, loading } = useResource<Wirp>('/api/terminal/wirp')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <p className="text-[13px]">
            Effective fed funds <b className="tabular-nums">{d.effr.toFixed(2)}%</b> ({day(d.effr_date)})
            {d.target && <> · target {d.target.low.toFixed(2)}–{d.target.high.toFixed(2)}%</>}
          </p>
          {d.path.length === 0 ? <Note>No meeting could be read from the futures.</Note> : (
            <Table
              rows={d.path}
              rowKey={s => s.meeting}
              columns={[
                { head: 'Meeting', align: 'left', cell: s => day(s.meeting) },
                { head: 'Rate after', cell: s => `${s.rate_after.toFixed(3)}%` },
                { head: 'At meeting (bp)', cell: s => bp(s.change_bp), className: s => tone(s.change_bp) },
                { head: 'Since today (bp)', cell: s => bp(s.since_today_bp), className: s => `font-semibold ${tone(s.since_today_bp)}` },
                { head: 'Moves priced', cell: s => movesText(s.moves_priced) },
              ]}
            />
          )}
          <Note>
            From 30-day fed funds futures (100 minus price is the month&rsquo;s average rate), split around each
            meeting the way CME&rsquo;s FedWatch does. A fraction of a move reads as odds: 0.4 cuts is roughly a
            40% chance of one quarter-point cut. Futures prices are about 10 minutes late.
          </Note>
        </div>
      )}
    </Fetched>
  )
}
