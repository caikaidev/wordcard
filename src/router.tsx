import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { coldStartPath } from '../shared/retention'

/**
 * 裸 `/` 的整页打开（含硬刷新）改到练习。同步改 history，React 第一次读地址时已经是练习页。
 * 不记「本会话改过一次」：那个标记撑过硬刷新，第二次、第三次刷新会直接跳过。
 * 应用内 pushState（底部「复习」）不会重跑这里。`/?review=1` 留在复习。
 */
function applyColdStart() {
  let navType = 'navigate'
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type) navType = nav.type
  } catch {
    /* 当作一次新的打开 */
  }
  const next = coldStartPath(window.location.pathname, navType, window.location.search, window.location.hash)
  if (!next) return
  window.history.replaceState(null, '', next)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

applyColdStart()

export type Path = '/' | '/add' | '/library' | '/remix' | '/weekly' | '/settings' | '/discover' | '/level' | '/practice' | `/practice/${number}` | `/practice/${number}/read` | `/practice/${number}/path` | `/practice/saved/${number}` | `/practice/passage/${string}`

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export function usePath(): Path {
  const p = useSyncExternalStore(subscribe, () => window.location.pathname)
  if (/^\/practice\/(\d+(\/read|\/path)?|saved\/\d+)$/.test(p)) return p as Path
  if (/^\/practice\/passage\/[a-z0-9-]+$/.test(p)) return p as Path
  return (['/', '/add', '/library', '/remix', '/weekly', '/settings', '/discover', '/level', '/practice'] as const).find((x) => x === p) ?? '/'
}

export function navigate(to: Path) {
  if (window.location.pathname === to) return
  window.history.pushState(null, '', to)
  window.dispatchEvent(new PopStateEvent('popstate'))
  window.scrollTo(0, 0)
}

export function Link({ to, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { to: Path }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e)
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        navigate(to)
      }}
      {...rest}
    />
  )
}

/** /practice/123 → 123 */
export const lessonIdOf = (p: Path) => {
  const m = /^\/practice\/(\d+)$/.exec(p)
  return m ? Number(m[1]) : null
}

/** /practice/123/read → 123 */
export const readerIdOf = (p: Path) => {
  const m = /^\/practice\/(\d+)\/read$/.exec(p)
  return m ? Number(m[1]) : null
}

/** /practice/123/path → 123 */
export const pathIdOf = (p: Path) => {
  const m = /^\/practice\/(\d+)\/path$/.exec(p)
  return m ? Number(m[1]) : null
}

/** /practice/passage/p3000-1 → p3000-1；锁文不在这里拼出来 */
export const passageIdOf = (p: Path) => {
  const m = /^\/practice\/passage\/([a-z0-9-]+)$/.exec(p)
  return m ? m[1] : null
}

export const passagePath = (id: string): Path => `/practice/passage/${id}`

/** /practice/saved/123 → 123 */
export const savedIdOf = (p: Path) => {
  const m = /^\/practice\/saved\/(\d+)$/.exec(p)
  return m ? Number(m[1]) : null
}
