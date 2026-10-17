'use client'

// The command line, with suggestions. Used by the global command bar and by
// every terminal panel.

import { forwardRef, useEffect, useState } from 'react'
import { suggest, type SecurityHit } from '@/lib/terminal/suggest'

interface Props {
  onSubmit: (text: string) => void
  onCancel?: () => void
  placeholder?: string
  autoFocus?: boolean
}

const SEARCH_DELAY_MS = 150

function useSecurityHits(word: string): SecurityHit[] {
  const [hits, setHits] = useState<SecurityHit[]>([])
  useEffect(() => {
    if (word.length < 1) { setHits([]); return }
    let live = true
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/lab/search?q=${encodeURIComponent(word)}`)
        const j = (await r.json()) as { results?: SecurityHit[] }
        if (live) setHits(j.results ?? [])
      } catch {
        if (live) setHits([])
      }
    }, SEARCH_DELAY_MS)
    return () => { live = false; clearTimeout(timer) }
  }, [word])
  return hits
}

const CommandInput = forwardRef<HTMLInputElement, Props>(function CommandInput(
  { onSubmit, onCancel, placeholder, autoFocus }, ref,
) {
  const [text, setText] = useState('')
  const [pick, setPick] = useState(-1)
  const firstWord = /\s/.test(text.trimStart()) ? '' : text.trim()
  const options = suggest(text, useSecurityHits(firstWord))

  function submit(line: string) {
    if (!line.trim()) return
    onSubmit(line.trim())
    setText('')
    setPick(-1)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && options.length) {
      e.preventDefault()
      setPick(p => (p + 1) % options.length)
    } else if (e.key === 'ArrowUp' && options.length) {
      e.preventDefault()
      setPick(p => (p <= 0 ? options.length - 1 : p - 1))
    } else if (e.key === 'Tab' && pick >= 0) {
      e.preventDefault()
      setText(options[pick].text)
      setPick(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      submit(pick >= 0 ? options[pick].text : text)
    } else if (e.key === 'Escape') {
      if (pick >= 0) setPick(-1)
      else onCancel?.()
    }
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        value={text}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={e => { setText(e.target.value); setPick(-1) }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="w-full font-mono text-[13px] uppercase placeholder:normal-case bg-muted/40 border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-foreground/40"
      />
      {options.length > 0 && (
        <ul className="absolute z-30 left-0 right-0 mt-1 rounded-md border border-border bg-background shadow-lg text-[12.5px] overflow-hidden">
          {options.map((o, i) => (
            <li key={o.text}>
              <button
                type="button"
                onMouseDown={e => { e.preventDefault(); submit(o.text) }}
                className={`w-full flex gap-3 px-2.5 py-1 text-left ${i === pick ? 'bg-muted' : 'hover:bg-muted/60'}`}>
                <span className="w-16 shrink-0 font-mono font-semibold">{o.label}</span>
                <span className="truncate text-muted-foreground">{o.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
})

export default CommandInput
