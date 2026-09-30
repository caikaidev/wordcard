import { useEffect, useRef, useState, type RefObject } from 'react'
import { IconRefresh } from './icons'

const TRIGGER = 56 // 指示器下移超过这个距离（手指约 110px）松手就刷新
const MAX = 96

/**
 * 手机端下拉刷新：只在内容区滚到顶部、且手指主要向下移动时生效。
 * 以 App 方式（添加到主屏幕）打开时浏览器没有自带下拉刷新，这里补上。
 */
export function usePullToRefresh(
  scroller: RefObject<HTMLElement | null>,
  onRefresh: () => Promise<void>,
  enabled: boolean,
) {
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const busy = useRef(false)
  const cb = useRef(onRefresh)
  cb.current = onRefresh

  useEffect(() => {
    const el = scroller.current
    if (!el || !enabled) return
    let startX = 0
    let startY = 0
    let tracking = false
    let active = false
    let dist = 0

    const onStart = (e: TouchEvent) => {
      if (busy.current || el.scrollTop > 0 || e.touches.length !== 1) return
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
      tracking = true
      active = false
      dist = 0
    }
    const onMove = (e: TouchEvent) => {
      if (!tracking) return
      const dx = e.touches[0].clientX - startX
      const dy = e.touches[0].clientY - startY
      if (!active) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return
        // 横向滑动（比如词库左滑）或往上滑：不接管
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy) || el.scrollTop > 0) {
          tracking = false
          return
        }
        active = true
      }
      e.preventDefault()
      dist = Math.min(MAX, dy * 0.5) // 阻尼，拉起来更有“弹性”
      setPull(dist)
    }
    const onEnd = async () => {
      if (!tracking) return
      tracking = false
      if (!active) return
      if (dist >= TRIGGER) {
        busy.current = true
        setRefreshing(true)
        setPull(TRIGGER)
        const minDelay = new Promise((r) => setTimeout(r, 500))
        try {
          await Promise.all([cb.current(), minDelay])
        } finally {
          busy.current = false
          setRefreshing(false)
          setPull(0)
        }
      } else {
        setPull(0)
      }
    }

    el.addEventListener('touchstart', onStart, { passive: true })
    el.addEventListener('touchmove', onMove, { passive: false })
    el.addEventListener('touchend', onEnd)
    el.addEventListener('touchcancel', onEnd)
    return () => {
      el.removeEventListener('touchstart', onStart)
      el.removeEventListener('touchmove', onMove)
      el.removeEventListener('touchend', onEnd)
      el.removeEventListener('touchcancel', onEnd)
    }
  }, [scroller, enabled])

  return { pull, refreshing, ready: pull >= TRIGGER }
}

export function PullIndicator({ pull, refreshing, ready }: { pull: number; refreshing: boolean; ready: boolean }) {
  if (!pull && !refreshing) return null
  const progress = Math.min(pull / TRIGGER, 1)
  return (
    <div
      aria-live="polite"
      aria-label={refreshing ? '正在刷新' : ready ? '松手刷新' : '下拉刷新'}
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center md:hidden"
      style={{ transform: `translateY(${Math.max(pull - 44, 4)}px)`, transition: pull === 0 ? 'transform 0.2s' : undefined }}
    >
      <div
        className={`flex h-9 w-9 items-center justify-center rounded-full border border-line-soft bg-surface shadow-card ${
          ready || refreshing ? 'text-accent' : 'text-muted'
        }`}
        style={{ opacity: Math.max(progress, refreshing ? 1 : 0.2) }}
      >
        <IconRefresh
          size={18}
          className={refreshing ? 'animate-spin' : ''}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
      </div>
    </div>
  )
}

/** 线上有新版本（入口脚本的 hash 变了）就返回 true */
export async function hasNewVersion() {
  try {
    const html = await (await fetch('/', { cache: 'no-store', credentials: 'same-origin' })).text()
    const latest = /\/assets\/index-[\w-]+\.js/.exec(html)?.[0]
    const current = [...document.scripts].map((s) => s.src).find((s) => s.includes('/assets/index-'))
    return !!latest && !!current && !current.endsWith(latest)
  } catch {
    return false
  }
}
