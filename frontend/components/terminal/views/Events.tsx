import { Kv, Note } from '../kit'
import { CompanySection } from './company'
import type { ViewProps } from './types'
import { day } from '@/lib/terminal/numbers'

export default function Events({ command }: ViewProps) {
  return (
    <CompanySection symbol={command.security!.symbol} section="events" missing="No upcoming events are published for this security.">
      {e => (
        <div className="space-y-3">
          <p className="text-[13px]">
            Next earnings: <b>{e.earnings_dates.length ? e.earnings_dates.map(d => day(d)).join(' to ') : 'not announced'}</b>
            {e.earnings_date_is_estimate ? ' (estimated by Yahoo, not confirmed by the company)' : ''}
          </p>
          <Kv data={{
            eps_expected: e.eps_expected, revenue_expected: e.revenue_expected,
            ex_dividend: e.ex_dividend, dividend_paid: e.dividend_paid,
          }} />
          <Note>ECO has the economy-wide calendar; DVD has the dividend history.</Note>
        </div>
      )}
    </CompanySection>
  )
}
