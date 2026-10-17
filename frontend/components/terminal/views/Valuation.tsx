import { Fail, Fetched, Note, Table } from '../kit'
import type { ViewProps } from './types'
import { big, price, tone } from '@/lib/terminal/numbers'
import { ARG_HELP, valuationQuery } from '@/lib/terminal/valuationArgs'
import { useResource } from '@/lib/useResource'

interface Flow { year: number; flow: number; present_value: number }
interface Model { flows: Flow[]; explicit: number; terminal: number; total: number; per_share: number; upside_pct: number }

interface Valuation {
  inputs: {
    symbol: string; price: number; currency: string | null; sector: string | null; financial: boolean
    shares: number | null; market_cap: number | null; debt: number; cash: number; interest: number; tax: number
    fcf: number | null; fiscal_year_end: string | null; revenue_growth_3y: number | null
    rf: number | null; erp: number | null; erp_date: string | null; beta: { raw: number; adjusted: number; weeks: number } | null
    dividend_ttm: number | null; dividend_growth_5y: number | null
  }
  model: {
    missing?: string[]
    rf: number; erp: number; beta: number; ke: number; kd: number; kd_after_tax: number; equity_weight: number | null
    wacc: number | null; growth: number; terminal_growth: number
    dcf?: Model & { base_fcff: number; enterprise_value: number; equity_value: number; terminal_share: number
      sensitivity: { wacc: number[]; terminal_growth: number[]; per_share: (number | null)[][] } }
    ddm?: Model & { dividend: number; growth: number; terminal_growth: number }
  }
}

const p = (v: number | null | undefined, d = 2) => (v == null ? '—' : `${(v * 100).toFixed(d)}%`)

function Verdict({ label, m, current }: { label: string; m: Model; current: number }) {
  return (
    <p className="text-[13px] tabular-nums">
      {label} value <b className="text-[16px]">{price(m.per_share)}</b> a share against {price(current)}:{' '}
      <b className={tone(m.upside_pct)}>{m.upside_pct > 0 ? '+' : ''}{m.upside_pct.toFixed(1)}%</b>
    </p>
  )
}

function Flows({ m, what, fmt }: { m: Model; what: string; fmt: (v: number) => string }) {
  return (
    <Table rows={[...m.flows.map(f => ({ k: `Year ${f.year}`, a: f.flow, b: f.present_value })),
      { k: 'Beyond year 5', a: null, b: m.terminal }, { k: 'Total', a: null, b: m.total }]}
      rowKey={r => r.k}
      columns={[
        { head: '', align: 'left', cell: r => (r.k === 'Total' ? <b>{r.k}</b> : r.k) },
        { head: what, cell: r => (r.a == null ? '' : fmt(r.a)) },
        { head: 'Present value', cell: r => (r.k === 'Total' ? <b>{fmt(r.b)}</b> : fmt(r.b)) },
      ]} />
  )
}

