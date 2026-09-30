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
    el.addEventListener('error', () => done(false))
  }
  return el
}

function done(ok: boolean) {
  set({ text: null, loading: false })
  const f = finish
  finish = null
  f?.(ok)
}

/* ---------------------------- 预取 ---------------------------- */
// Gemini 生成一段语音要几秒；卡片一出现就在后台把音频下好，点播放时直接用本地 blob

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

/** 播放一段文本；返回的 Promise 在播放结束（或被打断）时 resolve */
export function speak(text: string, slow = false, playing?: () => void): Promise<boolean> {
  const a = audio()
  if (finish) done(false)
  onPlaying = playing ?? null
  set({ text, loading: true })
  const local = !slow && ready.get(text.trim())
  a.src = local || ttsUrl(text, slow)
  const p = new Promise<boolean>((resolve) => {
    finish = resolve
    a.play().catch(() => done(false))
  })
  // 直接从网络播的，播完顺手存进本地缓存，下次（包括重新打开 App 后）秒播
  if (!local && !slow) p.then((ok) => ok && prefetch([text]))
  return p
}

export function stop() {
  el?.pause()
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
