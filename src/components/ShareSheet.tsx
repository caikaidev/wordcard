import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api'
import type { ShareData } from '../../shared/practice'
import { CARD_STYLES, drawCard, loadCardFonts, type CardInput, type CardStyle } from '../share/card'
import { errMsg, toast } from './ui'
import { IconClose, IconDownload, IconRefresh, IconShare } from './icons'

const STYLE_KEY = 'shiju.shareStyle'

/** 打卡分享：生成一张图片卡片，可以系统分享、下载，或长按图片保存 */
export function ShareSheet({ open, onClose, reviewed = 0 }: { open: boolean; onClose: () => void; reviewed?: number }) {
  const [data, setData] = useState<ShareData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [style, setStyle] = useState<CardStyle>(() => {
    try {
      return (localStorage.getItem(STYLE_KEY) as CardStyle) || 'paper'
    } catch {
      return 'paper'
    }
  })
  const [quoteIdx, setQuoteIdx] = useState(0)
  const [image, setImage] = useState<{ url: string; blob: Blob } | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setQuoteIdx(0)
    api.shareData().then(setData).catch((e) => setError(errMsg(e)))
  }, [open])

  useEffect(() => {
    if (!open || !data) return
    let url = ''
    let alive = true
    ;(async () => {
      await loadCardFonts()
      const canvas = (canvasRef.current ??= document.createElement('canvas'))
      drawCard(canvas, cardInput(data, style, quoteIdx, reviewed))
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
      if (!blob || !alive) return
      url = URL.createObjectURL(blob)
      setImage({ url, blob })
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [open, data, style, quoteIdx, reviewed])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const fileName = `shiju-${new Date().toISOString().slice(0, 10)}.png`
  const file = image ? new File([image.blob], fileName, { type: 'image/png' }) : null
  const canShare = !!file && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
  const quotes = data?.quotes.length ?? 0

  const chooseStyle = (s: CardStyle) => {
    setStyle(s)
    try {
      localStorage.setItem(STYLE_KEY, s)
    } catch {
      /* 无痕模式等情况下存不了，无所谓 */
    }
  }

  const share = async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: '拾句 · 今日打卡' })
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('分享没成功，可以先保存图片', 'error')
    }
  }

  // 挂到 body 上，避免被父元素的 transform / overflow 影响定位
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 md:items-center" onClick={onClose} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="分享今日打卡"
        onClick={(e) => e.stopPropagation()}
        className="animate-rise flex max-h-[100dvh] w-full max-w-[440px] flex-col gap-3 rounded-t-3xl bg-bg px-4 pt-3 pb-[max(env(safe-area-inset-bottom),16px)] shadow-card md:rounded-3xl md:pb-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-[15px] font-semibold">分享今日打卡</span>
          <button onClick={onClose} aria-label="关闭" className="flex h-10 w-10 items-center justify-center border-0 bg-transparent text-muted">
            <IconClose size={20} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center">
          {error ? (
            <p className="text-sm text-forgot-fg">{error}</p>
          ) : image ? (
            <img
              src={image.url}
              alt="今日打卡卡片"
              className="max-h-[58dvh] w-auto max-w-full rounded-2xl shadow-card"
              style={{ aspectRatio: '3 / 4' }}
            />
          ) : (
            <div className="aspect-[3/4] h-[58dvh] max-w-full animate-shimmer rounded-2xl bg-surface" />
          )}
        </div>
        <p className="m-0 text-center text-xs text-muted">也可以长按图片保存到相册</p>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 rounded-xl bg-line-soft p-1" role="radiogroup" aria-label="卡片样式">
            {CARD_STYLES.map((s) => (
              <button
                key={s.id}
                role="radio"
                aria-checked={style === s.id}
                onClick={() => chooseStyle(s.id)}
                className={`h-8 flex-1 rounded-lg border-0 text-[13px] ${style === s.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
          {quotes > 1 && (
            <button
              onClick={() => setQuoteIdx((i) => (i + 1) % quotes)}
              className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-[13px] text-ink"
            >
              <IconRefresh size={16} /> 换一句
            </button>
          )}
        </div>

        <div className="flex gap-2.5">
          <a
            href={image?.url}
            download={fileName}
            aria-disabled={!image}
            className={`flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border border-line bg-surface text-[15px] font-medium text-ink no-underline ${image ? '' : 'pointer-events-none opacity-40'}`}
          >
            <IconDownload size={18} /> 保存图片
          </a>
          {canShare && (
            <button
              onClick={share}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg"
            >
              <IconShare size={18} /> 分享
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

function cardInput(d: ShareData, style: CardStyle, quoteIdx: number, reviewed: number): CardInput {
  const s = d.stats
  const practicedToday = s.days.includes(s.today)
  const libSize = d.library.active + d.library.done
  const hero =
    practicedToday || !reviewed
      ? { label: '连续打卡', value: s.streak, unit: '天' }
      : { label: '今日复习', value: reviewed, unit: '张' }
  const facts = [
    `本月打卡 ${s.checkinDays} 天`,
    hero.unit === '天' ? (reviewed ? `今日复习 ${reviewed} 张` : `完成练习 ${s.completed} 次`) : `连续 ${s.streak} 天`,
    `词库 ${libSize} 条`,
  ]
  return {
    style,
    date: new Date(),
    hero,
    facts,
    days: s.days,
    daysInMonth: s.daysInMonth,
    today: s.today,
    quote: d.quotes.length ? d.quotes[quoteIdx % d.quotes.length] : null,
  }
}
