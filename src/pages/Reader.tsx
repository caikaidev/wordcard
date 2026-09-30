import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../api'
import type { Lesson } from '../../shared/practice'
import { Link } from '../router'
import { refreshStats } from '../store'
import { EnglishDefinition, MerriamWebsterLogo, SpeakButton, errMsg, toast } from '../components/ui'
import { IconBack, IconCheck, IconClose, IconPlusCircle } from '../components/icons'

/** 读原文：点单词查词典（不花 AI 额度），长按选中短语或句子；想记的一键加入复习（AI 结合原句补全） */
export default function Reader({ id }: { id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [source, setSource] = useState<{ title: string; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<{ text: string; context: string } | null>(null)
  const [selection, setSelection] = useState<{ text: string; context: string } | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api.lesson(id).then((r) => setLesson(r.lesson)).catch(() => {})
    api
      .lessonSource(id)
      .then(setSource)
      .catch((e) => setError(errMsg(e)))
  }, [id])

  // 长按选中一段文字：底部出现“加入复习”
  useEffect(() => {
    const onChange = () => {
      const sel = window.getSelection()
      const el = bodyRef.current
      if (!sel || sel.isCollapsed || !el || !sel.anchorNode || !el.contains(sel.anchorNode)) return setSelection(null)
      const text = sel.toString().replace(/\s+/g, ' ').trim()
      if (text.length < 2 || text.length > 160 || !/[A-Za-z]/.test(text)) return setSelection(null)
      setSelection({ text, context: sentenceOf(sel.anchorNode) })
    }
    document.addEventListener('selectionchange', onChange)
    return () => document.removeEventListener('selectionchange', onChange)
  }, [])

  // 这份练习里 AI 挑出来的生词，在原文里标出来
  const marked = useMemo(() => new Set((lesson?.content.words ?? []).map((w) => w.word.toLowerCase().split(/\s+/)[0])), [lesson])

  const onTap = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const t = e.target as HTMLElement
    const word = t.dataset.w
    if (!word) return
    setPick({ text: word, context: sentenceOf(t) })
  }

  const paragraphs = useMemo(() => (source ? splitArticle(source.text) : []), [source])

  return (
    <div className="pt-safe flex flex-1 flex-col pb-24 md:pt-8">
      <div className="flex items-center justify-between px-2 pr-4 md:px-6">
        <Link to={`/practice/${id}`} aria-label="返回练习" className="flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
        <span className="text-xs text-muted">点单词查义 · 长按选中短语</span>
      </div>

      <article className="px-5 md:px-6">
        {error ? (
          <p className="text-sm leading-relaxed text-forgot-fg">{error}</p>
        ) : !source ? (
          <div className="mt-2 flex flex-col gap-3">
            <div className="h-8 w-3/4 animate-shimmer rounded-lg bg-surface" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-shimmer rounded-lg bg-surface" />
            ))}
          </div>
        ) : (
          <>
            <h1 className="m-0 mt-1 font-serif text-[26px] leading-tight font-medium tracking-tight">{lesson?.title || source.title}</h1>
            {lesson?.source_url && (
              <a href={lesson.source_url} target="_blank" rel="noreferrer" className="mt-1.5 block truncate text-xs text-accent">
                {lesson.source_url}
              </a>
            )}
            <div ref={bodyRef} onClick={onTap} className="mt-5 font-serif text-[18px] leading-[1.75] text-ink">
              {paragraphs.map((p, i) => (
                <Paragraph key={i} sentences={p} marked={marked} saved={saved} />
              ))}
            </div>
          </>
        )}
      </article>

      {selection && !pick && (
        <SelectionBar
          text={selection.text}
          onOpen={() => {
            setPick(selection)
            window.getSelection()?.removeAllRanges()
            setSelection(null)
          }}
        />
      )}
      {pick && (
        <WordSheet
          key={pick.text + pick.context}
          text={pick.text}
          context={pick.context}
          onClose={() => setPick(null)}
          onSaved={(t) => setSaved((s) => new Set(s).add(t.toLowerCase()))}
        />
      )}
    </div>
  )
}

/* ---------------------------- 原文排版 ---------------------------- */

/** 段落 → 句子；标题这类没有句号的短行也当一段 */
function splitArticle(text: string): string[][] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(/(?<=[.!?]["”’)]?)\s+(?=["“‘(]?[A-Z0-9])/))
}

/** 点到的词所在的整句 */
function sentenceOf(node: Node): string {
  const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest('[data-s]')
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const Paragraph = memo(function Paragraph({ sentences, marked, saved }: { sentences: string[]; marked: Set<string>; saved: Set<string> }) {
  return (
    <p className="mt-0 mb-5">
      {sentences.map((s, i) => (
        <span key={i} data-s="">
          {s.split(/([A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z])/).map((tok, j) => {
            if (j % 2 === 0) return tok
            const key = tok.toLowerCase()
            const cls = saved.has(key)
              ? 'underline decoration-accent decoration-2 underline-offset-4'
              : marked.has(key)
                ? 'underline decoration-accent/60 decoration-dotted decoration-2 underline-offset-4'
                : ''
            return (
              <span key={j} data-w={tok} className={`cursor-pointer rounded-[3px] active:bg-accent-soft ${cls}`}>
                {tok}
              </span>
            )
          })}
          {i < sentences.length - 1 ? ' ' : ''}
        </span>
      ))}
    </p>
  )
})

/* ---------------------------- 选中文字的操作条 ---------------------------- */

function SelectionBar({ text, onOpen }: { text: string; onOpen: () => void }) {
  return createPortal(
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),16px)]">
      <button
        // 按下时不要让选区消失
        onPointerDown={(e) => e.preventDefault()}
        onClick={onOpen}
        className="animate-rise flex h-12 max-w-[560px] min-w-0 items-center gap-2 rounded-2xl border-0 bg-invert-bg px-4 text-[15px] text-invert-fg shadow-card"
      >
        <IconPlusCircle size={18} className="shrink-0" />
        <span className="shrink-0">查义 / 收藏</span>
        <span className="min-w-0 truncate font-serif opacity-80">“{text}”</span>
      </button>
    </div>,
    document.body,
  )
}

/* ---------------------------- 查词与收藏 ---------------------------- */

function WordSheet({
  text,
  context,
  onClose,
  onSaved,
}: {
  text: string
  context: string
  onClose: () => void
  onSaved: (t: string) => void
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
      onSaved(text)
      refreshStats()
    } catch (e) {
      setState('idle')
      toast(errMsg(e), 'error')
    }
  }

  const mw = dict?.source.startsWith('Merriam')

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 md:items-center" onClick={onClose} role="presentation">
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
            {!dict ? (
              <div className="h-16 animate-shimmer rounded-xl bg-surface" />
            ) : dict.senses.length ? (
              <>
                <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
                  {dict.senses.slice(0, 4).map((s, i) => (
                    <li key={i} className="flex gap-2 text-[15px]">
                      <span className="shrink-0 font-serif text-sm text-muted italic">{s.pos || '·'}</span>
                      <EnglishDefinition text={s.def} />
                    </li>
                  ))}
                </ol>
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
