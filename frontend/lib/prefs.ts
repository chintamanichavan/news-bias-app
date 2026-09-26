'use client'

// Client-side personalization store — the server stays user-less. Followed
// topics and muted sources persist in localStorage; every read/write is
// guarded because storage can be absent or throw (private windows).

const TOPICS_KEY = 'cl-followed-topics'
const MUTED_KEY = 'cl-muted-sources'
const VOICE_KEY = 'cl-voice-uri'

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key)
    const val = raw ? JSON.parse(raw) : []
    return Array.isArray(val) ? val : []
  } catch { return [] }
}

function write(key: string, value: string[]) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

export const getFollowedTopics = () => read(TOPICS_KEY)
export const getMutedSources = () => read(MUTED_KEY)

export function toggleTopic(topic: string): string[] {
  const cur = read(TOPICS_KEY)
  const next = cur.includes(topic) ? cur.filter(t => t !== topic) : [...cur, topic]
  write(TOPICS_KEY, next)
  return next
}

export function toggleMutedSource(sourceId: string): string[] {
  const cur = read(MUTED_KEY)
  const next = cur.includes(sourceId) ? cur.filter(s => s !== sourceId) : [...cur, sourceId]
  write(MUTED_KEY, next)
  return next
}

export function getVoiceURI(): string | null {
  try { return localStorage.getItem(VOICE_KEY) } catch { return null }
}

export function setVoiceURI(uri: string) {
  try { localStorage.setItem(VOICE_KEY, uri) } catch {}
}
