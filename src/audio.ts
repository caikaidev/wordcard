import { useSyncExternalStore } from 'react'
import { ttsUrl } from './api'

/**
 * 全局只用一个 <audio>：同一时间只播一段，iOS 上连续播放也更稳定。
 * 状态：当前正在加载 / 播放的文本，供按钮显示动画。
 */
type State = { text: string | null; loading: boolean }

let state: State = { text: null, loading: false }
const listeners = new Set<() => void>()
const set = (s: State) => {
  state = s
  listeners.forEach((l) => l())
}

let el: HTMLAudioElement | null = null
let finish: ((ok: boolean) => void) | null = null
let onPlaying: (() => void) | null = null

function audio() {
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
    el.addEventListener('playing', () => {
      set({ ...state, loading: false })
      const f = onPlaying
      onPlaying = null
      f?.()
    })
    el.addEventListener('ended', () => done(true))
    // 云端语音失败（额度用完、网络问题等）→ 改用系统自带朗读
    el.addEventListener('error', () => {
      if (current) fallback(current.text, current.slow)
    })
  }
  return el
}

function done(ok: boolean) {
  current = null
  set({ text: null, loading: false })
  const f = finish
  finish = null
  f?.(ok)
}

/* ---------------------------- 预取 ---------------------------- */
// MeloTTS 首次生成可能需要几秒；卡片出现时预取 R2 / MP3 到本地 blob

const ready = new Map<string, string>() // text -> blob URL
const pending = new Set<string>()
const queue: string[] = []
let running = 0
const MAX_READY = 80

function pump() {
  while (running < 2 && queue.length) {
    const text = queue.shift()!
    running++
    fetch(ttsUrl(text))
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (!b) return
        ready.set(text, URL.createObjectURL(b))
        if (ready.size > MAX_READY) {
          const [oldest, url] = ready.entries().next().value!
          if (oldest !== state.text) {
            URL.revokeObjectURL(url)
            ready.delete(oldest)
          }
        }
      })
      .catch(() => {})
      .finally(() => {
        pending.delete(text)
        running--
        pump()
      })
  }
}

/** 在后台准备这些文本的语音（已准备或正在准备的会跳过） */
export function prefetch(texts: (string | undefined | null)[]) {
  for (const t of texts) {
    const text = t?.trim()
    if (!text || ready.has(text) || pending.has(text)) continue
    pending.add(text)
    queue.push(text)
  }
  pump()
}

/** 只取缓存里现成的语音（不生成、不占额度）；没有的就算了 */
export function prefetchCached(texts: (string | undefined | null)[]) {
  for (const t of texts) {
    const text = t?.trim()
    if (!text || ready.has(text) || pending.has(text)) continue
    pending.add(text)
    fetch(`${ttsUrl(text)}&cached=1`)
      .then((r) => (r.status === 200 ? r.blob() : null))
      .then((b) => {
        if (b) ready.set(text, URL.createObjectURL(b))
      })
      .catch(() => {})
      .finally(() => pending.delete(text))
  }
}

/**
 * 要马上出声的场合（闯关里点单词）：本地已经有云端语音就放它，没有就立刻用系统朗读，不等生成
 */
export function speakFast(text: string) {
  if (ready.has(text.trim()) || !window.speechSynthesis) return speak(text)
  if (finish) done(false)
  el?.pause()
  current = { text, slow: false }
  set({ text, loading: true })
  return new Promise<boolean>((resolve) => {
    finish = resolve
    fallback(text, false, true)
  })
}

/** 播放一段文本；返回的 Promise 在播放结束（或被打断）时 resolve */
/* ---------------------------- 系统朗读兜底 ---------------------------- */

let current: { text: string; slow: boolean } | null = null
let notified = false

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices() ?? []
  return voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en')) ?? null
}

function fallback(text: string, slow: boolean, quiet = false) {
  current = null
  const synth = window.speechSynthesis
  if (!synth) return done(false)
  if (!notified && !quiet) {
    notified = true
    import('./components/ui').then((m) => m.toast('云端语音暂时不可用（可能是今日额度用完），已改用系统朗读'))
  }
  synth.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = slow ? 0.75 : 0.95
  const v = pickVoice()
  if (v) u.voice = v
  u.onstart = () => {
    set({ ...state, loading: false })
    const f = onPlaying
    onPlaying = null
    f?.()
  }
  u.onend = () => done(true)
  u.onerror = () => done(false)
  synth.speak(u)
}

export function speak(text: string, slow = false, playing?: () => void): Promise<boolean> {
  const a = audio()
  if (finish) done(false)
  window.speechSynthesis?.cancel()
  current = { text, slow }
  onPlaying = playing ?? null
  set({ text, loading: true })
  const local = !slow && ready.get(text.trim())
  a.src = local || ttsUrl(text, slow)
  // Cloudflare MeloTTS 没有语速控制参数，同一段 MP3 慢速播放不重复生成。
  a.playbackRate = slow ? 0.75 : 1
  a.preservesPitch = true
  const p = new Promise<boolean>((resolve) => {
    finish = resolve
    a.play().catch((e: DOMException) => {
      // 被浏览器拦截自动播放时不兜底；其它失败（加载不了音频）改用系统朗读
      if (e?.name === 'NotAllowedError') done(false)
      else if (current) fallback(current.text, current.slow)
    })
  })
  // 直接从网络播的，播完顺手存进本地缓存，下次（包括重新打开 App 后）秒播
  if (!local && !slow) p.then((ok) => ok && prefetch([text]))
  return p
}

export function stop() {
  current = null
  el?.pause()
  window.speechSynthesis?.cancel()
  if (finish || state.text) done(false)
}

export function useSpeaking() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    () => state,
  )
}
