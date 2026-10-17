import { Fetched, Note } from '../kit'
import { rateText, useFx } from './fx'

export default function Crosses() {
  const { data, error, loading } = useFx()
  return (
    <Fetched data={data} error={error} loading={loading}>
      {d => {
        const { codes, matrix } = d.cross
        return (
          <div className="space-y-2">
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] tabular-nums">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-muted-foreground border-b border-border">
                    <th className="py-1.5 px-2 text-left">1 unit of</th>
                    {codes.map(c => <th key={c} className="py-1.5 px-2 text-right">{c}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {codes.map((from, i) => (
                    <tr key={from} className="border-b border-border/40 last:border-0">
                      <th className="py-1.5 px-2 text-left font-semibold">{from}</th>
                      {matrix[i].map((v, j) => (
                        <td key={codes[j]} className={`py-1.5 px-2 text-right ${i === j ? 'text-muted-foreground' : ''}`}>
                          {i === j ? '—' : rateText(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>Read across: one unit of the row currency buys this much of the column currency. Built from each rate against the dollar.</Note>
          </div>
        )
      }}
    </Fetched>
  )
}
