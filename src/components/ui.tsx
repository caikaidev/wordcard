import { useEffect, useState, type ReactNode } from 'react'
import { speak, stop, useSpeaking } from '../audio'
import { IconSpeaker } from './icons'

/** 圆形发音按钮：加载中呼吸、播放中高亮；再点一次停止 */
export function SpeakButton({
  text,
  size = 44,
  variant = 'soft',
  label = '播放发音',
  waves = 2,
}: {
  text: string
  size?: number
  variant?: 'soft' | 'ghost'
  label?: string
  waves?: 1 | 2
}) {
  const s = useSpeaking()
  const active = s.text === text
  const cls =
    variant === 'soft'
      ? `bg-accent-soft text-accent ${active ? 'ring-2 ring-accent/40' : ''}`
      : `bg-transparent ${active ? 'text-accent' : 'text-muted'}`
  return (
    <button
      type="button"
      aria-label={active ? '停止播放' : label}
      onClick={(e) => {
        e.stopPropagation()
        if (active) stop()
        else speak(text)
      }}
      className={`flex shrink-0 items-center justify-center rounded-full border-0 transition ${cls} ${active && s.loading ? 'animate-shimmer' : ''}`}
      style={{ width: size, height: size }}
    >
      <IconSpeaker size={size >= 52 ? 22 : size >= 44 ? 20 : 18} waves={waves} />
    </button>
  )
}

/** 把句子里的目标词高亮成强调色 */
export function Highlighted({ text, marks }: { text: string; marks: string[] }) {
  const list = marks.filter(Boolean).sort((a, b) => b.length - a.length)
  if (!list.length) return <>{text}</>
  const esc = list.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = text.split(new RegExp(`(${esc.join('|')})`, 'g'))
  return (
    <>
      {parts.map((p, i) =>
        list.includes(p) ? (
          <span key={i} className="font-medium text-accent">
            {p}
          </span>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  )
}

export function Chip({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  const cls = 'rounded-full bg-chip px-2.5 py-1 text-xs text-muted'
  return onClick ? (
    <button type="button" onClick={onClick} className={`${cls} border-0`}>
      {children}
    </button>
  ) : (
    <span className={cls}>{children}</span>
  )
}

export function PageTitle({ eyebrow, title, right }: { eyebrow: ReactNode; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div className="flex flex-col gap-1">
        <div className="text-xs tracking-wide text-muted md:text-[13px]">{eyebrow}</div>
        <h1 className="m-0 text-[22px] font-semibold tracking-tight md:text-2xl">{title}</h1>
      </div>
      {right}
    </div>
  )
}

export function Card({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`rounded-[20px] md:rounded-3xl border border-line-soft bg-surface shadow-card ${className}`}>{children}</div>
  )
}

/* ---------------------------- 轻提示 ---------------------------- */

type ToastMsg = { id: number; text: string; tone: 'info' | 'error' }
let toasts: ToastMsg[] = []
const toastListeners = new Set<(t: ToastMsg[]) => void>()

export function toast(text: string, tone: ToastMsg['tone'] = 'info') {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, tone }]
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    toastListeners.forEach((l) => l(toasts))
  }, tone === 'error' ? 4200 : 2200)
}

export function Toaster() {
  const [list, setList] = useState<ToastMsg[]>(toasts)
  useEffect(() => {
    toastListeners.add(setList)
    return () => void toastListeners.delete(setList)
  }, [])
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),16px)] z-50 flex flex-col items-center gap-2 px-4 md:top-20"
    >
      {list.map((t) => (
        <div
          key={t.id}
          className={`animate-rise max-w-[560px] rounded-2xl px-4 py-2.5 text-sm shadow-card ${
            t.tone === 'error' ? 'bg-forgot-bg text-forgot-fg' : 'bg-invert-bg text-invert-fg'
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  )
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}
