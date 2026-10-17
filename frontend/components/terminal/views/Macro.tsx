import { ChartLegend, TimeSeriesChart } from '@/components/quantviz'
import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, pct, price, tone } from '@/lib/terminal/numbers'
import { useResource } from '@/lib/useResource'

// COUN, ECMX, EMEC, GDP, CBRT, EMMR, CENB, the central bank pages, LEAD,
// OECD, HOIN, WGO, WIRA, CRP, EQRP and WBGR.

const SOURCES = 'World Bank indicators (annual), BIS policy rates (daily), OECD leading indicators (monthly).'
const COUNTRIES: [string, string][] = [['US', 'United States'], ['XM', 'Euro area'], ['GB', 'United Kingdom'], ['JP', 'Japan'], ['CN', 'China'], ['IN', 'India'],
  ['CA', 'Canada'], ['AU', 'Australia'], ['CH', 'Switzerland'], ['DE', 'Germany'], ['FR', 'France'], ['BR', 'Brazil'], ['MX', 'Mexico'], ['KR', 'South Korea'],
  ['ZA', 'South Africa'], ['TR', 'Turkey'], ['ID', 'Indonesia'], ['RU', 'Russia']]
export const BANK_OF: Record<string, string> = { BOC: 'CA', BOE: 'GB', ECB: 'XM', BCB: 'BR', RBA: 'AU', SNB: 'CH', BOJ: 'JP', CBR: 'RU', PBOC: 'CN', RBOI: 'IN' }

function useMacro<T>(kind: string, params = '') {
  return useResource<T>(`/api/terminal/macro/${kind}${params ? `?${params}` : ''}`, { freshMs: 60 * 60_000 })
}

const num = (v: number | null | undefined, d = 1) => (v == null ? '—' : v.toFixed(d))

interface Point { year: number; value: number }
interface Country {
  country: string; bank: string; index: { symbol: string; price?: number; change_pct?: number; change_52w_pct?: number } | null
  currency: { symbol: string; price?: number; change_pct?: number } | null; ten_year: number | null
  policy: { rate: number; as_of: string; changed: string | null; change_bp: number | null } | null; policy_path: { t: string; v: number }[]
  economy: Record<string, Point[]>; cli: { level: number; three_month_change: number; phase: string; as_of: string } | null; cli_path: { t: string; v: number }[]
}

function CountryPage({ iso2, run, bankCode }: { iso2: string; run: ViewProps['run']; bankCode?: string }) {
  const { data, error, loading } = useMacro<Country>('country', `country=${iso2}`)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-4">
            <Table rows={[
              ['Main index', d.index?.price != null ? `${price(d.index.price)} (${pct(d.index.change_pct ?? null)} today, ${pct(d.index.change_52w_pct ?? null)} a year)` : '—', d.index?.symbol ? `${d.index.symbol} GP` : null],
              ['Currency per dollar', d.currency?.price != null ? price(d.currency.price) : d.country === 'United States' ? 'the dollar' : '—', d.currency?.symbol ? `${d.currency.symbol.replace('=X', '')} CURNCY GP` : null],
              ['Policy rate', d.policy ? `${num(d.policy.rate, 2)}%` : '—', null],
              ['Last move', d.policy?.changed ? `${d.policy.change_bp! > 0 ? '+' : ''}${d.policy.change_bp} bp on ${d.policy.changed}` : 'none in the window', null],
              ['10-year government yield', d.ten_year != null ? `${num(d.ten_year, 2)}%` : 'not in WB', d.ten_year != null ? 'WB' : null],
              ['OECD leading indicator', d.cli ? `${num(d.cli.level, 1)}, ${d.cli.phase} (${d.cli.as_of})` : '—', 'LEAD'],
            ] as [string, string, string | null][]} rowKey={r => r[0]} onRow={r => r[2] && run(r[2])} columns={[
              { head: `${d.country} · ${d.bank}`, align: 'left', cell: r => r[0] }, { head: '', cell: r => <b>{r[1]}</b> },
            ]} />
            <Table rows={Object.entries(d.economy).filter(([k]) => !k.startsWith('GDP, US'))} rowKey={r => r[0]} columns={[
              { head: 'Economy', align: 'left', cell: r => r[0] },
              ...[0, 1, 2].map(back => ({ head: back === 0 ? 'Latest' : `${back} yr before`, cell: (r: [string, Point[]]) => { const p = r[1][r[1].length - 1 - back]; return p ? <span title={String(p.year)}>{r[0].includes('US$') ? big(p.value) : num(p.value)}</span> : '—' } })),
              { head: 'Year', cell: r => r[1][r[1].length - 1]?.year ?? '—' },
            ]} />
          </div>
          {d.policy_path.length > 1 && (
            <>
              <p className="news-section-label">{bankCode ?? 'Policy'} rate, %</p>
              <TimeSeriesChart H={160} series={[{ label: 'rate', cls: 'stroke-indigo-500', points: d.policy_path }]} yFmt={v => v.toFixed(2)} />
            </>
          )}
          <Note>{SOURCES} Change the country: COUN JP. {bankCode ? `For every bank's rate, CBRT.` : ''}</Note>
        </div>
      )}
    </Fetched>
  )
}

