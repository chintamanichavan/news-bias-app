'use client'

import { useEffect, useRef, useState } from 'react'

/** The element's current width in CSS pixels, so an SVG can draw at one unit
 *  per pixel and keep its text at a normal size in any panel layout. */
export function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T | null>(null)
  const [width, setWidth] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(200, Math.round(entry.contentRect.width))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return { ref, width }
}
