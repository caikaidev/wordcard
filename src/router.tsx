import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'
import { coldStartPath } from '../shared/retention'

/** 冷启动（地址栏打开 /）落在练习。同一标签里刷新复习页、或点底部「复习」不再改道。 */
function applyColdStart() {
  let seen = false
  try {
    seen = sessionStorage.getItem('shiju:cold-start') === '1'
    if (!seen) sessionStorage.setItem('shiju:cold-start', '1')
  } catch {
    seen = false
  }
  if (seen) return
  let navType = 'navigate'
  try {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (nav?.type) navType = nav.type
  } catch {
    /* 当作一次新的打开 */
  }
  const next = coldStartPath(window.location.pathname, navType)
  if (next && window.location.pathname !== next) window.history.replaceState(null, '', next)
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
