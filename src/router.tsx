import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react'

export type Path = '/' | '/add' | '/library' | '/remix' | '/settings' | '/practice' | `/practice/${number}` | `/practice/${number}/read`

const subscribe = (cb: () => void) => {
  window.addEventListener('popstate', cb)
  return () => window.removeEventListener('popstate', cb)
}

export function usePath(): Path {
  const p = useSyncExternalStore(subscribe, () => window.location.pathname)
  if (/^\/practice\/\d+(\/read)?$/.test(p)) return p as Path
  return (['/', '/add', '/library', '/remix', '/settings', '/practice'] as const).find((x) => x === p) ?? '/'
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
