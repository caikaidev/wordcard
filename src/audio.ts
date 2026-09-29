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

function audio() {
  if (!el) {
    el = new Audio()
    el.preload = 'auto'
    el.addEventListener('playing', () => set({ ...state, loading: false }))
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

/** 播放一段文本；返回的 Promise 在播放结束（或被打断）时 resolve */
export function speak(text: string, slow = false): Promise<boolean> {
  const a = audio()
  if (finish) done(false)
  set({ text, loading: true })
  a.src = ttsUrl(text, slow)
  return new Promise<boolean>((resolve) => {
    finish = resolve
    a.play().catch(() => done(false))
  })
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
