import { Fetched, Note, Table, value } from '../kit'
import { useDossier } from './dossier'
import type { ViewProps } from './types'
import { pct } from '@/lib/terminal/numbers'

// One column per line item, newest year first. These are as filed with the
// SEC, so foreign companies and funds have none.
const LINES: [key: string, head: string][] = [
  ['revenue', 'Revenue'], ['gross_profit', 'Gross'], ['operating_income', 'Op. income'],
  ['net_income', 'Net income'], ['eps_diluted', 'EPS'], ['fcf', 'FCF'],
  ['op_margin_pct', 'Op. margin'], ['roe_pct', 'ROE'], ['diluted_shares', 'Shares'],
  ['dividends_paid', 'Dividends'], ['buybacks', 'Buybacks'],
]

export default function Financials({ command }: ViewProps) {
  const { data, error, loading } = useDossier(command.security!.symbol)
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const fh = d.fundamentals_history
        if (!fh || fh.fiscal_years.length === 0) {
          return <Note>No filings for {command.security!.label}. FA reads SEC filings, so it covers US filers only.</Note>
        }
        const years = [...fh.fiscal_years].reverse()
        return (
          <div className="space-y-3">
            <Table
              rows={years}
              rowKey={r => String(r.fy)}
              columns={[
                { head: 'FY', align: 'left', cell: r => r.fy },
                ...LINES.map(([key, head]) => ({ head, cell: (r: Record<string, number | null>) => value(key, r[key]) })),
              ]}
            />
            <Note>
              {fh.span_years} years. Growth a year: revenue {pct(fh.cagr.revenue)},
              {' '}free cash flow {pct(fh.cagr.fcf)}.
              {' '}Share count changed {pct(fh.shares_change_pct)} over the span.
            </Note>
          </div>
        )
      }}
    </Fetched>
  )
}