/** WACC, DCF and DDM share one fetch; each shows its own part. */
export default function Valuation({ command }: ViewProps) {
  const sec = command.security!
  const q = valuationQuery(command.args)
  const url = 'query' in q ? `/api/terminal/valuation/${encodeURIComponent(sec.symbol)}${q.query}` : null
  const { data, error, loading } = useResource<Valuation>(url)
  if ('error' in q) return <Fail message={q.error} />

  return (
    <div className="space-y-3">
      <Fetched data={data} error={error} loading={loading}>
        {({ inputs: i, model: m }) => {
          if (m.missing) return <Fail message={`Missing ${m.missing.join(', ')}. Give it on the command line: ${ARG_HELP}.`} />
          const capital = (
            <Table rows={[
              ['Risk-free rate', p(m.rf), '10-year Treasury, latest close'],
              ['Equity risk premium', p(m.erp), i.erp_date ? `Damodaran's implied premium, ${i.erp_date}` : 'your input'],
              ['Beta', m.beta.toFixed(3), i.beta ? `adjusted, ${i.beta.weeks} weeks on SPX (raw ${i.beta.raw.toFixed(3)})` : 'your input'],
              ['Cost of equity', p(m.ke), 'risk-free + beta × premium'],
              ...(i.financial ? [] : [
                ['Cost of debt', p(m.kd), 'interest expense ÷ total debt'],
                ['Tax rate', p(i.tax, 1), `effective, year to ${i.fiscal_year_end ?? '—'}`],
                ['After-tax cost of debt', p(m.kd_after_tax), ''],
                ['Equity weight', p(m.equity_weight, 1), `market value ${big(i.market_cap)}, debt ${big(i.debt)}`],
                ['WACC', p(m.wacc), 'weighted by market equity and book debt'],
              ]),
            ]} rowKey={r => r[0]} columns={[
              { head: 'Cost of capital', align: 'left', cell: r => (r[0] === 'WACC' || r[0] === 'Cost of equity' ? <b>{r[0]}</b> : r[0]) },
              { head: '', cell: r => r[1] },
              { head: 'Source', align: 'left', cell: r => <span className="text-muted-foreground">{r[2]}</span> },
            ]} />
          )
          if (command.fn === 'WACC') return (
            <>
              {capital}
              {i.financial && <Note>{i.symbol} is a {i.sector?.toLowerCase()} company: its debt is the raw material of the business, so only the cost of equity applies.</Note>}
            </>
          )
          if (command.fn === 'DDM') {
            if (!m.ddm) return <Note>{i.symbol} pays no dividend, or its growth is at or above its cost of equity, so the dividend model has no answer.</Note>
            return (
              <>
                <Verdict label="Dividend model" m={m.ddm} current={i.price} />
                <p className="text-[12px] text-muted-foreground tabular-nums">
                  Trailing dividend {m.ddm.dividend.toFixed(2)}, growing {p(m.ddm.growth, 1)} a year for five years
                  (five-year history{i.dividend_growth_5y != null ? ` ${p(i.dividend_growth_5y, 1)}` : ''}, capped at 15%), then {p(m.ddm.terminal_growth, 1)} forever,
                  discounted at the cost of equity {p(m.ke)}.
                </p>
                <Flows m={m.ddm} what="Dividend" fmt={v => v.toFixed(2)} />
                {capital}
                <Note>Change the assumptions on the command line, for example {sec.label} DDM DG 6 TG 2. {ARG_HELP}.</Note>
              </>
            )
          }
          // DCF
          if (i.financial) return <Note>{i.symbol} is a {i.sector?.toLowerCase()} company. Its debt is the raw material of the business, so free cash flow and WACC mean nothing; use DDM.</Note>
          if (!m.dcf) return <Note>{i.symbol}&apos;s latest free cash flow is {big(i.fcf)}, so a cash-flow model has nothing to discount.</Note>
          const s = m.dcf.sensitivity
          return (
            <>
              <Verdict label="Discounted cash flow" m={m.dcf} current={i.price} />
              <p className="text-[12px] text-muted-foreground tabular-nums">
                Free cash flow to the firm {big(m.dcf.base_fcff)} (year to {i.fiscal_year_end}), growing {p(m.growth, 1)} a year for five years
                (three-year revenue growth{i.revenue_growth_3y != null ? ` ${p(i.revenue_growth_3y, 1)}` : ''}, kept between 0 and 15%), then {p(m.terminal_growth, 1)} forever,
                at a WACC of {p(m.wacc)}. Enterprise value {big(m.dcf.enterprise_value)}, less debt {big(i.debt)}, plus cash {big(i.cash)},
                is equity of {big(m.dcf.equity_value)} over {big(i.shares)} shares. {Math.round(m.dcf.terminal_share * 100)}% of the value is beyond year five.
              </p>
              <Flows m={m.dcf} what="Free cash flow" fmt={big} />
              <div className="overflow-x-auto">
                <p className="news-section-label mb-1">Value a share as WACC and terminal growth move</p>
                <table className="text-[12px] tabular-nums">
                  <thead><tr><th className="px-2 py-1 text-left text-muted-foreground font-normal">WACC \ growth</th>
                    {s.terminal_growth.map(t => <th key={t} className="px-2 py-1 text-right font-semibold">{p(t, 1)}</th>)}</tr></thead>
                  <tbody>
                    {s.wacc.map((w, r) => (
                      <tr key={w}>
                        <th className="px-2 py-1 text-left font-semibold">{p(w, 1)}</th>
                        {s.per_share[r].map((v, c) => (
                          <td key={c} className={`px-2 py-1 text-right ${r === 2 && c === 2 ? 'bg-foreground/10 font-semibold' : ''} ${v != null && v > i.price ? 'text-emerald-600 dark:text-emerald-400' : ''}`}>
                            {v == null ? '—' : price(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {capital}
              <Note>Change the assumptions on the command line, for example {sec.label} DCF G 8 TG 2 WACC 9. {ARG_HELP}. Green cells are above today&apos;s price.</Note>
            </>
          )
        }}
      </Fetched>
    </div>
  )
}
