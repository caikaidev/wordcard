import { useEffect, useRef, useState } from 'react'
import { api, type PassageDetail } from '../api'
import { completionLines } from '../../shared/retention'
import { Link, navigate, passagePath } from '../router'
import { errMsg, toast } from '../components/ui'
import { IconBack, IconFlame, IconSparkle } from '../components/icons'
import { TappableExample, WordLookupSheet, type WordMark } from '../components/WordLookupSheet'
import { WordPeek } from '../components/WordPeek'

const LOOKED_KEY = 'shiju:passage-looked'
const GUESS_KEY = 'shiju:guess-word'

type Finish = 'reading' | 'filling' | 'done'

function readLooked(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(LOOKED_KEY) || '[]') as unknown
    if (!Array.isArray(raw)) return new Set()
    return new Set(raw.filter((x): x is string => typeof x === 'string').slice(-400))
  } catch {
    return new Set()
  }
}

function writeLooked(words: Set<string>) {
  try {
    localStorage.setItem(LOOKED_KEY, JSON.stringify([...words].slice(-400)))
  } catch {
    /* 存不下就只在这一页划线 */
  }
}

function readGuess(): boolean {
  try {
    return localStorage.getItem(GUESS_KEY) === '1'
  } catch {
    return false
  }
}

const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 分级短文：先读英文。点词先看本句语境，再按需打开词典。读完才解锁下一篇。 */
export default function Passage({ id }: { id: string }) {
  const [passage, setPassage] = useState<PassageDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [phase, setPhase] = useState<Finish>('reading')
  const [justFinished, setJustFinished] = useState(false)
  const [nextId, setNextId] = useState<string | null>(null)
  const [nextTitle, setNextTitle] = useState<string | null>(null)
  const [peek, setPeek] = useState<{ word: string; context: string } | null>(null)
  const [dict, setDict] = useState<{ word: string; context: string } | null>(null)
  const [making, setMaking] = useState(false)
  const [markAll, setMarkAll] = useState(false)
  const [guessFirst, setGuessFirst] = useState(readGuess)
  const [seen, setSeen] = useState<Set<string>>(readLooked)
  const [lookups, setLookups] = useState<Set<string>>(new Set())
  const [streak, setStreak] = useState<number | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    setPassage(null)
    setError(null)
    setPhase('reading')
    setJustFinished(false)
    setNextId(null)
    setNextTitle(null)
    setPeek(null)
    setDict(null)
    setLookups(new Set())
    api
      .passage(id)
      .then((p) => {
        if (!alive.current) return
        setPassage(p)
        setNextId(p.nextId)
        setNextTitle(p.nextTitle)
        if (p.state === 'done') setPhase('done')
      })
      .catch((e) => {
        if (alive.current) setError(errMsg(e))
      })
    api
      .streak()
      .then((s) => {
        if (alive.current) setStreak(s.streak)
      })
      .catch(() => {})
  }, [id])

  const noteLookup = (word: string) => {
    const key = word.toLowerCase()
    setLookups((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setSeen((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      writeLooked(next)
      return next
    })
  }

  const complete = async () => {
    if (!passage || phase !== 'reading') return
    setPhase('filling')
    const started = performance.now()
    try {
      const r = await api.completePassage(passage.id)
      const left = prefersReducedMotion() ? 0 : Math.max(0, 720 - (performance.now() - started))
      if (left) await new Promise((resolve) => setTimeout(resolve, left))
      if (!alive.current) return
      setNextId(r.nextId)
      setNextTitle(r.nextTitle)
      setJustFinished(true)
      setPhase('done')
    } catch (e) {
      if (alive.current) {
        setPhase('reading')
        toast(errMsg(e), 'error')
      }
    }
  }

  const makeLesson = async () => {
    if (!passage || making) return
    setMaking(true)
    try {
      const r = await api.createLesson({ text: passage.text })
      navigate(`/practice/${r.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
      setMaking(false)
    }
  }

  const paragraphs = passage?.text.split(/\n+/) ?? []
  const marks = new Set(passage?.marks ?? [])
  const glossOf = (word: string) => passage?.gloss?.[word.toLowerCase()]
  const markWord = (word: string): WordMark => {
    const key = word.toLowerCase()
    if (seen.has(key)) return 'seen'
    if (markAll || marks.has(key)) return 'hard'
    return false
  }
  const lines =
    passage && phase === 'done'
      ? completionLines(passage.words, justFinished || lookups.size > 0 ? lookups.size : null)
      : []

  return (
    <div className={`pt-safe flex flex-1 flex-col md:pt-8 ${phase === 'reading' ? 'pb-28' : 'pb-[22rem] md:pb-8'}`}>
      <div className="flex items-center px-2 md:px-6">
        <Link to="/practice" aria-label="返回练习" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
      </div>
      {!passage && !error ? (
        <div className="mx-4 mt-4 h-64 animate-shimmer rounded-2xl bg-surface md:mx-6" />
      ) : error ? (
        <div className="mx-4 mt-6 rounded-2xl border border-line-soft bg-surface p-6 text-center md:mx-6">
          <p className="m-0 text-sm leading-relaxed text-muted">{error}</p>
          <Link to="/practice" className="mt-4 inline-flex h-11 items-center rounded-2xl bg-invert-bg px-5 text-sm text-invert-fg no-underline">
            回到练习
          </Link>
        </div>
      ) : passage ? (
        <article className="px-4 md:px-6">
          <div className="flex flex-wrap items-center gap-2 text-[13px] tracking-wide text-muted">
            <span>
              {passage.bandName}档 · 约 {passage.words} 词
            </span>
            <MiniSwitch
              on={markAll}
              label="标全部"
              onClick={() => setMarkAll((v) => !v)}
            />
            <MiniSwitch
              on={guessFirst}
              label="先猜"
              onClick={() =>
                setGuessFirst((v) => {
                  const next = !v
                  try {
                    localStorage.setItem(GUESS_KEY, next ? '1' : '0')
                  } catch {
                    /* 记不住就只对这一下生效 */
                  }
                  return next
                })
              }
            />
          </div>
          <h1 className="m-0 mt-1 font-serif text-[26px] leading-tight font-medium">{passage.title}</h1>
          <div className="mt-4 flex flex-col gap-4 font-serif text-[17px] leading-relaxed text-ink md:text-xl">
            {paragraphs.map((para, i) => (
              <p key={i} className="m-0">
                <TappableExample text={para} mark={markWord} onLookup={(word) => setPeek({ word, context: para })} />
              </p>
            ))}
          </div>
        </article>
      ) : null}

      {passage && (
        <div className="pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-4 pt-3 backdrop-blur md:static md:border-0 md:bg-transparent md:px-6 md:pt-6">
          <div className="mx-auto flex w-full max-w-[640px] flex-col gap-2">
            <FinishBar
              phase={phase}
              lines={lines}
              nextId={nextId}
              nextTitle={nextTitle}
              streak={streak}
              making={making}
              onComplete={complete}
              onLesson={makeLesson}
            />
          </div>
        </div>
      )}

      {peek && !dict && (
        <WordPeek
          key={peek.word + peek.context}
          word={peek.word}
          gloss={glossOf(peek.word)}
          guessFirst={guessFirst}
          onClose={() => setPeek(null)}
          onReveal={() => noteLookup(peek.word)}
          onMore={() => {
            noteLookup(peek.word)
            setDict(peek)
            setPeek(null)
          }}
        />
      )}
      {dict && (
        <WordLookupSheet
          key={dict.word + dict.context}
          text={dict.word}
          context={dict.context}
          senseHint={glossOf(dict.word)?.hint}
          contextGloss={glossOf(dict.word)?.zh}
          onClose={() => setDict(null)}
        />
      )}
    </div>
  )
}

function FinishBar({
  phase,
  lines,
  nextId,
  nextTitle,
  streak,
  making,
  onComplete,
  onLesson,
}: {
  phase: Finish
  lines: string[]
  nextId: string | null
  nextTitle: string | null
  streak: number | null
  making: boolean
  onComplete: () => void
  onLesson: () => void
}) {
  switch (phase) {
    case 'filling':
      return (
        <div role="status" aria-live="polite" className="flex flex-col gap-2 py-1">
          <p className="m-0 text-[15px] font-medium">记下这一篇</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-line">
            <div className="passage-fill-bar h-full rounded-full bg-accent" />
          </div>
        </div>
      )
    case 'done':
      return (
        <div className="flex flex-col gap-2.5" aria-live="polite">
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label="这篇读完的小结">
            {lines.map((line) => (
              <li key={line} className="rounded-full bg-accent-soft px-2.5 py-1 text-[13px] font-medium text-accent">
                {line}
              </li>
            ))}
          </ul>
          <p className="m-0 truncate text-[14px] text-ink">{nextTitle ? `下一篇 · ${nextTitle}` : '这一档的短文都读完了'}</p>
          <p className="m-0 flex items-center gap-1 text-[13px] text-muted">
            <IconFlame size={14} className={streak ? 'text-forgot-fg' : 'text-faint'} />
            连续 {streak ?? '–'} 天
          </p>
          <div className="flex gap-2">
            {nextId ? (
              <button
                type="button"
                onClick={() => navigate(passagePath(nextId))}
                className="h-12 flex-1 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg"
              >
                下一篇
              </button>
            ) : (
              <Link to="/practice" className="flex h-12 flex-1 items-center justify-center rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg no-underline">
                回到练习
              </Link>
            )}
            <button
              type="button"
              onClick={onLesson}
              disabled={making}
              className="flex h-12 items-center justify-center gap-1.5 rounded-[14px] border border-line bg-surface px-4 text-[14px] text-ink disabled:opacity-50"
            >
              <IconSparkle size={16} /> {making ? '正在出练习…' : '出练习'}
            </button>
          </div>
        </div>
      )
    case 'reading':
      return (
        <button
          type="button"
          onClick={onComplete}
          className="h-12 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg"
        >
          读完了
        </button>
      )
    default: {
      const unexpected: never = phase
      return unexpected
    }
  }
}

function MiniSwitch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className={`h-7 rounded-full border px-2.5 text-xs font-medium ${on ? 'border-accent bg-accent-soft text-accent' : 'border-line bg-surface text-muted-2'}`}
    >
      {label}
    </button>
  )
}
