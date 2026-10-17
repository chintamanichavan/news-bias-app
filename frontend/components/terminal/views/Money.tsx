import { Fetched, Note, Table } from '../kit'
import { day } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

interface Money {
  rates: Record<string, { rate: number; date: string; volume_bn: number | null }>
  target: { low: number; high: number } | null
  curve_date: string | null
  bills: Record<string, number | null>
  notes: Record<string, number | null>
  fed_funds_futures: { contract: string; month: string; price: number; implied_rate: number }[]
}

const NAMES: Record<string, string> = {
  EFFR: 'Effective fed funds', OBFR: 'Overnight bank funding', SOFR: 'Secured overnight financing',
  BGCR: 'Broad general collateral', TGCR: 'Tri-party general collateral',
}

const pctCell = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(2)}%`)

export default function Money() {
  const { data, error, loading } = useResource<Money>('/api/terminal/money')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-4">
          {d.target && (
            <p className="text-[13px]">
              Fed target range <span className="font-bold tabular-nums">{d.target.low.toFixed(2)}–{d.target.high.toFixed(2)}%</span>
            </p>
          )}
          <div>
            <p className="news-section-label mb-1">Overnight</p>
            <Table
              rows={Object.entries(d.rates)}
              rowKey={([k]) => k}
              columns={[
                { head: 'Rate', align: 'left', cell: ([k]) => <span><b>{k}</b> <span className="text-muted-foreground">{NAMES[k]}</span></span> },
                { head: 'Level', cell: ([, r]) => pctCell(r.rate) },
                { head: 'Volume', cell: ([, r]) => (r.volume_bn == null ? '—' : `$${r.volume_bn.toLocaleString()}B`) },
                { head: 'For', cell: ([, r]) => day(r.date) },
              ]}
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <p className="news-section-label mb-1">Bills</p>
              <Table rows={Object.entries(d.bills)} rowKey={([k]) => k}
                columns={[{ head: 'Tenor', align: 'left', cell: ([k]) => k }, { head: 'Yield', cell: ([, v]) => pctCell(v) }]} />
            </div>
            <div>
              <p className="news-section-label mb-1">Notes and bonds</p>
              <Table rows={Object.entries(d.notes)} rowKey={([k]) => k}
                columns={[{ head: 'Tenor', align: 'left', cell: ([k]) => k }, { head: 'Yield', cell: ([, v]) => pctCell(v) }]} />
            </div>
          </div>
          <div>
            <p className="news-section-label mb-1">Fed funds futures</p>
            <Table rows={d.fed_funds_futures} rowKey={f => f.contract}
              columns={[
                { head: 'Contract', align: 'left', cell: f => f.contract },
                { head: 'Month', align: 'left', cell: f => f.month },
                { head: 'Price', cell: f => f.price.toFixed(4) },
                { head: 'Implied rate', cell: f => pctCell(f.implied_rate) },
              ]} />
          </div>
          <Note>New York Fed reference rates; Treasury yields for {day(d.curve_date)}. WIRP reads the futures meeting by meeting.</Note>
        </div>
      )}
    </Fetched>
  )
}
