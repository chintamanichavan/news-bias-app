'use client'

// The terminal: up to four panels, each a command line over one function
// screen. State is the pure workspace in lib/terminal/workspace.ts; this page
// only wires it to the keyboard, the URL and the browser's storage.

import { useCallback, useEffect, useRef, useState } from 'react'
import { RUN_EVENT } from '@/components/terminal/CommandBar'
import TerminalPanel from '@/components/terminal/TerminalPanel'
import { parse } from '@/lib/terminal/parse'
import {
  back, deserialize, emptyWorkspace, forward, run, serialize, setGroup, setLayout,
  type Layout, type Workspace,
} from '@/lib/terminal/workspace'

const STORAGE_KEY = 'artha.terminal.v1'
const LAYOUTS: Layout[] = [1, 2, 4]
// On a wide screen every panel fits without scrolling the page; each scrolls
// inside itself. On a phone they stack at a readable height.
const HEIGHT: Record<Layout, string> = {
  1: 'h-[34rem] lg:h-[calc(100vh-13rem)]',
  2: 'h-[34rem] lg:h-[calc(100vh-13rem)]',
  4: 'h-[34rem] lg:h-[calc(50vh-7.5rem)]',
}
const GRID: Record<Layout, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-1 lg:grid-cols-2',
  4: 'grid-cols-1 lg:grid-cols-2',
}

export default function TerminalPage() {
  const [ws, setWs] = useState<Workspace>(emptyWorkspace)
  const [errors, setErrors] = useState<(string | null)[]>([null, null, null, null])
  const [loaded, setLoaded] = useState(false)
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  // runText reads the latest workspace through a ref, so the window listeners
  // below never hold a stale copy.
  const wsRef = useRef(ws)
  wsRef.current = ws

  const runText = useCallback((index: number, text: string) => {
    const parsed = parse(text)
    const result = parsed.ok ? run(wsRef.current, index, parsed.command) : parsed
    setErrors(e => e.map((x, i) => (i === index ? (result.ok ? null : result.error) : x)))
    if (result.ok) setWs(result.ws)
  }, [])

  useEffect(() => {
    let start = emptyWorkspace()
    try { start = deserialize(localStorage.getItem(STORAGE_KEY)) } catch { /* private mode */ }
    wsRef.current = start
    setWs(start)
    setLoaded(true)
    const pending = new URLSearchParams(window.location.search).get('run')
    if (pending) {
      runText(start.focus, pending)
      window.history.replaceState(null, '', '/terminal')
    }
  }, [runText])

  useEffect(() => {
    if (!loaded) return
    try { localStorage.setItem(STORAGE_KEY, serialize(ws)) } catch { /* private mode */ }
  }, [ws, loaded])

  useEffect(() => {
    const onRun = (e: Event) => runText(wsRef.current.focus, (e as CustomEvent<string>).detail)
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return
      const w = wsRef.current
      if (/^[1-4]$/.test(e.key) && Number(e.key) <= w.layout) {
        e.preventDefault()
        const i = Number(e.key) - 1
        setWs({ ...w, focus: i })
        inputs.current[i]?.focus()
      } else if (e.key === '[') {
        e.preventDefault()
        setWs(back(w, w.focus))
      } else if (e.key === ']') {
        e.preventDefault()
        setWs(forward(w, w.focus))
      }
    }
    window.addEventListener(RUN_EVENT, onRun)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener(RUN_EVENT, onRun)
      window.removeEventListener('keydown', onKey)
    }
  }, [runText])

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="news-section-label">Command line · linked panels · keyboard first</p>
          <h1 className="mt-1 font-serif text-4xl font-bold tracking-tight leading-none">Terminal</h1>
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Layout">
          {LAYOUTS.map(l => (
            <button key={l} onClick={() => setWs(setLayout(ws, l))}
              className={`text-[12px] px-2.5 py-1 rounded-full tabular-nums ${
                ws.layout === l ? 'bg-foreground text-background font-semibold' : 'bg-muted/60 text-muted-foreground hover:text-foreground'}`}>
              {l} {l === 1 ? 'panel' : 'panels'}
            </button>
          ))}
        </div>
      </header>
      <div className={`grid gap-4 ${GRID[ws.layout]}`}>
        {ws.panels.slice(0, ws.layout).map((panel, i) => (
          <TerminalPanel
            key={i}
            ref={el => { inputs.current[i] = el }}
            index={i}
            panel={panel}
            focused={ws.focus === i}
            height={HEIGHT[ws.layout]}
            error={errors[i]}
            onRun={text => runText(i, text)}
            onBack={() => setWs(back(ws, i))}
            onForward={() => setWs(forward(ws, i))}
            onGroup={g => setWs(setGroup(ws, i, g))}
            onFocus={() => ws.focus !== i && setWs({ ...ws, focus: i })}
          />
        ))}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        Press / anywhere for the command bar. HELP for examples, FUNC for every function and its status.
        Quotes are about 15 minutes late.
      </p>
    </div>
  )
}
