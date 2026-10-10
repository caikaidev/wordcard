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
    <div className="flex items-center justify-between gap-3 pt-1">
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

type ToastMsg = { id: number; text: string; tone: 'info' | 'error' | 'success' }
let toasts: ToastMsg[] = []
const toastListeners = new Set<(t: ToastMsg[]) => void>()

export function toast(text: string, tone: ToastMsg['tone'] = 'info') {
  const id = Date.now() + Math.random()
  toasts = [...toasts, { id, text, tone }]
  toastListeners.forEach((l) => l(toasts))
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== id)
    toastListeners.forEach((l) => l(toasts))
  }, tone === 'error' ? 4200 : tone === 'success' ? 3200 : 2200)
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
      className="pointer-events-none fixed inset-x-0 top-[max(env(safe-area-inset-top),16px)] z-[60] flex flex-col items-center gap-2 px-4 md:top-20"
    >
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={`animate-rise max-w-[560px] rounded-2xl px-4 py-2.5 text-sm shadow-card ${
            t.tone === 'error' ? 'bg-forgot-bg text-forgot-fg' : t.tone === 'success' ? 'bg-accent text-on-accent' : 'bg-invert-bg text-invert-fg'
          }`}
        >
          {t.tone === 'success' && '✓ '}
          {t.text}
        </div>
      ))}
    </div>
  )
}

/* ---------------------------- 确认框 ---------------------------- */

/**
 * 页面内的确认框，代替 window.confirm：
 * 原生弹窗在部分浏览器 / 添加到主屏幕的 App / 内嵌页面里会被直接拦截并返回 false，
 * 表现为「点了删除没有任何反应」。
 */
type ConfirmReq = { id: number; text: string; ok: string; danger: boolean; resolve: (v: boolean) => void }
let confirmReq: ConfirmReq | null = null
const confirmListeners = new Set<(r: ConfirmReq | null) => void>()
const setConfirm = (r: ConfirmReq | null) => {
  confirmReq = r
  confirmListeners.forEach((l) => l(r))
}

export function confirmDialog(text: string, { ok = '确定', danger = false }: { ok?: string; danger?: boolean } = {}) {
  confirmReq?.resolve(false)
  return new Promise<boolean>((resolve) => setConfirm({ id: Date.now(), text, ok, danger, resolve }))
}

export function Confirmer() {
  const [req, setReq] = useState<ConfirmReq | null>(confirmReq)
  useEffect(() => {
    confirmListeners.add(setReq)
    return () => void confirmListeners.delete(setReq)
  }, [])
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [req])
  if (!req) return null
  function close(v: boolean) {
    req!.resolve(v)
    if (confirmReq?.id === req!.id) setConfirm(null)
  }
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/40 md:items-center" onClick={() => close(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={req.text}
        onClick={(e) => e.stopPropagation()}
        className="pb-safe flex w-full max-w-sm animate-rise flex-col gap-4 rounded-t-3xl bg-bg p-5 md:rounded-3xl"
      >
        <div className="text-[15px] leading-relaxed">{req.text}</div>
        <div className="grid grid-cols-2 gap-2.5">
          <button onClick={() => close(false)} className="h-11 rounded-2xl border border-line bg-transparent text-[15px] text-ink">
            取消
          </button>
          <button
            autoFocus
            onClick={() => close(true)}
            className={`h-11 rounded-2xl border-0 text-[15px] font-medium ${req.danger ? 'bg-forgot-bg text-forgot-fg' : 'bg-invert-bg text-invert-fg'}`}
          >
            {req.ok}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ---------------------------- 等待进度 ---------------------------- */

/**
 * AI 生成期间的进度说明：阶段文案 + 已等待秒数 + 进度条；超过 slowAfter 秒说明比平时慢，并告知多久会超时。
 * stages: [从第几秒开始, 文案]，按时间升序
 */
export function WaitProgress({
  stages,
  timeout,
  slowAfter = 15,
  slowText = '比平时慢一点，再等一会儿',
  timeoutHint,
}: {
  stages: [number, string][]
  timeout: number
  slowAfter?: number
  slowText?: string
  timeoutHint?: string
}) {
  const [s, setS] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setS((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const stage = s >= slowAfter ? slowText : ([...stages].reverse().find(([at]) => s >= at)?.[1] ?? stages[0]?.[1] ?? '')
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-[13px] text-muted">
        <span>{stage}</span>
        <span className="tabular shrink-0">已等待 {s} 秒</span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-line-soft">
        <div className="h-1 rounded-full bg-accent transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, (s / timeout) * 100)}%` }} />
      </div>
      {s >= slowAfter && <div className="text-xs text-faint">{timeoutHint ?? `超过 ${timeout} 秒会自动提示超时，到时重试即可`}</div>}
    </div>
  )
}

export function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e)
}

/** 英英释义（词典原文）+ 出处 */
export function EnglishDefinition({ text, source: rawSource, word, className = '' }: { text: string; source?: string; word?: string; className?: string }) {
  if (!text) return null
  // 早期卡片存的是简称，统一显示为产品全称
  const source = rawSource === 'Merriam-Webster' ? "Merriam-Webster's Collegiate® Dictionary" : rawSource
  const href =
    source?.startsWith('Merriam') && word
      ? `https://www.merriam-webster.com/dictionary/${encodeURIComponent(word)}`
      : source === 'Wiktionary' && word
        ? `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`
        : undefined
  return (
    <div className={`font-serif leading-snug text-muted-2 ${className}`}>
      {text}
      {source && (
        <span className="ml-1.5 font-sans text-[11px] text-faint not-italic">
          —{' '}
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="text-faint underline decoration-line underline-offset-2">
              {source}
            </a>
          ) : (
            source
          )}
        </span>
      )}
    </div>
  )
}

const MW_REMOTE = 'https://dictionaryapi.com/images/info/branding-guidelines/'

/**
 * Merriam-Webster 官方标志：按品牌规范原样显示（50 / 100 / 125 px，不改动，保留 ®），
 * 浅色 / 深色背景各用对应版本。文件在构建时从官网下载，失败则回退到官网地址。
 */
export function MerriamWebsterLogo({ size = 50 }: { size?: 50 | 100 | 125 }) {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  const [remote, setRemote] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const file = dark ? 'MWLogo_DarkBG_120x120_2x.png' : 'MWLogo_LightBG_120x120_2x.png'
  const src = remote ? MW_REMOTE + file : dark ? '/mw-logo-darkbg.png' : '/mw-logo-lightbg.png'
  return (
    <a href="https://www.merriam-webster.com/" target="_blank" rel="noreferrer" className="inline-flex shrink-0" aria-label="Merriam-Webster">
      <img src={src} width={size} height={size} alt="Merriam-Webster" onError={() => setRemote(true)} style={{ width: size, height: size }} />
    </a>
  )
}
