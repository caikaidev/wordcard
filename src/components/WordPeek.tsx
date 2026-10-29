import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'

/**
 * 点词第一下：小浮层，只给本句中文语境义，或先猜再看。
 * 词典在「更多」里，由调用方打开。
 */
export function WordPeek({
  word,
  gloss,
  guessFirst,
  onClose,
  onReveal,
  onMore,
}: {
  word: string
  gloss?: { zh: string; hint: string }
  guessFirst: boolean
  onClose: () => void
  onReveal: () => void
  onMore: () => void
}) {
  const [shown, setShown] = useState(!guessFirst)
  const revealed = useRef(false)
  const onRevealRef = useRef(onReveal)
  onRevealRef.current = onReveal

  const reveal = () => {
    if (!revealed.current) {
      revealed.current = true
      onRevealRef.current()
    }
    setShown(true)
  }

  useEffect(() => {
    if (guessFirst || revealed.current) return
    revealed.current = true
    onRevealRef.current()
    setShown(true)
  }, [guessFirst])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const meaning = gloss?.zh

  return createPortal(
    <div className="fixed inset-x-0 top-0 bottom-[4.75rem] z-40 flex flex-col justify-end md:bottom-0" onClick={onClose} role="presentation">
      <div className="absolute inset-0 bg-black/30" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`语境：${word}`}
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 mx-3 mb-3 max-w-[420px] self-center rounded-2xl border border-line bg-surface p-4 shadow-card"
        style={{ backgroundColor: 'var(--surface)', width: 'min(420px, calc(100% - 1.5rem))' }}
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1 font-serif text-[22px] leading-tight font-medium">{word}</div>
          <button type="button" onClick={onClose} aria-label="关闭" className="flex h-9 w-9 items-center justify-center border-0 bg-transparent text-muted">
            <IconClose size={18} />
          </button>
        </div>
        <p className="m-0 mt-1.5 text-[15px] leading-relaxed">
          {shown ? (meaning ? <>本句里：{meaning}</> : '这句里还没有准备好的中文义。点「更多」看词典。') : '先猜这个词在这句里的意思。'}
        </p>
        <div className="mt-3 flex gap-2">
          {!shown && (
            <button type="button" onClick={reveal} className="h-11 flex-1 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg">
              看意思
            </button>
          )}
          <button
            type="button"
            onClick={onMore}
            className={`h-11 rounded-[14px] text-[15px] font-medium ${shown ? 'flex-1 border-0 bg-invert-bg text-invert-fg' : 'border border-line bg-surface px-4 text-ink'}`}
          >
            更多
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
