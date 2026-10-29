import { useEffect, useState } from 'react'
import { matchingSenseIndex } from '../../shared/retention'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../api'
import { reportAiFailure } from './AiFailureDialog'
import { stashOpenAiDraft } from '../openai-retry'
import { refreshStats } from '../store'
import { EnglishDefinition, MerriamWebsterLogo, SpeakButton, errMsg, toast } from './ui'
import { IconCheck, IconClose, IconPlusCircle } from './icons'
import type { ReactNode } from 'react'

/* ---------------------------- 查词与收藏 ---------------------------- */

export function WordLookupSheet({
  text,
  context,
  onClose,
  onSaved,
  senseHint,
  contextGloss,
}: {
  text: string
  context: string
  onClose: () => void
  onSaved?: (t: string) => void
  /** 有这句的语境提示时，高亮对得上的那条英英义项 */
  senseHint?: string
  contextGloss?: string
}) {
  const isPhrase = /\s/.test(text.trim())
  const [dict, setDict] = useState<{ source: string; senses: { pos: string; def: string }[] } | null>(null)
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'exists'>('idle')
  const [card, setCard] = useState<{ text: string; meaning: string; pos: string; ipa: string } | null>(null)

  useEffect(() => {
    if (text.split(/\s+/).length > 4) return setDict({ source: '', senses: [] })
    api
      .lookup(text)
      .then(setDict)
      .catch(() => setDict({ source: '', senses: [] }))
  }, [text])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (state !== 'idle') return
    setState('saving')
    try {
      // 整句收藏时按句子处理；单词、短语让 AI 判断
      const r = await api.enrich(text, text.split(/\s+/).length > 8 ? 'sentence' : undefined, context && context !== text ? context : undefined)
      setCard({ text: r.text, meaning: r.meta.meaning, pos: r.meta.pos, ipa: r.meta.ipa })
      try {
        await api.create(r.type, r.text, r.meta)
        setState('saved')
        toast(`已加入复习：${r.text}`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) setState('exists')
        else throw e
      }
      onSaved?.(text)
      refreshStats()
    } catch (e) {
      setState('idle')
      if (!reportAiFailure(e, () => { void save() }, () => stashOpenAiDraft({ kind: 'lookup' }))) toast(errMsg(e), 'error')
    }
  }

  const mw = dict?.source.startsWith('Merriam')

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center" onClick={(e) => { e.stopPropagation(); onClose() }} onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()} onTouchEnd={(e) => e.stopPropagation()} onTouchCancel={(e) => e.stopPropagation()} role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`查词：${text}`}
        onClick={(e) => e.stopPropagation()}
        className="animate-rise flex max-h-[80dvh] w-full max-w-[560px] flex-col gap-3 overflow-y-auto rounded-t-3xl bg-bg px-5 pt-4 pb-[max(env(safe-area-inset-bottom),18px)] shadow-card md:rounded-3xl md:pb-5"
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className={`font-serif font-medium break-words ${isPhrase ? 'text-[20px] leading-snug' : 'text-[26px] leading-tight'}`}>
              {card?.text ?? text}
            </div>
            {card && (card.ipa || card.pos) && (
              <div className="mt-0.5 font-serif text-sm text-muted italic">
                {[card.pos, card.ipa].filter(Boolean).join('  ')}
              </div>
            )}
          </div>
          {!isPhrase && <SpeakButton text={text} size={40} />}
          <button onClick={onClose} aria-label="关闭" className="flex h-10 w-10 items-center justify-center border-0 bg-transparent text-muted">
            <IconClose size={20} />
          </button>
        </div>

        {card?.meaning && <div className="text-[15px] leading-relaxed font-medium">{card.meaning}</div>}

        {context && context !== text && (
          <div className="rounded-xl bg-chip px-3.5 py-2.5 font-serif text-[15px] leading-relaxed text-muted-2">
            <HighlightIn text={context} mark={text} />
          </div>
        )}

        {!card && (
          <div className="flex flex-col gap-1.5">
            {contextGloss && <p className="m-0 text-[15px] leading-relaxed font-medium">本句里：{contextGloss}</p>}
            {!dict ? (
              <div className="h-16 animate-shimmer rounded-xl bg-surface" />
            ) : dict.senses.length ? (
              <>
                <SenseList senses={dict.senses.slice(0, 4)} hint={senseHint} />
                <div className="flex items-center justify-between gap-2 text-[11px] text-faint">
                  <span>{dict.source}</span>
                  {mw && <MerriamWebsterLogo size={50} />}
                </div>
              </>
            ) : (
              <p className="m-0 text-[13px] text-muted">词典里没有现成的释义。加入复习时，AI 会结合这句话解释。</p>
            )}
          </div>
        )}

        <button
          onClick={save}
          disabled={state !== 'idle'}
          className={`mt-1 flex h-12 items-center justify-center gap-2 rounded-[14px] border-0 text-[15px] font-medium ${
            state === 'idle' || state === 'saving' ? 'bg-invert-bg text-invert-fg' : 'bg-accent-soft text-accent'
          }`}
        >
          {state === 'saving' ? (
            <span className="animate-shimmer">AI 结合原句补全中…</span>
          ) : state === 'saved' ? (
            <>
              <IconCheck size={18} /> 已加入复习
            </>
          ) : state === 'exists' ? (
            <>
              <IconCheck size={18} /> 已经在词库里了
            </>
          ) : (
            <>
              <IconPlusCircle size={18} /> 加入复习（例句用这句原文）
            </>
          )}
        </button>
      </div>
    </div>,
    document.body,
  )
}