export function CountryView({ command, run }: ViewProps) {
  const arg = (command.args[0] ?? command.security?.label.split(' ')[0] ?? 'US').toUpperCase()
  const iso2 = COUNTRIES.find(c => c[0] === arg)?.[0] ?? (arg === 'EU' || arg === 'EZ' ? 'XM' : 'US')
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {COUNTRIES.map(([c, n]) => (
          <button key={c} title={n} onClick={() => run(`COUN ${c}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${c === iso2 ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{c}</button>
        ))}
      </div>
      <CountryPage iso2={iso2} run={run} />
    </div>
  )
}

export function CentralBank({ command, run }: ViewProps) {
  return <CountryPage iso2={BANK_OF[command.fn]} run={run} bankCode={command.fn} />
}

interface Matrix { indicators: Record<string, string>; rows: (Record<string, number | string | null> & { country: string; iso2: string })[] }

export function EconomyMatrix({ command, run }: ViewProps) {
  const kind = command.fn === 'EMEC' ? 'emerging' : 'matrix'
  const { data, error, loading } = useMacro<Matrix>(kind)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const keys = Object.keys(d.indicators)
        const rows = command.fn === 'GDP' ? [...d.rows].sort((a, b) => (Number(b['NY.GDP.MKTP.CD']) || 0) - (Number(a['NY.GDP.MKTP.CD']) || 0)) : d.rows
        return (
          <div className="space-y-3">
            <Table rows={rows} rowKey={r => r.iso2} onRow={r => run(`COUN ${r.iso2}`)} columns={[
              { head: 'Country', align: 'left', cell: r => <b>{r.country}</b> },
              ...keys.map(k => ({ head: d.indicators[k], cell: (r: typeof rows[number]) => { const v = r[k] as number | null; return k.includes('MKTP.CD') || k.includes('PCAP') ? big(v) : num(v) },
                className: (r: typeof rows[number]) => (k.includes('ZG') || k.includes('CAB') ? tone(r[k] as number | null) : '') })),
              { head: 'Policy rate', cell: r => num(r.policy_rate as number | null, 2) },
            ]} />
            <Note>The latest annual figure for each, mostly last year; the year of each figure is on the country&apos;s page (click a row). {command.fn === 'EMEC' ? 'Emerging economies. ' : ''}{SOURCES}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Policy { area: string; country: string; bank: string | null; emerging: boolean | null; rate: number; as_of: string; changed: string | null; change_bp: number | null }

export function PolicyRates({ command, run }: ViewProps) {
  const { data, error, loading } = useMacro<{ rows: Policy[] }>('policy')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = command.fn === 'EMMR' ? d.rows.filter(r => r.emerging) : d.rows
        const recent = rows.filter(r => r.changed && r.changed >= new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10))
        return (
          <div className="space-y-3">
            {command.fn === 'CENB' && <p className="text-[13px]">In the last 90 days, {recent.filter(r => (r.change_bp ?? 0) > 0).length} banks raised rates and {recent.filter(r => (r.change_bp ?? 0) < 0).length} cut them. Each bank&apos;s page: {Object.keys(BANK_OF).join(', ')}, and FED.</p>}
            <Table rows={rows} rowKey={r => r.area} onRow={r => run(`COUN ${r.area}`)} columns={[
              { head: 'Central bank', align: 'left', cell: r => <span><b>{r.country}</b> <span className="text-muted-foreground">{r.bank ?? ''}</span></span> },
              { head: 'Rate', cell: r => `${num(r.rate, 2)}%` },
              { head: 'Last move', cell: r => (r.change_bp == null ? '—' : `${r.change_bp > 0 ? '+' : ''}${r.change_bp} bp`), className: r => tone(r.change_bp == null ? null : -r.change_bp) },
              { head: 'On', align: 'left', cell: r => r.changed ?? '' },
              { head: 'As of', align: 'left', cell: r => <span className="text-muted-foreground">{r.as_of}</span> },
            ]} />
            <Note>Policy rates from the Bank for International Settlements, which collects them from each central bank. {command.fn === 'EMMR' ? 'Emerging economies only; interbank rates beyond the policy rate are not published in one free place.' : 'For the US the BIS uses the middle of the Fed’s target range.'}</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Cli { iso3: string; country: string; level?: number; three_month_change?: number; phase?: string; as_of?: string; path: { t: string; v: number }[] }
const COL = ['stroke-indigo-500', 'stroke-amber-500', 'stroke-emerald-500', 'stroke-rose-500', 'stroke-sky-500', 'stroke-foreground']

export function LeadingIndicators({ run }: ViewProps) {
  const { data, error, loading } = useMacro<{ rows: Cli[] }>('cli')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const big6 = d.rows.filter(r => ['USA', 'CHN', 'DEU', 'JPN', 'GBR', 'IND'].includes(r.iso3))
        return (
          <div className="space-y-3">
            <ChartLegend items={big6.map((r, i) => ({ label: r.country, cls: COL[i % COL.length] }))} />
            <TimeSeriesChart H={200} series={[...big6.map((r, i) => ({ label: r.country, cls: COL[i % COL.length], points: r.path.map(p => ({ t: `${p.t}-15`, v: p.v })) })),
              { label: '100', cls: 'stroke-muted-foreground', dash: '3 3', points: (big6[0]?.path ?? []).map(p => ({ t: `${p.t}-15`, v: 100 })) }]} yFmt={v => v.toFixed(1)} />
            <Table rows={[...d.rows].sort((a, b) => (b.level ?? 0) - (a.level ?? 0))} rowKey={r => r.iso3} onRow={r => run(`COUN ${r.iso3.slice(0, 2)}`)} columns={[
              { head: 'Country', align: 'left', cell: r => <b>{r.country}</b> },
              { head: 'Level', cell: r => num(r.level, 2) },
              { head: '3-month change', cell: r => num(r.three_month_change, 2), className: r => tone(r.three_month_change ?? null) },
              { head: 'Phase', align: 'left', cell: r => r.phase ?? '—' },
              { head: 'Month', align: 'left', cell: r => r.as_of ?? '' },
            ]} />
            <Note>The OECD&apos;s composite leading indicators, built to turn six to nine months before the economy: 100 is trend growth. Above 100 and rising is expansion, above and falling downturn, below and falling slowdown, below and rising recovery. (The Conference Board&apos;s US index is licensed.)</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Prop { iso2: string; country: string; latest: { date: string; value: number; yoy: number | null }; path: { date: string; value: number; yoy: number | null }[] }

export function HousePrices({ run }: ViewProps) {
  const { data, error, loading } = useMacro<{ rows: Prop[] }>('property')
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => (
        <div className="space-y-3">
          <Table rows={[...d.rows].sort((a, b) => (b.latest.yoy ?? -99) - (a.latest.yoy ?? -99))} rowKey={r => r.iso2} onRow={r => run(`COUN ${r.iso2}`)} columns={[
            { head: 'Country', align: 'left', cell: r => <b>{r.country}</b> },
            { head: 'A year', cell: r => pct(r.latest.yoy), className: r => tone(r.latest.yoy) },
            { head: 'Five years', cell: r => { const p = r.path[r.path.length - 21]; return p ? pct((r.latest.value / p.value - 1) * 100) : '—' } },
            { head: 'Quarter', align: 'left', cell: r => r.latest.date },
          ]} />
          <Note>Residential property prices from the BIS, in local currency before inflation. US construction and sales figures are in HSST.</Note>
        </div>
      )}
    </Fetched>
  )
}

interface Res { country: string; year: number; reserves: number; gold: number | null; gold_share: number | null }

export function Reserves({ command }: ViewProps) {
  const { data, error, loading } = useMacro<{ rows: Res[] }>('reserves')
  const gold = command.fn === 'WGO'
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = gold ? [...d.rows].filter(r => r.gold).sort((a, b) => (b.gold ?? 0) - (a.gold ?? 0)) : d.rows
        return (
          <div className="space-y-3">
            <Table rows={rows} rowKey={r => r.country} columns={[
              { head: 'Country', align: 'left', cell: r => <b>{r.country}</b> },
              ...(gold ? [{ head: 'Gold, US$', cell: (r: Res) => big(r.gold) }, { head: 'Share of reserves', cell: (r: Res) => (r.gold_share == null ? '—' : pct(r.gold_share * 100, false)) }] : []),
              { head: 'Reserves incl. gold, US$', cell: r => big(r.reserves) },
              { head: 'Year', cell: r => r.year },
            ]} />
            <Note>Official reserves from the World Bank, at market value at year end; gold is total reserves less reserves excluding gold, so it moves with the gold price as well as tonnes held. The euro area&apos;s are held by its national central banks.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

interface Risk { country: string; rating: string | null; default_spread: number | null; country_risk_premium: number | null; equity_risk_premium: number | null; tax_rate: number | null }

export function CountryRisk({ command }: ViewProps) {
  const { data, error, loading } = useMacro<{ rows: Risk[] }>('risk')
  const q = command.args.join(' ').toLowerCase()
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const rows = d.rows.filter(r => !q || r.country.toLowerCase().includes(q))
        return rows.length === 0 ? <Fail message={`No country matches ${q}.`} /> : (
          <div className="space-y-3">
            <Table rows={rows} rowKey={r => r.country} columns={[
              { head: 'Country', align: 'left', cell: r => <b>{r.country}</b> },
              { head: "Moody's rating", align: 'left', cell: r => r.rating ?? '—' },
              { head: 'Default spread', cell: r => (r.default_spread == null ? '—' : pct(r.default_spread * 100, false)) },
              { head: 'Country risk premium', cell: r => (r.country_risk_premium == null ? '—' : pct(r.country_risk_premium * 100, false)) },
              { head: 'Equity risk premium', cell: r => (r.equity_risk_premium == null ? '—' : pct(r.equity_risk_premium * 100, false)), className: () => 'font-semibold' },
              { head: 'Corporate tax', cell: r => (r.tax_rate == null ? '—' : pct(r.tax_rate * 100, false)) },
            ]} />
            <Note>Aswath Damodaran&apos;s country risk and equity risk premiums (NYU Stern), updated each January and July: a mature-market premium plus a country premium scaled from the sovereign default spread. Filter: {command.fn} BRAZIL.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}

const WB_LIST: [string, string][] = [['NY.GDP.MKTP.KD.ZG', 'GDP growth'], ['FP.CPI.TOTL.ZG', 'Inflation'], ['SL.UEM.TOTL.ZS', 'Unemployment'], ['GC.DOD.TOTL.GD.ZS', 'Government debt'],
  ['BN.CAB.XOKA.GD.ZS', 'Current account'], ['NY.GDP.PCAP.CD', 'GDP per person'], ['NE.EXP.GNFS.ZS', 'Exports'], ['FR.INR.RINR', 'Real interest rate'], ['GC.BAL.CASH.GD.ZS', 'Government balance']]

export function WorldBankData({ command, run }: ViewProps) {
  const ind = (command.args[0] ?? 'NY.GDP.MKTP.KD.ZG').toUpperCase()
  const countries = command.args.slice(1).join(',') || 'US,CN,DE,JP,IN,GB'
  const { data, error, loading } = useMacro<{ name: string; series: Record<string, { year: number; value: number }[]> }>('indicator', `indicator=${encodeURIComponent(ind)}&countries=${encodeURIComponent(countries)}`)
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {WB_LIST.map(([k, n]) => (
          <button key={k} onClick={() => run(`${command.fn} ${k} ${countries.replace(/,/g, ' ')}`)} className={`text-[11px] px-2 py-0.5 rounded-full ${k === ind ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>{n}</button>
        ))}
      </div>
      <Fetched data={data} error={error} loading={loading}>
        {d => {
          const lines = Object.entries(d.series).map(([iso, pts], i) => ({ label: iso, cls: COL[i % COL.length], points: pts.map(p => ({ t: `${p.year}-07-01`, v: p.value })) }))
          return (
            <>
              <p className="news-section-label">{d.name}</p>
              <ChartLegend items={lines.map(l => ({ label: l.label, cls: l.cls }))} />
              <TimeSeriesChart H={220} zeroLine series={lines} />
              <Note>World Bank indicators, yearly, for the countries named: {command.fn} NY.GDP.MKTP.KD.ZG US CN IN. The IMF&apos;s own data service refuses this server, so its figures come through the World Bank.</Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
