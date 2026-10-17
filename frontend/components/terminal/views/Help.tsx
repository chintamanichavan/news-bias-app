import { Note } from '../kit'
import type { ViewProps } from './types'
import { lookup } from '@/lib/terminal/functions'

const EXAMPLES = [
  ['AAPL', 'Apple, description (DES is the default)'],
  ['AAPL GP 5Y', 'five-year price chart'],
  ['VOD LN EQUITY HP', 'Vodafone in London, price history'],
  ['EURUSD CURNCY GP', 'euro against the dollar'],
  ['SPX INDEX GP 1M', 'S&P 500, one month'],
  ['CL1 COMDTY GP', 'front-month crude oil'],
  ['GP 1Y', 'chart of whatever this panel is on'],
  ['EQS RETURN>=15 PE<20', 'screen companies by any measure'],
  ['MMAP', 'market heat map by sector'],
  ['WIRP', 'what futures price for the next Fed meetings'],
  ['FUNC dividend', 'find a function by name'],
  ['HELP DES', 'what a function does'],
]

const KEYS = [
  ['/ or Ctrl-K', 'command bar, from any page'],
  ['Alt-1 to Alt-4', 'focus a panel'],
  ['Alt-[ / Alt-]', 'back and forward in the focused panel'],
  ['A / B chip', 'link panels: a new security in one reloads the others'],
]

function Detail({ code, run }: { code: string; run: ViewProps['run'] }) {
  const fn = lookup(code)
  if (!fn) return <Note>There is no function called {code}. Try FUNC.</Note>
  return (
    <div className="space-y-2">
      <h3 className="font-serif text-xl font-bold">{fn.code} · {fn.name}</h3>
      <p className="text-[12.5px]">
        {fn.group}. {fn.security ? 'Runs on a security: ' : 'Market-wide: '}
        <code className="text-[12px]">{fn.security ? `AAPL ${fn.code}` : fn.code}</code>
      </p>
      {fn.status === 'live' && (
        <button onClick={() => run(fn.security ? `AAPL ${fn.code}` : fn.code)} className="text-[12px] underline">Try it</button>
      )}
      {fn.status === 'impossible' && <Note>Cannot be built on free data. {fn.why}</Note>}
    </div>
  )
}

export default function Help({ command, run }: ViewProps) {
  if (command.args[0]) return <Detail code={command.args[0]} run={run} />
  return (
    <div className="space-y-4 text-[12.5px]">
      <p>
        Type a security, then a function, then Enter. The grammar is
        {' '}<code>[SECURITY [EXCHANGE] [YELLOW KEY]] FUNCTION [PERIOD]</code>.
      </p>
      <div>
        <p className="news-section-label mb-1">Examples</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {EXAMPLES.map(([cmd, what]) => (
            <div key={cmd} className="contents">
              <dt><button onClick={() => run(cmd)} className="font-mono text-[12px] hover:underline">{cmd}</button></dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div>
        <p className="news-section-label mb-1">Keys</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          {KEYS.map(([key, what]) => (
            <div key={key} className="contents">
              <dt className="font-mono text-[12px]">{key}</dt>
              <dd className="text-muted-foreground">{what}</dd>
            </div>
          ))}
        </dl>
      </div>
      <Note>Yellow keys: EQUITY, CORP, GOVT, MTGE, MMKT, MUNI, PFD, COMDTY, INDEX, CURNCY.</Note>
    </div>
  )
}
