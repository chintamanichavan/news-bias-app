'use client'

// Checks price alerts about once a minute while Artha is open, and shows a
// notice (and a system notification, if allowed) when one fires.

import { useEffect } from 'react'
import { toast } from 'sonner'
import { send } from '@/lib/terminal/send'

const EVERY_MS = 60_000

interface Fired { id: number; symbol: string; op: string; level: number; note: string | null; triggered_price: number }

function announce(a: Fired) {
  const text = `${a.symbol} is ${a.op} ${a.level}: now ${a.triggered_price}${a.note ? ` (${a.note})` : ''}`
  toast(text, { duration: 15_000 })
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Artha alert', { body: text })
  }
}

export default function AlertWatcher() {
  useEffect(() => {
    let stopped = false
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const { fired } = await send<{ fired: Fired[] }>('POST', '/api/terminal/alerts/check')
        if (!stopped) fired.forEach(announce)
      } catch {
        /* the next check will try again */
      }
    }
    void check()
    const timer = setInterval(check, EVERY_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [])
  return null
}
