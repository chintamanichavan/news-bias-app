'use client'

import { useEffect, useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'

type Theme = 'light' | 'dark' | 'system'

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
]

function applyTheme(t: Theme) {
  const isDark =
    t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

/**
 * A segmented light / dark / system switch.
 *
 * This used to be a single emoji that cycled through the three modes on click.
 * It was unlabelled, gave no indication of what the next click would do, and
 * sat at the end of a horizontally scrolling nav strip — so it read as
 * decoration. Showing all three states makes the current one legible and every
 * other one reachable in one click.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')
  // The server can't know the stored preference, so the first paint always
  // renders "system" as selected. Applying the highlight only after mount
  // keeps that from being a hydration mismatch.
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setTheme((localStorage.getItem('theme') as Theme) || 'system')
    setMounted(true)
  }, [])

  // React to OS-level changes when in system mode.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  function choose(next: Theme) {
    setTheme(next)
    localStorage.setItem('theme', next)
    applyTheme(next)
  }

  return (
    <div
      role="radiogroup"
      aria-label="Colour theme"
      className="flex items-center gap-0.5 rounded-full bg-muted/60 p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const selected = mounted && theme === value
        return (
          <button
            key={value}
            role="radio"
            aria-checked={selected}
            aria-label={label}
            title={`${label} theme`}
            onClick={() => choose(value)}
            className={[
              'grid place-items-center w-7 h-7 rounded-full transition-colors',
              selected
                ? 'bg-background text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            <Icon className="w-[15px] h-[15px]" strokeWidth={2} />
          </button>
        )
      })}
    </div>
  )
}
