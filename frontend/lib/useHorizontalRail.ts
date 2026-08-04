'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Makes a horizontally-scrolling strip usable with a plain mouse.
 *
 * Every rail in the app hides its scrollbar for looks. On a trackpad or a
 * touchscreen that's fine — two-finger and swipe both scroll sideways. With a
 * desktop mouse it left the strip with *no* way to move at all: Chrome does not
 * translate a vertical wheel into horizontal scroll, there was no scrollbar to
 * grab, and no buttons. The Top page carousel had 270px of content past the
 * edge and a label reading "Swipe →".
 *
 * Three affordances, in the order a mouse user will find them:
 *   - vertical wheel scrolls the rail while the pointer is over it
 *   - click-drag pans it
 *   - `scrollByPage` backs prev/next buttons, for anyone who wants a target
 *
 * `canLeft`/`canRight` say whether there is anything further in that direction,
 * so buttons and edge fades can disable themselves at the ends.
 */
export interface Rail<T extends HTMLElement> {
  /**
   * Callback ref, not an object ref: the rail is often rendered only once its
   * data arrives, so a `useRef` + mount-once effect would bind its listeners
   * while the node was still null and never retry.
   */
  ref: (node: T | null) => void
  canLeft: boolean
  canRight: boolean
  /** True mid-drag — use it to suppress the click a drag would otherwise fire. */
  dragging: boolean
  scrollByPage: (direction: -1 | 1) => void
}

/** Past this many pixels a press is a drag, not a click on a card. */
const DRAG_THRESHOLD = 6

export function useHorizontalRail<T extends HTMLElement = HTMLDivElement>(): Rail<T> {
  const ref = useRef<T | null>(null)
  // Bumped when the node attaches, so the listener effect re-runs for it.
  const [node, setNode] = useState<T | null>(null)
  const setRef = useCallback((n: T | null) => {
    ref.current = n
    setNode(n)
  }, [])
  const [edges, setEdges] = useState({ left: false, right: false })
  const [dragging, setDragging] = useState(false)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft < max - 1 })
  }, [])

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = ref.current
    if (!el) return
    // Just under a full viewport, so one card stays on screen as an anchor.
    el.scrollBy({ left: direction * el.clientWidth * 0.85, behavior: 'smooth' })
  }, [])

  useEffect(() => {
    const el = node
    if (!el) return
    sync()

    el.addEventListener('scroll', sync, { passive: true })
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)

    // ── Vertical wheel → horizontal scroll ────────────────────────────────
    // Only when the gesture is purely vertical: a trackpad already sends
    // deltaX for a sideways swipe, and hijacking that would double the
    // movement. Only while the rail can still move that way, so reaching the
    // end hands scrolling back to the page instead of trapping it.
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      const max = el.scrollWidth - el.clientWidth
      if (max <= 0) return
      const next = el.scrollLeft + e.deltaY
      if ((e.deltaY < 0 && el.scrollLeft <= 0) || (e.deltaY > 0 && el.scrollLeft >= max)) return
      e.preventDefault()
      el.scrollLeft = Math.max(0, Math.min(max, next))
    }
    // Must be non-passive — preventDefault is the whole point.
    el.addEventListener('wheel', onWheel, { passive: false })

    // ── Click-drag to pan ─────────────────────────────────────────────────
    let startX = 0
    let startScroll = 0
    let pointer: number | null = null
    let moved = false
    // scroll-snap fights a drag, so it comes off for the duration.
    let snapBack = ''

    const onPointerDown = (e: PointerEvent) => {
      // Left button only, and never on a real control.
      if (e.button !== 0) return
      if ((e.target as HTMLElement).closest('button, input, select, textarea')) return
      pointer = e.pointerId
      startX = e.clientX
      startScroll = el.scrollLeft
      moved = false
      snapBack = el.style.scrollSnapType
      el.style.scrollSnapType = 'none'
    }

    const onPointerMove = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      const dx = e.clientX - startX
      if (!moved && Math.abs(dx) < DRAG_THRESHOLD) return
      if (!moved) {
        moved = true
        setDragging(true)
        // Capture late, so a plain click is never swallowed.
        try { el.setPointerCapture(e.pointerId) } catch { /* already gone */ }
      }
      e.preventDefault()
      el.scrollLeft = startScroll - dx
    }

    const endDrag = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return
      pointer = null
      el.style.scrollSnapType = snapBack
      if (moved) {
        // Swallow exactly the click this drag is about to produce, so panning
        // across a card doesn't navigate to it.
        const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation() }
        el.addEventListener('click', swallow, { capture: true, once: true })
        // If no click follows (drag ended off a link), don't leave it armed.
        setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 0)
        setDragging(false)
      }
      moved = false
    }

    // Chrome starts a native drag-and-drop when you press on a link or an
    // image and move — which cancels the pointer stream, so panning across a
    // card did nothing at all. Suppressing dragstart leaves clicks untouched.
    const onDragStart = (e: Event) => e.preventDefault()
    el.addEventListener('dragstart', onDragStart)

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', endDrag)
    el.addEventListener('pointercancel', endDrag)

    return () => {
      el.removeEventListener('scroll', sync)
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('dragstart', onDragStart)
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', endDrag)
      el.removeEventListener('pointercancel', endDrag)
      ro.disconnect()
    }
  }, [node, sync])

  return { ref: setRef, canLeft: edges.left, canRight: edges.right, dragging, scrollByPage }
}
