'use client'

import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark' | 'system'

function applyTheme(t: Theme) {
  const isDark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', isDark)
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system')

  useEffect(() => {
    const stored = (localStorage.getItem('theme') as Theme) || 'system'
    setTheme(stored)
  }, [])

  // React to OS-level changes when in system mode.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  function cycle() {
    const next: Theme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light'
    setTheme(next)
    localStorage.setItem('theme', next)
    applyTheme(next)
  }

  const label = theme === 'light' ? '☀️' : theme === 'dark' ? '🌙' : '🖥️'
  const title = `Theme: ${theme} (click to cycle)`

  return (
    <button
      onClick={cycle}
      title={title}
      aria-label={title}
      className="px-2 py-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground text-base leading-none"
    >
      {label}
    </button>
  )
}
