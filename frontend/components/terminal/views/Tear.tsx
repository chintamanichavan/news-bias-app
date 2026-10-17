import TearSheet from './TearSheet'
import type { ViewProps } from './types'

export default function Tear({ command }: ViewProps) {
  const sym = command.security!.symbol
  return (
    <div className="space-y-3">
      <a href={`/terminal/tear/${encodeURIComponent(sym)}`} target="_blank" rel="noreferrer"
        className="inline-block text-[12px] px-3 py-1 rounded-md bg-foreground text-background">
        Open the printable page
      </a>
      <TearSheet symbol={sym} />
    </div>
  )
}
