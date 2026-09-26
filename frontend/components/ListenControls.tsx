'use client'

// Particle's "hit Play on your feed", on the Web Speech API: reads the active
// digest card (title + summary), auto-advances to the next, with a voice
// picker (persisted) and rate control. Everything is on-device TTS.

import { useCallback, useEffect, useRef, useState } from 'react'
import { getVoiceURI, setVoiceURI } from '@/lib/prefs'

interface Props {
  /** Text of each card in feed order. */
  items: { title: string; text: string }[]
  activeIdx: number
  /** Scroll the digest to card i (listen keeps the view in sync). */
  onAdvance: (i: number) => void
}

export default function ListenControls({ items, activeIdx, onAdvance }: Props) {
  const [supported, setSupported] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [voiceURI, setVoice] = useState<string | null>(null)
  const [rate, setRate] = useState(1)
  const playingRef = useRef(false)
  const idxRef = useRef(activeIdx)
  idxRef.current = playing ? idxRef.current : activeIdx

  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return
    setSupported(true)
    const load = () => {
      const vs = speechSynthesis.getVoices().filter(v => v.lang.startsWith('en'))
      setVoices(vs)
      const saved = getVoiceURI()
      if (saved && vs.some(v => v.voiceURI === saved)) setVoice(saved)
      else if (vs.length && !voiceURI) setVoice(vs.find(v => v.default)?.voiceURI ?? vs[0].voiceURI)
    }
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      speechSynthesis.cancel()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const speakFrom = useCallback((i: number) => {
    if (i >= items.length) { setPlaying(false); playingRef.current = false; return }
    idxRef.current = i
    onAdvance(i)
    const u = new SpeechSynthesisUtterance(`${items[i].title}. ${items[i].text}`)
    const v = speechSynthesis.getVoices().find(x => x.voiceURI === (getVoiceURI() ?? ''))
    if (v) u.voice = v
    u.rate = rate
    u.onend = () => { if (playingRef.current) speakFrom(i + 1) }
    u.onerror = () => { setPlaying(false); playingRef.current = false }
    speechSynthesis.speak(u)
  }, [items, onAdvance, rate])

  function toggle() {
    if (playing) {
      playingRef.current = false
      setPlaying(false)
      speechSynthesis.cancel()
    } else {
      speechSynthesis.cancel()
      playingRef.current = true
      setPlaying(true)
      speakFrom(idxRef.current)
    }
  }

  if (!supported || items.length === 0) return null

  return (
    <div className="fixed bottom-4 left-4 z-40 flex items-center gap-2 bg-card/95 backdrop-blur px-3 py-2 rounded-full shadow-md border border-border/60">
      <button
        onClick={toggle}
        className="w-8 h-8 rounded-full bg-foreground text-background flex items-center justify-center text-sm hover:opacity-85"
        aria-label={playing ? 'Pause listening' : 'Listen to your feed'}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <span className="text-[11px] font-medium text-muted-foreground mr-1">Listen</span>
      <select
        value={voiceURI ?? ''}
        onChange={e => { setVoice(e.target.value); setVoiceURI(e.target.value) }}
        className="text-[11px] bg-transparent text-muted-foreground max-w-[110px] outline-none"
        aria-label="Voice"
      >
        {voices.map(v => (
          <option key={v.voiceURI} value={v.voiceURI}>{v.name.replace(/^(Microsoft|Google) /, '')}</option>
        ))}
      </select>
      <select
        value={rate}
        onChange={e => setRate(Number(e.target.value))}
        className="text-[11px] bg-transparent text-muted-foreground outline-none"
        aria-label="Speed"
      >
        {[0.8, 1, 1.2, 1.5].map(r => <option key={r} value={r}>{r}×</option>)}
      </select>
    </div>
  )
}
