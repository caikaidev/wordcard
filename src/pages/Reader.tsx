import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError } from '../api'
import type { Lesson } from '../../shared/practice'
import { decorateSentence, sameSentence, splitSentences, type DecorToken, type GuessItem } from '../../shared/reading'
import { Link, navigate } from '../router'
import { errMsg, toast } from '../components/ui'
import { IconBack, IconPlusCircle, IconSparkle } from '../components/icons'
import { WordLookupSheet } from '../components/WordLookupSheet'
import { ReadingDock, useReadingLoop } from '../components/ReadingSession'

type Source = { title: string; text: string; url?: string | null }

/**
 * 读原文：目标生词先遮住，先猜后查；猜错给线索句，揭晓只给语境词义和线索词。
 * 读完做理解检查。点其他单词仍可查词典（不花 AI 额度），长按选中短语或句子。
 * 每段末尾可以点「译」看这段中文；难的文章可以打开「对照」整篇显示中文。
 * kind = lesson：练习的原文；kind = saved：稍后学的文章（底部可以直接生成练习）
 */
export default function Reader({ kind, id }: { kind: 'lesson' | 'saved'; id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [lessonStatus, setLessonStatus] = useState<'loading' | 'ready' | 'missing'>(kind === 'lesson' ? 'loading' : 'ready')
  const [source, setSource] = useState<Source | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pick, setPick] = useState<{ text: string; context: string } | null>(null)
  const [selection, setSelection] = useState<{ text: string; context: string } | null>(null)
  const [saved, setSaved] = useState<Set<string>>(new Set())
  // 翻译：zh[i] 是第 i 段的中文；open 是展开的段；peeked 统计“主动看了哪几段”
  const [zh, setZh] = useState<Record<number, string>>({})
  const [open, setOpen] = useState<Set<number>>(new Set())
  const [loading, setLoading] = useState<Set<number>>(new Set())
  const [peeked, setPeeked] = useState<Set<number>>(new Set())
  const [bilingual, setBilingual] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingWord, setSavingWord] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const reported = useRef(false)

  useEffect(() => {
    if (kind !== 'lesson') return
    api
      .lesson(id)
      .then((r) => {
        setLesson(r.lesson)
        setLessonStatus('ready')
      })
      .catch(() => setLessonStatus('missing'))
  }, [kind, id])

  useEffect(() => {
    ;(kind === 'lesson' ? api.lessonSource(id) : api.savedSource(id)).then(setSource).catch((e) => setError(errMsg(e)))
  }, [kind, id])

  const ready = !!source && lessonStatus !== 'loading'
  const loop = useReadingLoop({
    ready,
    articleKey: `${kind}-${id}`,
    title: lesson?.content.title || lesson?.title || source?.title || '',
    summary: lesson?.content.summary ?? '',
    text: source?.text ?? '',
    words: lesson?.content.words,
  })

  // 长按选中一段文字：底部出现“查义 / 收藏”
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
  const paragraphs = useMemo(() => (source ? splitArticle(source.text) : []), [source])
  const translatable = useMemo(() => paragraphs.map((p) => p.join(' ').split(/\s+/).length >= 4), [paragraphs])
  const total = translatable.filter(Boolean).length

  /** 翻译一批段落（已有的跳过），失败时提示 */
  const fetchZh = useCallback(
    async (idx: number[]) => {
      const need = idx.filter((i) => zh[i] === undefined && !loading.has(i))
      if (!need.length) return true
      setLoading((s) => new Set([...s, ...need]))
      try {
        const r = await api.translate(need.map((i) => paragraphs[i].join(' ')))
        setZh((m) => ({ ...m, ...Object.fromEntries(need.map((i, k) => [i, r.translations[k] ?? ''])) }))
        return true
      } catch (e) {
        toast(errMsg(e), 'error')
        return false
      } finally {
        setLoading((s) => new Set([...s].filter((i) => !need.includes(i))))
      }
    },
    [zh, loading, paragraphs],
  )

  const toggleZh = useCallback(
    async (i: number) => {
      if (open.has(i)) return setOpen((s) => new Set([...s].filter((x) => x !== i)))
      setPeeked((s) => new Set(s).add(i))
      if (await fetchZh([i])) setOpen((s) => new Set(s).add(i))
    },
    [open, fetchZh],
  )

  // 对照模式：整篇按 20 段一批翻译，边翻边显示
  // 对照模式：从当前屏幕上的段落开始，8 段一批、同时跑 3 批，先出现在眼前的先翻好
  const toggleBilingual = async () => {
    if (bilingual) return setBilingual(false)
    setBilingual(true)
    const nodes = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-p]') ?? [])]
    const first = Math.max(0, nodes.findIndex((n) => n.getBoundingClientRect().bottom > 60))
    const order = [...paragraphs.keys()].filter((i) => translatable[i] && zh[i] === undefined)
    const sorted = [...order.filter((i) => i >= first), ...order.filter((i) => i < first)]
    const batches: number[][] = []
    for (let k = 0; k < sorted.length; k += 8) batches.push(sorted.slice(k, k + 8))
    let next = 0
    let failed = false
    const worker = async () => {
      while (!failed && next < batches.length) if (!(await fetchZh(batches[next++]))) failed = true
    }
    await Promise.all([worker(), worker(), worker()])
  }

  const onTap = (e: React.MouseEvent) => {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    const t = e.target as HTMLElement
    const blank = t.dataset.blank
    if (blank) {
      loop.focus(blank)
      return
    }
    const word = t.dataset.w
    if (!word) return
    setPick({ text: word, context: sentenceOf(t) })
  }

  const saveCurrent = async () => {
    const item = loop.items[loop.index]
    if (!item || savingWord || !loop.progress.revealed) return
    setSavingWord(true)
    try {
      await api.create(/\s/.test(item.word) ? 'sentence' : 'word', item.word, {
        ipa: item.ipa,
        pos: '',
        meaning: item.meaning,
        example: item.sentence,
        exampleZh: '',
        highlight: item.word,
        phrases: [],
      })
      toast(`已加入复习：${item.word}`)
      setSaved((s) => new Set(s).add(item.word.toLowerCase()))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        toast('已经在词库里了')
        setSaved((s) => new Set(s).add(item.word.toLowerCase()))
      } else toast(errMsg(e), 'error')
    } finally {
      setSavingWord(false)
    }
  }

  useEffect(() => {
    const el = bodyRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [loop.activeId, loop.showClues, loop.evidence])

  useEffect(() => {
    if (kind !== 'lesson' || loop.mode !== 'score' || reported.current || loop.results.length < 1) return
    reported.current = true
    api.saveReading(id, { correct: loop.correctCount, total: loop.results.length }).catch(() => {
      toast('阅读成绩没保存上，这次仍显示在本页', 'error')
    })
  }, [kind, id, loop.mode, loop.correctCount, loop.results.length])

  const createLesson = async () => {
    if (creating) return
    setCreating(true)
    try {
      const r = await api.createLesson({ savedId: id })
      navigate(`/practice/${r.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
      setCreating(false)
    }
  }

  const title = lesson?.title || source?.title
  const link = lesson?.source_url ?? source?.url
  const savedBar = kind === 'saved' && loop.mode === 'browse' && !selection && !pick
  const dockVisible = !selection && !pick && !(kind === 'saved' && loop.mode === 'browse') && (loop.mode !== 'browse' || loop.questions.length > 0)
  const bottomPad = dockVisible || savedBar ? 'pb-80' : 'pb-28'

  return (
    <div className={`pt-safe flex flex-1 flex-col md:pt-8 ${bottomPad}`}>
      <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-bg/95 px-2 pr-4 backdrop-blur md:px-6">
        <Link
          to={kind === 'lesson' ? `/practice/${id}` : '/practice'}
          aria-label="返回"
          className="flex h-11 w-11 items-center justify-center text-ink md:-ml-3"
        >
          <IconBack size={22} />
        </Link>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">
          {loop.mode === 'guess'
            ? '生词先遮住 · 猜错给线索句'
            : loop.mode === 'check'
              ? '读完理解检查'
              : loop.mode === 'score'
                ? '阅读和写作成绩分开记'
                : peeked.size > 0
                  ? `看了 ${peeked.size} / ${total} 段翻译`
                  : '点单词查义 · 长按选中短语'}
        </span>
        {source && total > 0 && (
          <button
            role="switch"
            aria-checked={bilingual}
            onClick={toggleBilingual}
            className={`flex h-8 items-center rounded-full border px-3 text-xs font-medium ${
              bilingual ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted-2'
            }`}
          >
            中英对照
          </button>
        )}
      </div>

      <article className="px-5 md:px-6">
        {error ? (
          <p className="text-sm leading-relaxed text-forgot-fg">{error}</p>
        ) : !source || (kind === 'lesson' && lessonStatus === 'loading') ? (
          <div className="mt-2 flex flex-col gap-3">
            <div className="h-8 w-3/4 animate-shimmer rounded-lg bg-surface" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-24 animate-shimmer rounded-lg bg-surface" />
            ))}
          </div>
        ) : (
          <>
            <h1 className="m-0 mt-1 font-serif text-[26px] leading-tight font-medium tracking-tight">{title}</h1>
            {link && (
              <a href={link} target="_blank" rel="noreferrer" className="mt-1.5 block truncate text-xs text-accent">
                {link}
              </a>
            )}
            <div ref={bodyRef} onClick={onTap} className="mt-5 font-serif text-[18px] leading-[1.75] text-ink">
              {paragraphs.map((p, i) => (
                <Paragraph
                  key={i}
                  idx={i}
                  sentences={p}
                  marked={marked}
                  saved={saved}
                  canTranslate={translatable[i]}
                  zh={bilingual || open.has(i) ? zh[i] : undefined}
                  showZh={bilingual || open.has(i)}
                  zhOpen={open.has(i)}
                  loading={loading.has(i)}
                  onToggleZh={toggleZh}
                  loop={
                    loop.mode === 'guess' || loop.evidence
                      ? {
                          items: loop.mode === 'guess' ? loop.items : [],
                          revealed: loop.revealed,
                          activeId: loop.activeId,
                          showClues: loop.showClues,
                          evidence: loop.evidence,
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          </>
        )}
      </article>

      {kind === 'saved' && source && loop.mode === 'browse' && !selection && !pick && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-bg via-bg/90 to-transparent px-4 pt-6 pb-[max(env(safe-area-inset-bottom),16px)]">
          <div className="flex w-full max-w-[560px] flex-col gap-2">
            {loop.questions.length > 0 && (
              <button
                onClick={loop.startCheck}
                className="flex h-12 items-center justify-center rounded-[14px] border border-line bg-surface text-[15px] font-medium text-ink"
              >
                读完了，做理解检查
              </button>
            )}
            <button
              onClick={createLesson}
              disabled={creating}
              className="flex h-12 items-center justify-center gap-2 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-60"
            >
              {creating ? <span className="animate-shimmer">正在生成练习…</span> : <><IconSparkle size={18} /> 读完了，生成练习</>}
            </button>
          </div>
        </div>
      )}
      <ReadingDock
        loop={loop}
        hidden={!!selection || !!pick || (kind === 'saved' && loop.mode === 'browse')}
        showBrowse={kind === 'lesson' && loop.questions.length > 0}
        wordSaved={!!loop.items[loop.index] && saved.has(loop.items[loop.index].word.toLowerCase())}
        saving={savingWord}
        onSave={saveCurrent}
        onDone={() => navigate(kind === 'lesson' ? `/practice/${id}` : '/practice')}
      />

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
        <WordLookupSheet
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
    .map((p) => splitSentences(p))
}

function Token({ tok, marked, saved }: { tok: DecorToken; marked: Set<string>; saved: Set<string> }) {
  if (tok.blankId) {
    return (
      <span
        data-blank={tok.blankId}
        role="button"
        tabIndex={0}
        aria-label="待猜的词"
        className={`mx-0.5 inline-block min-w-[2.5em] cursor-pointer border-b-2 align-baseline ${tok.active ? 'border-accent' : 'border-muted/70'}`}
      >
        {'\u00a0'}
      </span>
    )
  }
  if (!tok.lookup) return <>{tok.text}</>
  const key = tok.lookup.toLowerCase()
  const cls = [
    saved.has(key)
      ? 'underline decoration-accent decoration-2 underline-offset-4'
      : marked.has(key)
        ? 'underline decoration-accent/60 decoration-dotted decoration-2 underline-offset-4'
        : '',
    tok.clue ? 'rounded-sm bg-accent-soft font-medium text-accent' : '',
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <span data-w={tok.lookup} className={`cursor-pointer rounded-[3px] active:bg-accent-soft ${cls}`}>
      {tok.text}
    </span>
  )
}

/** 点到的词所在的整句 */
function sentenceOf(node: Node): string {
  const el = (node instanceof HTMLElement ? node : node.parentElement)?.closest('[data-s]')
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim()
}

const Paragraph = memo(function Paragraph({
  idx,
  sentences,
  marked,
  saved,
  canTranslate,
  zh,
  showZh,
  zhOpen,
  loading,
  onToggleZh,
  loop,
}: {
  idx: number
  sentences: string[]
  marked: Set<string>
  saved: Set<string>
  canTranslate: boolean
  zh?: string
  showZh: boolean
  zhOpen: boolean
  loading: boolean
  onToggleZh: (i: number) => void
  loop?: { items: GuessItem[]; revealed: ReadonlySet<string>; activeId: string | null; showClues: boolean; evidence: string | null }
}) {
  return (
    <div className="mb-5" data-p={idx}>
      <p className="m-0">
        {sentences.map((s, i) => {
          const active = !!loop?.activeId && loop.items.some((item) => item.id === loop.activeId && sameSentence(item.sentence, s))
          const cited = !!loop?.evidence && loop.evidence.split('\n').some((line) => sameSentence(line, s))
          const tokens = loop ? decorateSentence(s, loop.items, loop.revealed, loop.activeId, loop.showClues) : null
          return (
          <span
            key={i}
            data-s=""
            data-active={active ? 'true' : undefined}
            className={
              active && loop?.showClues
                ? 'scroll-mt-16 rounded-md bg-accent-soft/80'
                : cited
                  ? 'scroll-mt-16 rounded-md bg-forgot-bg/80'
                  : active
                    ? 'scroll-mt-16'
                    : undefined
            }
          >
            {tokens
              ? tokens.map((tok, j) => <Token key={j} tok={tok} marked={marked} saved={saved} />)
              : s.split(/([A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z])/).map((tok, j) => {
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
          )
        })}
        {canTranslate && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleZh(idx)
            }}
            aria-label={zhOpen ? '收起翻译' : '看这段翻译'}
            aria-expanded={zhOpen}
            className={`ml-1.5 inline-flex h-6 items-center rounded-md border-0 px-1.5 align-[2px] font-sans text-[11px] font-medium ${
              zhOpen ? 'bg-accent-soft text-accent' : 'bg-chip text-muted'
            } ${loading ? 'animate-shimmer' : ''}`}
          >
            译
          </button>
        )}
      </p>
      {showZh && canTranslate && (
        <p className={`m-0 mt-1.5 font-sans text-[14px] leading-relaxed ${zhOpen ? 'text-muted-2' : 'text-muted'}`}>
          {zh ?? <span className="inline-block h-4 w-2/3 animate-shimmer rounded bg-surface align-middle" />}
        </p>
      )}
    </div>
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

