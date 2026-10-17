// The terminal's state: panels, each with its own history, joined in link
// groups. Pure functions only; the page holds the state and persists it.

import { lookup, resolveWithArgs } from './functions'
import { format, parse, type Command, type Security } from './parse'

export type LinkGroup = 'A' | 'B' | null
export type Layout = 1 | 2 | 4

export interface Panel {
  group: LinkGroup
  history: Command[]
  /** index into history of the command on screen; -1 when empty */
  at: number
}

export interface Workspace {
  layout: Layout
  panels: Panel[]
  focus: number
}

const HISTORY_LIMIT = 50
const PANEL_COUNT = 4

export function emptyWorkspace(): Workspace {
  const start = ['WEI', 'TOP', 'PORT', 'HELP']
  return {
    layout: 2,
    panels: start.map(input => {
      const p = parse(input)
      return { group: null, history: p.ok ? [p.command] : [], at: p.ok ? 0 : -1 }
    }),
    focus: 0,
  }
}

export function current(panel: Panel): Command | null {
  return panel.at >= 0 ? panel.history[panel.at] : null
}

/** The security a panel is showing, if any — what a bare function runs on. */
export function securityOf(panel: Panel): Security | null {
  for (let i = panel.at; i >= 0; i--) {
    const s = panel.history[i].security
    if (s) return s
  }
  return null
}

function push(panel: Panel, command: Command): Panel {
  const kept = panel.history.slice(0, panel.at + 1)
  const history = [...kept, command].slice(-HISTORY_LIMIT)
  return { ...panel, history, at: history.length - 1 }
}

function replace(ws: Workspace, index: number, panel: Panel): Workspace {
  return { ...ws, panels: ws.panels.map((p, i) => (i === index ? panel : p)) }
}

export type RunResult = { ok: true; ws: Workspace } | { ok: false; error: string }

/**
 * Run a command in one panel. A function that needs a security and was given
 * none uses the panel's current one. A new security spreads to the other
 * panels in the same link group, each keeping its own function.
 */
export function run(ws: Workspace, index: number, command: Command): RunResult {
  // an alias runs the function it stands for (CURV is GC)
  const { fn, args } = resolveWithArgs(command.fn)
  if (!fn) return { ok: false, error: `Unknown function ${command.fn}.` }

  let cmd = fn.code === command.fn.toUpperCase() ? command
    : { ...command, fn: fn.code, args: command.args.length ? command.args : args }
  if (fn.security && !cmd.security) {
    const sec = securityOf(ws.panels[index])
    if (!sec) return { ok: false, error: `${fn.code} needs a security first, for example "AAPL ${fn.code}".` }
    cmd = { ...cmd, security: sec }
  }

  let next = replace(ws, index, push(ws.panels[index], cmd))
  const group = ws.panels[index].group
  if (command.security && group) {
    next.panels.forEach((p, i) => {
      if (i === index || p.group !== group) return
      const shown = current(p)
      if (shown && lookup(shown.fn)?.security) {
        next = replace(next, i, push(p, { ...shown, security: command.security }))
      }
    })
  }
  return { ok: true, ws: { ...next, focus: index } }
}

export function back(ws: Workspace, index: number): Workspace {
  const p = ws.panels[index]
  return p.at > 0 ? replace(ws, index, { ...p, at: p.at - 1 }) : ws
}

export function forward(ws: Workspace, index: number): Workspace {
  const p = ws.panels[index]
  return p.at < p.history.length - 1 ? replace(ws, index, { ...p, at: p.at + 1 }) : ws
}

export function setGroup(ws: Workspace, index: number, group: LinkGroup): Workspace {
  return replace(ws, index, { ...ws.panels[index], group })
}

export function setLayout(ws: Workspace, layout: Layout): Workspace {
  return { ...ws, layout, focus: Math.min(ws.focus, layout - 1) }
}

// Storage keeps commands as typed text and re-parses them on load, so a
// change to the grammar or the registry can never load a broken panel.

interface Stored {
  layout: Layout
  focus: number
  panels: { group: LinkGroup; history: string[]; at: number }[]
}

export function serialize(ws: Workspace): string {
  const stored: Stored = {
    layout: ws.layout,
    focus: ws.focus,
    panels: ws.panels.map(p => ({ group: p.group, history: p.history.map(format), at: p.at })),
  }
  return JSON.stringify(stored)
}

export function deserialize(text: string | null): Workspace {
  if (!text) return emptyWorkspace()
  try {
    const s = JSON.parse(text) as Stored
    if (![1, 2, 4].includes(s.layout) || s.panels?.length !== PANEL_COUNT) return emptyWorkspace()
    const panels = s.panels.map(p => {
      const history = p.history.flatMap(h => {
        const parsed = parse(h)
        return parsed.ok ? [parsed.command] : []
      })
      const at = Math.min(Math.max(p.at, history.length ? 0 : -1), history.length - 1)
      return { group: p.group === 'A' || p.group === 'B' ? p.group : null, history, at }
    })
    return { layout: s.layout, panels, focus: Math.min(Math.max(0, s.focus), s.layout - 1) }
  } catch {
    return emptyWorkspace()
  }
}
