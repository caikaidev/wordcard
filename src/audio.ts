import { useSyncExternalStore } from 'react'
import { ttsUrl } from './api'

/**
 * One audio session for the whole app: iOS Safari needs explicit user activation
 * for speechSynthesis after an asynchronous cloud/media failure.
 */
type State = { text: string | null; loading: boolean; needsTap: boolean }
type Engine = 'melo' | 'system'
type Session = { text: string; slow: boolean; id: number }
let state: State = { text: null, loading: false, needsTap: false }
const listeners = new Set<() => void>()
const set = (s: State) => { state = s; listeners.forEach((l) => l()) }
let el: HTMLAudioElement | null = null
let current: Session | null = null
let nextId = 0
let mode: 'audio' | 'system' | null = null
let finish: ((ok: boolean) => void) | null = null
let onPlaying: ((engine: Engine) => void) | null = null
let speechTimer: ReturnType<typeof setTimeout> | null = null
let speechAttempt = 0
let speechStarting = false
let notified = false

// Use a solid square PNG for iOS lock-screen artwork. PWA/app icons are
// separately cropped by each platform, and transparent corners show white here.
function setMediaArtwork() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: '拾句',
      artist: '英语朗读',
      artwork: [{ src: '/media-artwork.png?v=3', sizes: '512x512', type: 'image/png' }],
    })
  } catch { /* Media Session is optional; playback must still work. */ }
}

function clearMediaArtwork() {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  try { navigator.mediaSession.metadata = null } catch { /* ignore unsupported browsers */ }
}

function clearSpeechTimer() {
  if (speechTimer !== null) clearTimeout(speechTimer)
  speechTimer = null
}

function done(ok: boolean) {
  speechAttempt++
  speechStarting = false
  clearSpeechTimer()
  current = null
  mode = null
  set({ text: null, loading: false, needsTap: false })
  const f = finish
  finish = null
  onPlaying = null
  clearMediaArtwork()
  f?.(ok)
}

function audio() {
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
    el.addEventListener('playing', () => {
      if (mode !== 'audio' || !current) return
      set({ text: current.text, loading: false, needsTap: false })
      const cb = onPlaying
      onPlaying = null
      cb?.('melo')
    })
    el.addEventListener('ended', () => {
      if (mode === 'audio' && current) done(true)
    })
    el.addEventListener('error', () => {
      if (mode === 'audio' && current) startSystemSpeech(false)
    })
  }
  return el
}

/* ---------------------- R2 / browser audio prefetch ---------------------- */

const ready = new Map<string, string>()
const pending = new Set<string>()
// Cache-only lookups and full syntheses share pending; remember an explicit
// generation request instead of losing it behind an in-flight R2 probe.
const checkingCache = new Set<string>()
const generateAfterCheck = new Set<string>()
const queue: string[] = []
let running = 0
const MAX_READY = 80

function remember(text: string, blob: Blob) {
  if (!blob.type.startsWith('audio/')) return
  const old = ready.get(text)
  if (old) URL.revokeObjectURL(old)
  ready.delete(text)
  ready.set(text, URL.createObjectURL(blob))
  if (ready.size > MAX_READY) {
    const oldest = ready.entries().next().value as [string, string] | undefined
    if (oldest && oldest[0] !== current?.text) {
      URL.revokeObjectURL(oldest[1])
      ready.delete(oldest[0])
    }
  }
}

function pump() {
  while (running < 2 && queue.length) {
    const text = queue.shift()!
    running++
    fetch(ttsUrl(text))
      .then((r) => r.ok && r.headers.get('content-type')?.startsWith('audio/') ? r.blob() : null)
      .then((blob) => { if (blob) remember(text, blob) })
      .catch(() => {})
      .finally(() => { pending.delete(text); running--; pump() })
  }
}

export function prefetch(texts: (string | undefined | null)[]) {
  for (const t of texts) {
    const text = t?.trim()
    if (!text || ready.has(text)) continue
    if (checkingCache.has(text)) {
      // Upgrade this cache-only request to a full prewarm only on cache miss.
      generateAfterCheck.add(text)
      continue
    }
    if (pending.has(text)) continue
    pending.add(text)
    queue.push(text)
  }
  pump()
}

export function prefetchCached(texts: (string | undefined | null)[]) {
  for (const t of texts) {
    const text = t?.trim()
    if (!text || ready.has(text) || pending.has(text)) continue
    pending.add(text)
    checkingCache.add(text)
    fetch(ttsUrl(text) + '&cached=1')
      .then((r) => r.status === 200 && r.headers.get('content-type')?.startsWith('audio/') ? r.blob() : null)
      .then((blob) => { if (blob) remember(text, blob) })
      .catch(() => {})
      .finally(() => {
        const shouldGenerate = generateAfterCheck.delete(text)
        checkingCache.delete(text)
        pending.delete(text)
        // A failed or missing cache check must not swallow an explicitly
        // requested prewarm. The normal prefetch queue still limits concurrency.
        if (shouldGenerate && !ready.has(text)) prefetch([text])
      })
  }
}

