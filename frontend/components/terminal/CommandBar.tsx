'use client'

// The command line on every page: "/" or Ctrl-K opens it, Enter sends the
// command to the terminal (to its focused panel when already there).

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import CommandInput from './CommandInput'

export const RUN_EVENT = 'artha:terminal-run'

function typingIn(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
}

export default function CommandBar() {
  const [open, setOpen] = useState(false)
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'
      const slash = e.key === '/' && !typingIn(e.target)
      if (ctrlK || slash) {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function run(text: string) {
    setOpen(false)
    if (pathname === '/terminal') window.dispatchEvent(new CustomEvent(RUN_EVENT, { detail: text }))
    else router.push(`/terminal?run=${encodeURIComponent(text)}`)
  }

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[18vh] px-4"
      onMouseDown={() => setOpen(false)}>
      <div className="w-full max-w-xl news-card p-3 shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <CommandInput autoFocus onSubmit={run} onCancel={() => setOpen(false)}
          placeholder="Security and function, e.g. AAPL GP 5Y · HELP · FUNC" />
        <p className="mt-2 text-[11px] text-muted-foreground">Enter to run · ↑↓ to choose · Tab to complete · Esc to close</p>
      </div>
    </div>
  )
}
