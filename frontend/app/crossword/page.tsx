'use client'

// Daily news mini-crossword (Particle's puzzle, rebuilt on our corpus): every
// answer is a word from that day's markets/weather headlines, every clue is
// the blanked headline with its outlet. Any past date with articles works —
// that's the archive.

import { useEffect, useMemo, useState } from 'react'
import LoadError from '@/components/LoadError'
import { useResource } from '@/lib/useResource'

interface Entry {
  answer: string
  clue: string
  row: number
  col: number
  dir: 'across' | 'down'
  number: number
}

interface Puzzle {
  date: string
  rows: number
  cols: number
  entries: Entry[]
  headline_pool: number
}

function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function CrosswordPage() {
  const [date, setDate] = useState(todayISO())
  const { data, loading, error, reload } = useResource<Puzzle>(`/api/crossword?date=${date}`)
  const [letters, setLetters] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)

  useEffect(() => { setLetters({}); setChecked(false) }, [date])

  // Solution + numbering maps derived from entries
  const { solution, numbers } = useMemo(() => {
    const sol: Record<string, string> = {}
    const nums: Record<string, number> = {}
    for (const e of data?.entries ?? []) {
      for (let i = 0; i < e.answer.length; i++) {
        const r = e.dir === 'down' ? e.row + i : e.row
        const c = e.dir === 'across' ? e.col + i : e.col
        sol[`${r},${c}`] = e.answer[i]
      }
      const key = `${e.row},${e.col}`
      nums[key] = e.number
    }
    return { solution: sol, numbers: nums }
  }, [data])

  const cells = Object.keys(solution)
  const filled = cells.filter(k => letters[k]).length
  const correct = cells.filter(k => letters[k] === solution[k]).length
  const solved = cells.length > 0 && correct === cells.length

  function setCell(key: string, v: string) {
    setChecked(false)
    setLetters(prev => ({ ...prev, [key]: v.toUpperCase().slice(-1) }))
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="news-section-label">Daily puzzle</p>
          <h1 className="mt-1 text-3xl sm:text-4xl font-bold tracking-tight leading-none">News Crossword</h1>
          <p className="mt-3 text-sm text-muted-foreground max-w-prose">
            Every answer comes from a headline in today&rsquo;s markets &amp; weather coverage.
            Pick any past date for the archive.
          </p>
        </div>
        <input
          type="date"
          value={date}
          max={todayISO()}
          onChange={e => e.target.value && setDate(e.target.value)}
          className="text-[13px] bg-transparent border border-border rounded-md px-2.5 py-1.5 text-muted-foreground"
          aria-label="Puzzle date"
        />
      </div>

      {error && <div className="mt-8"><LoadError message={error} onRetry={reload} /></div>}
      {loading && !data && <div className="mt-8 skeleton h-96 rounded-2xl" />}

      {data && data.entries.length === 0 && (
        <p className="mt-8 text-sm text-muted-foreground">
          Not enough headlines on {data.date} to build a puzzle — try another date.
        </p>
      )}

      {data && data.entries.length > 0 && (
        <div className="mt-8 grid lg:grid-cols-[auto_1fr] gap-8 items-start">
          {/* Grid */}
          <div>
            <div
              className="inline-grid gap-px bg-border p-px rounded-md"
              style={{ gridTemplateColumns: `repeat(${data.cols}, 2.1rem)` }}
            >
              {Array.from({ length: data.rows * data.cols }).map((_, i) => {
                const r = Math.floor(i / data.cols)
                const c = i % data.cols
                const key = `${r},${c}`
                if (!(key in solution)) return <div key={key} className="w-[2.1rem] h-[2.1rem] bg-background/40" />
                const wrong = checked && letters[key] && letters[key] !== solution[key]
                const right = checked && letters[key] === solution[key]
                return (
                  <div key={key} className="relative w-[2.1rem] h-[2.1rem]">
                    {numbers[key] && (
                      <span className="absolute top-0 left-0.5 text-[8px] text-muted-foreground tabular-nums z-10">{numbers[key]}</span>
                    )}
                    <input
                      value={letters[key] ?? ''}
                      onChange={e => setCell(key, e.target.value)}
                      maxLength={2}
                      className={`w-full h-full text-center uppercase font-semibold text-sm outline-none border-0
                        ${wrong ? 'bg-red-500/25' : right ? 'bg-emerald-500/20' : 'bg-card focus:bg-amber-500/10'}`}
                      aria-label={`Cell ${key}`}
                    />
                  </div>
                )
              })}
            </div>

            <div className="mt-4 flex items-center gap-4">
              <button
                onClick={() => setChecked(true)}
                className="text-[13px] font-medium px-3.5 py-1.5 rounded-full bg-foreground text-background hover:opacity-85"
              >
                Check
              </button>
              <button
                onClick={() => { setLetters({}); setChecked(false) }}
                className="text-[13px] text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
              <span className="text-[12px] text-muted-foreground tabular-nums">{filled}/{cells.length} filled</span>
              {solved && <span className="text-[13px] font-semibold text-emerald-600 dark:text-emerald-400">Solved ✓</span>}
            </div>
          </div>

          {/* Clues */}
          <div className="grid sm:grid-cols-2 gap-6">
            {(['across', 'down'] as const).map(dir => (
              <div key={dir}>
                <p className="news-section-label mb-2">{dir}</p>
                <ol className="space-y-2.5">
                  {data.entries.filter(e => e.dir === dir).map(e => (
                    <li key={`${e.number}${e.dir}`} className="text-[13px] leading-snug">
                      <span className="font-semibold tabular-nums mr-1.5">{e.number}.</span>
                      <span className="text-foreground/85">{e.clue}</span>
                      <span className="text-muted-foreground text-[11px] ml-1">({e.answer.length})</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