/* ------------------------ System speech fallback ------------------------ */

function pickVoice() {
  const synth = window.speechSynthesis
  const voices = synth?.getVoices() ?? []
  return voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en')) ?? null
}

/**
 * On an async Cloudflare error, attempt system speech once. If Safari doesn't
 * start it, show a tap-to-speak prompt instead of claiming that it worked.
 * Manual retries call this directly from an actual user click.
 */
function startSystemSpeech(manual: boolean, quiet = false) {
  const session = current
  if (!session || (speechStarting && !manual)) return
  const synth = window.speechSynthesis
  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    if (!manual) set({ text: session.text, loading: false, needsTap: true })
    else done(false)
    return
  }
  const attempt = ++speechAttempt
  speechStarting = true
  clearSpeechTimer()
  mode = 'system'
  el?.pause()
  clearMediaArtwork()
  if (!notified && !quiet) {
    notified = true
    import('./components/ui').then((m) => m.toast('云端语音不可用，正在尝试系统朗读；如无声音请点击下方按钮'))
  }
  try { synth.cancel() } catch { /* browser may reject cancel() */ }
  const u = new SpeechSynthesisUtterance(session.text)
  u.lang = 'en-US'
  u.rate = session.slow ? 0.75 : 0.95
  const voice = pickVoice()
  if (voice) u.voice = voice
  let started = false
  const isCurrent = () => current === session && attempt === speechAttempt
  const failedToStart = () => {
    if (!isCurrent() || started) return
    clearSpeechTimer()
    speechStarting = false
    set({ text: session.text, loading: false, needsTap: true })
    if (manual) import('./components/ui').then((m) => m.toast('Safari 未启动系统朗读，可再次点击或检查设备语音设置', 'error'))
  }
  u.onstart = () => {
    if (!isCurrent()) return
    started = true
    speechStarting = false
    clearSpeechTimer()
    set({ text: session.text, loading: false, needsTap: false })
    const cb = onPlaying
    onPlaying = null
    cb?.('system')
  }
  u.onend = () => { if (isCurrent()) done(true) }
  u.onerror = () => {
    if (!isCurrent()) return
    if (started) done(false)
    else failedToStart()
  }
  set({ text: session.text, loading: true, needsTap: false })
  // Safari may silently suppress a speech request without firing onerror.
  speechTimer = setTimeout(failedToStart, 4500)
  try { synth.speak(u) } catch { failedToStart() }
}

export function retrySystemSpeech() {
  if (!current) return
  startSystemSpeech(true, true)
}

/** Explicit test: runs directly from the user's click (not a delayed fetch). */
export function speakSystem(text: string, slow = false, playing?: (engine: Engine) => void): Promise<boolean> {
  stop()
  current = { text, slow, id: ++nextId }
  onPlaying = playing ?? null
  set({ text, loading: true, needsTap: false })
  const promise = new Promise<boolean>((resolve) => { finish = resolve })
  startSystemSpeech(true, true)
  return promise
}

/* ------------------------ Public playback controls ------------------------ */

/** Instant single-word playback: use system speech inside the click gesture while
 * the cloud version is prepared for the next play. Already prefetched audio wins. */
export function speakFast(text: string) {
  if (ready.has(text.trim()) || !window.speechSynthesis) return speak(text)
  const playback = speakSystem(text)
  prefetch([text])
  return playback
}

export function speak(text: string, slow = false, playing?: (engine: Engine) => void): Promise<boolean> {
  stop()
  current = { text, slow, id: ++nextId }
  mode = 'audio'
  onPlaying = playing ?? null
  set({ text, loading: true, needsTap: false })
  const promise = new Promise<boolean>((resolve) => { finish = resolve })
  // When offline, invoke speechSynthesis synchronously within the click.
  if (!navigator.onLine && !ready.has(text.trim())) {
    startSystemSpeech(true, true)
    return promise
  }
  const player = audio()
  const local = !slow && ready.get(text.trim())
  player.src = local || ttsUrl(text, slow)
  player.playbackRate = slow ? 0.75 : 1
  player.preservesPitch = true
  setMediaArtwork()
  player.play().catch((err: DOMException) => {
    if (mode !== 'audio' || !current) return
    // Autoplay restrictions are not proof that the cloud has failed.
    if (err?.name === 'NotAllowedError') {
      set({ text: current.text, loading: false, needsTap: true })
    } else {
      startSystemSpeech(false)
    }
  })
  return promise
}

export function stop() {
  if (!current && !finish && !state.text) return
  speechAttempt++
  clearSpeechTimer()
  el?.pause()
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
  done(false)
}

/** Read-only snapshot for Safari diagnostic tests. */
export function getSpeechStatus() { return state }

export function useSpeaking() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => void listeners.delete(cb) },
    () => state,
  )
}
