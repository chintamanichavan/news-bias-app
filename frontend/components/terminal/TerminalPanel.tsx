'use client'

import { forwardRef } from 'react'
import CommandInput from './CommandInput'
import { viewFor } from './views'
import { lookup } from '@/lib/terminal/functions'
import { format } from '@/lib/terminal/parse'
import { current, type LinkGroup, type Panel } from '@/lib/terminal/workspace'

interface Props {
  index: number
  panel: Panel
  focused: boolean
  error: string | null
  onRun: (text: string) => void
  onBack: () => void
  onForward: () => void
  onGroup: (g: LinkGroup) => void
  onFocus: () => void
  /** height classes from the page's layout */
  height: string
}

const GROUPS: LinkGroup[] = [null, 'A', 'B']

const GROUP_STYLE: Record<'A' | 'B', string> = {
  A: 'bg-sky-500 text-white',
  B: 'bg-amber-500 text-white',
}

const TerminalPanel = forwardRef<HTMLInputElement, Props>(function TerminalPanel(
  { index, panel, focused, error, onRun, onBack, onForward, onGroup, onFocus, height }, inputRef,
) {
  const cmd = current(panel)
  const fn = cmd ? lookup(cmd.fn) : undefined
  const View = cmd ? viewFor(cmd.fn, cmd.security?.key ?? null) : null

  return (
    <section onMouseDown={onFocus}
      className={`news-card flex flex-col border ${height} ${focused ? 'border-foreground/30' : 'border-border'}`}>
      <header className="px-3 pt-3 pb-2 space-y-2 border-b border-border">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-muted-foreground w-4">{index + 1}</span>
          <div className="flex-1">
            <CommandInput ref={inputRef} onSubmit={onRun}
              placeholder={cmd ? `${format(cmd)} — type a command` : 'Type a command, e.g. AAPL DES'} />
          </div>
          <button onClick={onBack} disabled={panel.at <= 0} aria-label="Back"
            className="px-1.5 text-muted-foreground disabled:opacity-30 hover:text-foreground">‹</button>
          <button onClick={onForward} disabled={panel.at >= panel.history.length - 1} aria-label="Forward"
            className="px-1.5 text-muted-foreground disabled:opacity-30 hover:text-foreground">›</button>
          <div className="flex gap-0.5" role="group" aria-label="Link group">
            {GROUPS.map(g => (
              <button key={g ?? 'none'} onClick={() => onGroup(g)} title={g ? `Link group ${g}` : 'Not linked'}
                className={`w-5 h-5 rounded text-[10px] font-bold ${
                  panel.group === g ? (g ? GROUP_STYLE[g] : 'bg-foreground text-background') : 'bg-muted/60 text-muted-foreground'}`}>
                {g ?? '–'}
              </button>
            ))}
          </div>
        </div>
        {cmd && (
          <div className="flex items-baseline gap-2 min-w-0">
            <span className="font-mono text-[11px] font-semibold">{cmd.fn}</span>
            <span className="font-serif text-[15px] font-semibold truncate">{fn?.name}</span>
            {cmd.security && <span className="text-[11px] text-muted-foreground truncate">{cmd.security.label}</span>}
          </div>
        )}
        {error && <p className="text-[11.5px] text-red-600 dark:text-red-400">{error}</p>}
      </header>
      <div className="p-3 flex-1 min-h-0 overflow-auto">
        {/* keyed by the command, so a screen's own state (typed filters, a
            search box) starts fresh for each command instead of carrying over */}
        {cmd && View ? <View key={`${panel.at}:${format(cmd)}`} command={cmd} run={onRun} /> : (
          <p className="text-[12px] text-muted-foreground">Empty panel. Type HELP to start.</p>
        )}
      </div>
    </section>
  )
})

export default TerminalPanel
