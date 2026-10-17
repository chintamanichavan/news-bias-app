'use client'

// Checks price alerts and working paper limit orders about once a minute
// while Artha is open, and shows a notice (and a system notification, if
// allowed) when an alert fires or an order fills.

import { useEffect } from 'react'
import { toast } from 'sonner'
import { send } from '@/lib/terminal/send'

const EVERY_MS = 60_000

interface Fired { id: number; symbol: string; op: string; level: number; note: string | null; triggered_price: number }

interface Filled { symbol: string; side: string; quantity: number; fill_price: number }

function tell(text: string) {
  toast(text, { duration: 15_000 })
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification('Artha alert', { body: text })
  }
}

const announce = (a: Fired) => tell(`${a.symbol} is ${a.op} ${a.level}: now ${a.triggered_price}${a.note ? ` (${a.note})` : ''}`)
const announceFill = (o: Filled) => tell(`Paper order filled: ${o.side} ${o.quantity} ${o.symbol} at ${o.fill_price.toFixed(2)}`)

export default function AlertWatcher() {
  useEffect(() => {
    let stopped = false
    // each check stands alone, so one failing never hides the other's news
    const poll = async <T,>(url: string, use: (r: T) => void) => {
      try {
        const r = await send<T>('POST', url)
        if (!stopped) use(r)
      } catch {
        /* the next check will try again */
      }
    }
    const check = async () => {
      if (document.visibilityState !== 'visible') return
      await Promise.all([
        poll<{ fired: Fired[] }>('/api/terminal/alerts/check', r => r.fired.forEach(announce)),
        poll<{ filled: Filled[] }>('/api/terminal/orders/check', r => r.filled.forEach(announceFill)),
      ])
    }
    void check()
    const timer = setInterval(check, EVERY_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [])
  return null
}