function SenseList({ senses, hint }: { senses: { pos: string; def: string }[]; hint?: string }) {
  const hit = hint ? matchingSenseIndex(senses, hint) : -1
  return (
    <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
      {senses.map((s, i) => (
        <li key={i} className={`flex gap-2 text-[15px] ${i === hit ? 'rounded-lg bg-accent-soft px-2 py-1.5' : ''}`}>
          <span className="shrink-0 font-serif text-sm text-muted italic">{s.pos || '·'}</span>
          <span className="min-w-0">
            {i === hit && <span className="mb-0.5 block text-[11px] font-medium text-accent">这句里的意思</span>}
            <EnglishDefinition text={s.def} />
          </span>
        </li>
      ))}
    </ol>
  )
}

function HighlightIn({ text, mark }: { text: string; mark: string }) {
  const i = text.toLowerCase().indexOf(mark.toLowerCase())
  if (i < 0) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded bg-accent-soft px-0.5 text-ink">{text.slice(i, i + mark.length)}</mark>
      {text.slice(i + mark.length)}
    </>
  )
}

export type WordMark = 'hard' | 'seen' | false

/** Tokens from an already revealed example are individually queryable; preserve original punctuation and phrase emphasis. */
export function TappableExample({ text, highlight, onLookup, mark }: { text: string; highlight?: string; onLookup: (word: string) => void; mark?: (word: string) => WordMark }) {
  const pieces: ReactNode[] = []
  const markStart = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1
  const markEnd = markStart < 0 ? -1 : markStart + (highlight?.length ?? 0)
  const tokens = /[A-Za-z]+(?:['’-][A-Za-z]+)*/g
  let last = 0
  for (const match of text.matchAll(tokens)) {
    const start = match.index
    const word = match[0]
    pieces.push(text.slice(last, start))
    const emphasized = markStart >= 0 && start >= markStart && start + word.length <= markEnd
    const flagged = mark ? mark(word) : 'hard'
    const line =
      flagged === 'seen'
        ? 'underline decoration-accent decoration-2 underline-offset-4'
        : flagged === 'hard'
          ? 'underline decoration-dotted underline-offset-4 hover:decoration-solid'
          : ''
    pieces.push(
      <button
        key={start}
        type="button"
        aria-label={`查义：${word}`}
        title={`查义：${word}`}
        onClick={(e) => { e.stopPropagation(); onLookup(word) }}
        className={`inline cursor-pointer rounded-sm border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 ${line} ${emphasized ? 'font-semibold text-accent' : ''}`}
        style={{ font: 'inherit' }}
      >{word}</button>,
    )
    last = start + word.length
  }
  pieces.push(text.slice(last))
  return <>{pieces}</>
}
