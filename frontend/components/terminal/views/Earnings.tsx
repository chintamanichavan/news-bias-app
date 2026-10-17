import { Note, Table } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { big, day, pct, tone } from '@/lib/terminal/numbers'

const eps = (v: number | null) => (v == null ? '—' : v.toFixed(2))

export default function Earnings({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="earnings" missing="No earnings history is published for this security.">
      {e => (
        <div className="space-y-4">
          <div>
            <p className="news-section-label mb-1">Last quarters: reported against expected</p>
            <Table
              rows={[...e.quarters].reverse()}
              rowKey={q => q.quarter_end}
              columns={[
                { head: 'Quarter ended', align: 'left', cell: q => day(q.quarter_end) },
                { head: 'Expected EPS', cell: q => eps(q.estimate) },
                { head: 'Reported EPS', cell: q => <b>{eps(q.actual)}</b> },
                { head: 'Surprise', cell: q => pct(q.surprise_pct), className: q => `font-semibold ${tone(q.surprise_pct)}` },
              ]}
            />
          </div>
          {e.years.length > 0 && (
            <div>
              <p className="news-section-label mb-1">By year</p>
              <Table
                rows={[...e.years].reverse()}
                rowKey={y => String(y.year)}
                columns={[
                  { head: 'Year', align: 'left', cell: y => y.year },
                  { head: 'Revenue', cell: y => big(y.revenue) },
                  { head: 'Earnings', cell: y => big(y.earnings) },
                  { head: 'Margin', cell: y => (y.revenue && y.earnings != null ? pct((y.earnings / y.revenue) * 100, false) : '—') },
                ]}
              />
            </div>
          )}
          <Note>FA has the full filed record from the SEC.</Note>
        </div>
      )}
    </CompanySection>
  )
}
