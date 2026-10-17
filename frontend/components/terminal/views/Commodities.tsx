import { useState } from 'react'
import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// CFTC, CCRV, CRR, GCIN, CPH, CMDX, CRKS, BOIL, BGAS, NATG and CRUD.

function useCom<T>(kind: string, params = '') {
  return useResource<T>(`/api/terminal/commodities/${kind}${params ? `?${params}` : ''}`, { freshMs: 30 * 60_000 })
}

interface Cot { code: string; name: string; date: string; open_interest: number; speculators_net: number; commercials_net: number; small_net: number; speculators_net_pct_oi: number | null; speculators_change: number; three_year_rank?: number | null }

export function Positioning({ command, run }: ViewProps) {
  const code = command.args[0] ?? null
  const all = useCom<{ rows: Cot[] }>('cot')
  const one = useCom<{ name: string; rows: Cot[] }>('cot', code ? `code=${encodeURIComponent(code)}` : '')
  if (code) {
    return (
      <Fetched data={one.data} error={one.error} loading={one.loading}>
        {d => d.rows.length === 0 ? <Fail message={`No CFTC market with code ${code}.`} /> : (
          <div className="space-y-3">
            <p className="news-section-label">{d.name}: net positions, contracts</p>
            <ChartLegend items={[{ label: 'Speculators (non-commercial)', cls: 'stroke-indigo-500' }, { label: 'Commercial hedgers', cls: 'stroke-amber-500' }, { label: 'Small traders', cls: 'stroke-muted-foreground' }]} />
            <TimeSeriesChart H={220} zeroLine series={[{ label: 'spec', cls: 'stroke-indigo-500', points: d.rows.map(r => ({ t: r.date, v: r.speculators_net })) },
              { label: 'comm', cls: 'stroke-amber-500', points: d.rows.map(r => ({ t: r.date, v: r.commercials_net })) },
              { label: 'small', cls: 'stroke-muted-foreground', points: d.rows.map(r => ({ t: r.date, v: r.small_net })) }]} yFmt={v => big(v)} />
            <Note>Three years of the CFTC&apos;s weekly Commitments of Traders (futures only, positions as of each Tuesday, published Friday). Back to every market: CFTC.</Note>
          </div>
        )}
      </Fetched>
    )
  }
  return (
    <Fetched data={all.data} error={all.error} loading={all.loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.code} onRow={r => run(`CFTC ${r.code}`)} columns={[
            { head: 'Market', align: 'left', cell: r => <b>{r.name}</b> },
            { head: 'Speculators net', cell: r => r.speculators_net.toLocaleString('en-US'), className: r => tone(r.speculators_net) },
            { head: '% of open interest', cell: r => pct(r.speculators_net_pct_oi) },
            { head: 'Week change', cell: r => r.speculators_change.toLocaleString('en-US'), className: r => tone(r.speculators_change) },
            { head: 'Rank in 3 years', cell: r => (r.three_year_rank == null ? '—' : `${r.three_year_rank.toFixed(0)}%`), className: r => ((r.three_year_rank ?? 50) >= 90 || (r.three_year_rank ?? 50) <= 10 ? 'font-semibold text-amber-600 dark:text-amber-400' : '') },
            { head: 'Commercials net', cell: r => r.commercials_net.toLocaleString('en-US') },
            { head: 'As of', align: 'left', cell: r => r.date },
          ]} />
          <Note>How speculators (funds) and commercial hedgers stand in each futures market, from the CFTC&apos;s Commitments of Traders. Rank is where today&apos;s speculator position sits in its three-year range: near 0% or 100% is crowded. Click a market for its history.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Curve { group: string; root: string; name: string; front: string; next: string; spread_pct: number; annual_pct: number; shape: string; full_curve_pct: number | null; contracts: { month: string; price: number | null }[] }

export function Curves({ run }: ViewProps) {
  const { data, error, loading } = useCom<{ rows: Curve[] }>('curves')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={d.rows} rowKey={r => r.root} onRow={() => run('CTM')} columns={[
            { head: 'Future', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.group}</span></span> },
            { head: 'Shape', align: 'left', cell: r => r.shape, className: r => (r.shape === 'backwardation' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400') },
            { head: 'Front less next', cell: r => pct(r.spread_pct) },
            { head: 'Roll yield, a year', cell: r => pct(r.annual_pct), className: r => tone(r.annual_pct) },
            { head: 'Across the curve', cell: r => pct(r.full_curve_pct) },
            { head: 'Months', align: 'left', cell: r => `${r.front} → ${r.next}` },
          ]} />
          <Note>Curve shape from the listed contract months: in backwardation the front costs more, and a holder who rolls earns the difference (positive roll yield); in contango the roll costs. Annualised from the first two months, so seasonal curves (gas, grains) swing hard. Prices in CTM.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Ranked { symbol: string; name: string; price: number; date: string; '1d': number | null; '1w': number | null; '1m': number | null; '3m': number | null; ytd: number | null; '1y': number | null }
const PERIODS: [keyof Ranked, string][] = [['1d', 'Day'], ['1w', 'Week'], ['1m', 'Month'], ['3m', '3 months'], ['ytd', 'Year to date'], ['1y', 'Year']]

export function CommodityReturns({ command, run }: ViewProps) {
  const kind = command.fn === 'GCIN' ? 'indices' : 'futures'
  const { data, error, loading } = useCom<{ rows: Ranked[] }>(kind)
  const [by, setBy] = useState<keyof Ranked>('ytd')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = [...d.rows].sort((a, b) => ((b[by] as number | null) ?? -999) - ((a[by] as number | null) ?? -999))
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1 items-center text-[11px]">
              <span className="text-muted-foreground mr-1">Rank by</span>
              {PERIODS.map(([k, h]) => (
                <button key={k} onClick={() => setBy(k)} className={`px-2 py-0.5 rounded-full ${by === k ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{h}</button>
              ))}
            </div>
            <Table rows={rows} rowKey={r => r.symbol} onRow={r => run(`${r.symbol.replace('=F', '1')} ${r.symbol.endsWith('=F') ? 'COMDTY ' : ''}GP 1Y`)} columns={[
              { head: 'Commodity', align: 'left', cell: r => <span><b>{r.name}</b> <span className="text-muted-foreground">{r.symbol}</span></span> },
              { head: 'Price', cell: r => price(r.price) },
              ...PERIODS.map(([k, h]) => ({ head: h, cell: (r: Ranked) => pct(r[k] as number | null), className: (r: Ranked) => tone(r[k] as number | null) })),
            ]} />
            <Note>{kind === 'indices' ? 'Public commodity indices and the funds that track them; the Bloomberg Commodity Index is licensed.' : 'Front-month futures, which jump at each roll.'}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Pink { series: { name: string; unit: string; points: { month: string; value: number }[] }[] }

export function PinkSheet({ command, run }: ViewProps) {
  const { data, error, loading } = useCom<Pink>('pink')
  const q = command.args.join(' ').toLowerCase()
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const chosen = q ? d.series.filter(s => s.name.toLowerCase().includes(q)) : d.series
        const one = chosen.length === 1 ? chosen[0] : null
        return (
          <div className="space-y-3">
            {one && <TimeSeriesChart H={200} series={[{ label: one.name, cls: 'stroke-indigo-500', points: one.points.map(p => ({ t: `${p.month}-15`, v: p.value })) }]} />}
            <Table rows={chosen} rowKey={s => s.name} onRow={s => run(`${command.fn} ${s.name}`)} columns={[
              { head: 'Commodity', align: 'left', cell: s => <span><b>{s.name}</b> <span className="text-muted-foreground">{s.unit}</span></span> },
              { head: 'Latest', cell: s => s.points[s.points.length - 1]?.value.toFixed(2) ?? '—' },
              { head: 'Month', align: 'left', cell: s => s.points[s.points.length - 1]?.month ?? '' },
              { head: 'A year', cell: s => { const a = s.points[s.points.length - 1], b = s.points[s.points.length - 13]; return a && b ? pct((a.value / b.value - 1) * 100) : '—' }, className: s => { const a = s.points[s.points.length - 1], b = s.points[s.points.length - 13]; return a && b ? tone(a.value - b.value) : '' } },
              { head: 'Five years', cell: s => { const a = s.points[s.points.length - 1], b = s.points[s.points.length - 61]; return a && b ? pct((a.value / b.value - 1) * 100) : '—' } },
            ]} />
            <Note>The World Bank&apos;s Pink Sheet: monthly average world prices for 70 commodities, from energy to fertilisers and metals. Pick one: {command.fn} COPPER.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Spot { rows: { code: string; name: string; unit: string; date: string; price: number; change_pct: number | null; year_pct: number | null }[]; cracks: { region: string; crude: string; latest: { t: string; v: number }; path: { t: string; v: number }[] }[] }

export function SpotEnergy({ command, run }: ViewProps) {
  const { data, error, loading } = useCom<Spot>('spot')
  const storage = useCom<{ week: string; released: string; rows: { region: string; stocks: number | null; net_change: number | null; five_year_avg: number | null; year_ago: number | null }[] }>('storage')
  const petro = useCom<{ weeks: string[]; rows: { item: string; this_week: number | null; last_week: number | null; change: number | null; year_ago: number | null }[] }>('petroleum')
  const fn = command.fn
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = fn === 'BGAS' || fn === 'NATG' ? d.rows.filter(r => r.code === 'RNGWHHD') : fn === 'CRUD' ? d.rows.filter(r => ['RWTC', 'RBRTE'].includes(r.code)) : d.rows
        return (
          <div className="space-y-3">
            {fn === 'CRKS' ? (
              <>
                <ChartLegend items={d.cracks.map((c, i) => ({ label: `${c.region} (${c.crude})`, cls: ['stroke-indigo-500', 'stroke-amber-500'][i] }))} />
                <TimeSeriesChart H={220} series={d.cracks.map((c, i) => ({ label: c.region, cls: ['stroke-indigo-500', 'stroke-amber-500'][i], points: c.path }))} yFmt={v => `$${v.toFixed(0)}`} />
                <Table rows={d.cracks} rowKey={c => c.region} columns={[
                  { head: '3-2-1 crack spread', align: 'left', cell: c => <b>{c.region}</b> }, { head: 'Crude', align: 'left', cell: c => c.crude },
                  { head: '$ a barrel', cell: c => c.latest.v.toFixed(2) }, { head: 'Day', align: 'left', cell: c => c.latest.t },
                ]} />
                <Note>Refining margin from EIA spot prices: two barrels of gasoline and one of diesel made from three of crude, per barrel. Europe and Asia need Platts or Argus prices, which are licensed; futures-based cracks: CMSP.</Note>
              </>
            ) : (
              <Table rows={rows} rowKey={r => r.code} columns={[
                { head: 'Spot price', align: 'left', cell: r => <b>{r.name}</b> },
                { head: 'Price', cell: r => `${r.price.toFixed(r.unit === '$/gal' ? 3 : 2)}` },
                { head: 'Unit', align: 'left', cell: r => <span className="text-muted-foreground">{r.unit}</span> },
                { head: 'Day', cell: r => pct(r.change_pct), className: r => tone(r.change_pct) },
                { head: 'Year', cell: r => pct(r.year_pct), className: r => tone(r.year_pct) },
                { head: 'As of', align: 'left', cell: r => r.date },
              ]} />
            )}
            {(fn === 'NATG' || fn === 'BGAS') && storage.data && (
              <Table rows={storage.data.rows} rowKey={r => r.region} columns={[
                { head: `Gas in storage, week to ${storage.data.week} (bcf)`, align: 'left', cell: r => r.region },
                { head: 'Stocks', cell: r => r.stocks?.toLocaleString('en-US') ?? '—' },
                { head: 'Week change', cell: r => r.net_change ?? '—', className: r => tone(r.net_change) },
                { head: 'vs 5-year average', cell: r => (r.stocks != null && r.five_year_avg ? pct((r.stocks / r.five_year_avg - 1) * 100) : '—') },
              ]} />
            )}
            {fn === 'CRUD' && petro.data && (
              <Table rows={petro.data.rows.slice(0, 14)} rowKey={r => r.item} columns={[
                { head: `US stocks, million barrels (${petro.data.weeks[0]})`, align: 'left', cell: r => r.item },
                { head: 'This week', cell: r => r.this_week?.toFixed(1) ?? '—' },
                { head: 'Change', cell: r => r.change?.toFixed(1) ?? '—', className: r => tone(r.change) },
                { head: 'A year ago', cell: r => r.year_ago?.toFixed(1) ?? '—' },
              ]} />
            )}
            <Note>EIA daily spot prices, a day or two behind{fn === 'NATG' || fn === 'BGAS' ? ', and the weekly gas storage report. Other North American hubs are licensed (Platts, NGI)' : fn === 'CRUD' ? ', and the weekly petroleum status report. The futures curve: CCRV; positioning: CFTC 067651' : '. Bunker fuel prices are licensed'}.{' '}
              <button className="underline" onClick={() => run('CTM')}>Futures</button></Note>
          </div>
        )
      }}
    </Fetched>
  )
}
