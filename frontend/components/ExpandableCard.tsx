'use client'

// The platform's card rule: every card is a summary with an expanded view
// behind it — larger charts, full tables, the numbers behind the numbers.
// Compact content renders in place; the ⤢ affordance opens an overlay that
// closes on Esc or backdrop click.

import { useCallback, useEffect, useRef, useState } from 'react'

interface Props {
  title: string
  /** Optional element rendered right of the title in both views (chips, selects). */
  aside?: React.ReactNode
  /** The in-place summary. */
  children: React.ReactNode
  /** The information-rich view. Rendered only while open. */
  expanded: React.ReactNode
  expandedTitle?: string
  className?: string
}

export default function ExpandableCard({ title, aside, children, expanded, expandedTitle, className }: Props) {
  const [open, setOpen] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    dialogRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, close])

  return (
    <div className={`news-card p-5 ${className ?? ''}`}>
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground truncate">{title}</p>
        <div className="flex items-center gap-2 shrink-0">
          {aside}
          <button
            onClick={() => setOpen(true)}
            aria-label={`Expand ${title}`}
            title="Expand"
            className="w-6 h-6 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center text-[13px] leading-none"
          >
            ⤢
          </button>
        </div>
      </div>
      {children}

      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-start sm:items-center justify-center p-3 sm:p-8 bg-black/45 backdrop-blur-[2px]"
          onMouseDown={e => { if (e.target === e.currentTarget) close() }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={expandedTitle ?? title}
            tabIndex={-1}
            className="news-card w-full max-w-4xl max-h-[92dvh] overflow-y-auto p-6 sm:p-8 outline-none shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3 mb-5">
              <p className="news-section-label">{expandedTitle ?? title}</p>
              <button
                onClick={close}
                aria-label="Close"
                className="w-7 h-7 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted flex items-center justify-center"
              >
                ✕
              </button>
            </div>
            {expanded}
          </div>
        </div>
      )}
    </div>
  )
}
