import { describe, expect, it } from 'vitest'
import { format, parse, type Command } from './parse'
import {
  back, current, deserialize, emptyWorkspace, forward, run, serialize, setGroup, setLayout,
  type Workspace,
} from './workspace'

function cmd(input: string): Command {
  const p = parse(input)
  if (!p.ok) throw new Error(p.error)
  return p.command
}

function exec(ws: Workspace, index: number, input: string): Workspace {
  const r = run(ws, index, cmd(input))
  if (!r.ok) throw new Error(r.error)
  return r.ws
}

const shown = (ws: Workspace, i: number) => {
  const c = current(ws.panels[i])
  return c ? format(c) : null
}

describe('workspace', () => {
  it('starts with four panels and two on screen', () => {
    const ws = emptyWorkspace()
    expect(ws.panels).toHaveLength(4)
    expect(ws.layout).toBe(2)
    expect(ws.panels.map((_, i) => shown(ws, i))).toEqual(['WEI', 'TOP', 'PORT', 'HELP'])
  })

  it('runs a bare function on the panel\'s current security', () => {
    let ws = exec(emptyWorkspace(), 0, 'AAPL DES')
    ws = exec(ws, 0, 'GP 5Y')
    expect(shown(ws, 0)).toBe('AAPL GP 5Y')
  })

  it('runs the function an alias stands for, keeping its arguments', () => {
    expect(shown(exec(emptyWorkspace(), 0, 'CURV'), 0)).toBe('GC')
    expect(shown(exec(emptyWorkspace(), 0, 'NRG'), 0)).toBe('FUNC energy')       // a menu opens the list filtered
    expect(shown(exec(emptyWorkspace(), 0, 'AAPL CHKO 1Y'), 0)).toBe('AAPL CHKO 1Y')
  })

  it('refuses a security function when the panel has no security', () => {
    const r = run(emptyWorkspace(), 0, cmd('GP'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/GP needs a security/)
  })

  it('goes back and forward, and a new command drops the forward history', () => {
    let ws = exec(emptyWorkspace(), 0, 'AAPL DES')
    ws = exec(ws, 0, 'MSFT DES')
    ws = back(ws, 0)
    expect(shown(ws, 0)).toBe('AAPL DES')
    ws = forward(ws, 0)
    expect(shown(ws, 0)).toBe('MSFT DES')
    ws = back(back(ws, 0), 0)
    ws = exec(ws, 0, 'NVDA DES')
    expect(forward(ws, 0)).toEqual(ws)
    expect(ws.panels[0].history.map(format)).toEqual(['WEI', 'NVDA DES'])
  })

  it('stops at either end of history', () => {
    const ws = emptyWorkspace()
    expect(back(ws, 0)).toEqual(ws)
    expect(forward(ws, 0)).toEqual(ws)
  })

  it('spreads a new security to linked panels, keeping their functions', () => {
    let ws = exec(emptyWorkspace(), 0, 'AAPL DES')
    ws = exec(ws, 1, 'AAPL GP')
    ws = exec(ws, 2, 'AAPL HP')
    ws = setGroup(setGroup(ws, 0, 'A'), 1, 'A')
    ws = exec(ws, 0, 'MSFT DES')
    expect(shown(ws, 1)).toBe('MSFT GP')
    expect(shown(ws, 2)).toBe('AAPL HP') // not in the group
  })

  it('leaves linked market-wide panels alone', () => {
    let ws = setGroup(setGroup(emptyWorkspace(), 0, 'A'), 1, 'A') // panel 1 shows TOP
    ws = exec(ws, 0, 'MSFT DES')
    expect(shown(ws, 1)).toBe('TOP')
  })

  it('keeps focus inside the layout', () => {
    let ws: Workspace = { ...emptyWorkspace(), layout: 4, focus: 3 }
    ws = setLayout(ws, 1)
    expect(ws.focus).toBe(0)
  })

  it('survives a round trip through storage, and bad storage starts fresh', () => {
    let ws = exec(emptyWorkspace(), 0, 'VOD LN EQUITY GP 1Y')
    ws = setGroup(ws, 0, 'B')
    const again = deserialize(serialize(ws))
    expect(shown(again, 0)).toBe('VOD LN EQUITY GP 1Y')
    expect(again.panels[0].group).toBe('B')
    expect(deserialize('not json')).toEqual(emptyWorkspace())
    expect(deserialize(null)).toEqual(emptyWorkspace())
    expect(deserialize(JSON.stringify({ layout: 3, panels: [] }))).toEqual(emptyWorkspace())
  })

  it('drops stored commands that no longer parse', () => {
    const stored = JSON.parse(serialize(emptyWorkspace()))
    stored.panels[0].history = ['AAPL DES', 'AAPL NOSUCHFN']
    stored.panels[0].at = 1
    const ws = deserialize(JSON.stringify(stored))
    expect(ws.panels[0].history.map(format)).toEqual(['AAPL DES'])
    expect(shown(ws, 0)).toBe('AAPL DES')
  })
})
