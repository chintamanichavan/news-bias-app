'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The one place client pages fetch their data.
 *
 * Every tab used to do its own bare `useEffect(() => fetch(...))`. That has
 * three failure modes the user feels as "I have to refresh to see this tab":
 *
 *  1. A single blip — the ML service restarting, the web service restarting,
 *     a dropped connection — left the page permanently empty, because nothing
 *     retried and most pages reported the failure as "no data" rather than as
 *     an error. Only a manual reload recovered.
 *  2. Nothing was cached, so every visit to a tab was a cold fetch with a
 *     loading flash, even when you had just been there.
 *  3. A tab left open for hours kept showing whatever it fetched on mount.
 *
 * So: retry with backoff, keep the last good payload in a module-level cache
 * that outlives route changes, and revalidate when the tab comes back to the
 * foreground.
 */

interface Entry {
  data: unknown
  at: number
}

// Module-level, deliberately: it must survive unmount so that returning to a
// tab renders instantly from the previous payload while a fresh copy loads.
const cache = new Map<string, Entry>()
// De-dupes concurrent mounts of the same URL (e.g. React strict mode).
const inflight = new Map<string, Promise<unknown>>()

export interface Resource<T> {
  data: T | null
  /** True only when there is nothing to show yet. A background refresh is `refreshing`. */
  loading: boolean
  /** True while revalidating on top of data we already have. */
  refreshing: boolean
  /** Set only when every attempt failed. Stale `data` is kept alongside it. */
  error: string | null
  reload: () => void
}

interface Options {
  /** Attempts per load, including the first. */
  attempts?: number
  /** Serve cache without refetching if it is younger than this. */
  freshMs?: number
  /** Skip fetching entirely (e.g. a dependent query isn't ready). */
  enabled?: boolean
}

const BACKOFF_MS = [300, 900, 2400]

/**
 * Same retry policy as {@link useResource}, for callers that manage their own
 * state (paginated lists, POST-then-refetch flows).
 */
export async function fetchJSON<T>(url: string, attempts = 3): Promise<T> {
  return (await fetchWithRetry(url, attempts)) as T
}

async function fetchWithRetry(url: string, attempts: number): Promise<unknown> {
  let lastError: Error | null = null
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' })
      // 5xx is usually the proxy reporting the ML service is down or still
      // booting — worth another go. 4xx is our own bug; retrying won't help.
      if (!res.ok) {
        if (res.status < 500) throw new Error(`Request failed (${res.status})`)
        lastError = new Error(`Service unavailable (${res.status})`)
      } else {
        return await res.json()
      }
    } catch (e) {
      lastError = e as Error
      // A 4xx we raised above should not be retried.
      if (lastError.message.startsWith('Request failed')) break
    }
    if (i < attempts - 1) {
      await new Promise(r => setTimeout(r, BACKOFF_MS[Math.min(i, BACKOFF_MS.length - 1)]))
    }
  }
  throw lastError ?? new Error('Request failed')
}

export function useResource<T>(
  url: string | null,
  { attempts = 3, freshMs = 60_000, enabled = true }: Options = {},
): Resource<T> {
  const key = url ?? ''
  const cached = key ? cache.get(key) : undefined

  const [data, setData] = useState<T | null>((cached?.data as T) ?? null)
  const [loading, setLoading] = useState(!cached && enabled && !!url)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Bumped by reload() and by the visibility handler to force a fetch.
  const [nonce, setNonce] = useState(0)

  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const run = useCallback(async (force: boolean) => {
    if (!url || !enabled) return
    const hit = cache.get(url)
    if (hit && !force && Date.now() - hit.at < freshMs) {
      setData(hit.data as T)
      setLoading(false)
      return
    }

    if (hit) setRefreshing(true)
    else setLoading(true)

    let promise = inflight.get(url)
    if (!promise) {
      promise = fetchWithRetry(url, attempts)
      inflight.set(url, promise)
      promise.finally(() => { if (inflight.get(url) === promise) inflight.delete(url) })
    }

    try {
      const json = await promise
      cache.set(url, { data: json, at: Date.now() })
      if (!alive.current) return
      setData(json as T)
      setError(null)
    } catch (e) {
      if (!alive.current) return
      // Keep whatever we were already showing — a failed refresh should not
      // blank a page that was working a moment ago.
      setError((e as Error).message)
    } finally {
      if (alive.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [url, enabled, attempts, freshMs])

  useEffect(() => { void run(nonce > 0) }, [run, nonce])

  // A tab that was open while the backend was down should fix itself when the
  // user looks at it again, rather than waiting for a manual reload.
  useEffect(() => {
    if (!url || !enabled) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      const hit = cache.get(url)
      if (!hit || Date.now() - hit.at > freshMs) setNonce(n => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [url, enabled, freshMs])

  const reload = useCallback(() => setNonce(n => n + 1), [])

  return { data, loading, refreshing, error, reload }
}

/** Drop a cached payload so the next mount refetches — used after a manual refresh. */
export function invalidate(url: string) {
  cache.delete(url)
}
