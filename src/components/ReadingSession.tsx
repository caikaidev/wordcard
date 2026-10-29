import { useEffect, useMemo, useRef, useState } from 'react'
import {
  buildComprehension,
  buildGuessItems,
  canRevealAnswer,
  feedbackFor,
  gradeGuess,
  initialGuess,
  stepGuess,
  type GuessItem,
  type GuessProgress,
  type ReadingWord,
} from '../../shared/reading'

export type ReadingMode = 'guess' | 'check' | 'score' | 'browse'

const EMPTY_WORDS: ReadingWord[] = []

export function useReadingLoop(input: {
  ready: boolean
  articleKey: string
  title: string
  summary: string
  text: string
  words?: ReadingWord[]
}) {
  const words = input.words ?? EMPTY_WORDS
  const randRef = useRef<() => number>(Math.random)
  const items = useMemo(() => (input.text ? buildGuessItems(words, input.text, randRef.current) : []), [words, input.text])
  const questions = useMemo(
    () => (input.text ? buildComprehension({ title: input.title, summary: input.summary, text: input.text, words }, randRef.current) : []),
    [input.title, input.summary, input.text, words],
  )
  const signature = input.ready && input.text ? `${input.articleKey}|${words.map((w) => w.word).join('\n')}|${input.text.length}` : ''

  const [mode, setMode] = useState<ReadingMode>('browse')
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<Set<string>>(() => new Set())
  const [progress, setProgress] = useState<GuessProgress>(initialGuess())
  const [wrongPicks, setWrongPicks] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [questionIndex, setQuestionIndex] = useState(0)
  const [picked, setPicked] = useState<string | null>(null)
  const [results, setResults] = useState<boolean[]>([])
  const booted = useRef('')

  useEffect(() => {
    if (!signature) return
    if (booted.current === signature) return
    booted.current = signature
    setMode(items.length ? 'guess' : 'browse')
    setIndex(0)
    setDone(new Set())
    setProgress(initialGuess())
    setWrongPicks([])
    setDraft('')
    setQuestionIndex(0)
    setPicked(null)
    setResults([])
  }, [signature, items.length])

  const revealed = useMemo(() => {
    const set = new Set(done)
    if (progress.revealed && items[index]) set.add(items[index].id)
    return set
  }, [done, progress.revealed, index, items])

  const focus = (id: string) => {
    if (mode !== 'guess') return
    const next = items.findIndex((item) => item.id === id)
    if (next < 0 || next === index) return
    setDone((prev) => {
      const set = new Set(prev)
      if (progress.revealed && items[index]) set.add(items[index].id)
      return set
    })
    setIndex(next)
    setWrongPicks([])
    setDraft('')
    setProgress(done.has(id) ? { wrongs: 0, clue: true, revealed: true, correct: null } : initialGuess())
  }

  const clue = () => setProgress((prev) => stepGuess(prev, { type: 'clue' }))

  const answer = (value: string) => {
    const item = items[index]
    if (!item || progress.revealed) return
    const hit = gradeGuess(value, item)
    setProgress(stepGuess(progress, { type: 'answer', hit }))
    if (!hit) setWrongPicks((prev) => [...prev, value.trim()])
    setDraft('')
  }

  const nextWord = () => {
    const current = items[index]
    if (!current || !progress.revealed) return
    const nextDone = new Set(done)
    nextDone.add(current.id)
    setDone(nextDone)
    const next = items.findIndex((item) => !nextDone.has(item.id))
    if (next < 0) {
      setMode(questions.length ? 'check' : 'score')
      return
    }
    setIndex(next)
    setProgress(initialGuess())
    setWrongPicks([])
    setDraft('')
  }

  const pick = (value: string) => {
    const question = questions[questionIndex]
    if (!question || picked) return
    setPicked(value)
    setResults((prev) => [...prev, feedbackFor(question, value).correct])
  }

  const continueCheck = () => {
    if (questionIndex + 1 >= questions.length) setMode('score')
    else {
      setQuestionIndex((n) => n + 1)
      setPicked(null)
    }
  }

  const startCheck = () => {
    if (!questions.length) return
    setQuestionIndex(0)
    setPicked(null)
    setResults([])
    setMode('check')
  }

  const question = questions[questionIndex] ?? null
  const evidence = mode === 'check' && picked && question && results[questionIndex] === false ? question.evidence : null

  return {
    mode,
    items,
    questions,
    index,
    progress,
    wrongPicks,
    draft,
    setDraft,
    questionIndex,
    question,
    picked,
    results,
    revealed,
    showClues: mode === 'guess' && progress.clue,
    activeId: mode === 'guess' ? (items[index]?.id ?? null) : null,
    evidence,
    focus,
    clue,
    answer,
    nextWord,
    pick,
    continueCheck,
    startCheck,
    correctCount: results.filter(Boolean).length,
  }
}

export function ReadingDock({
  loop,
  hidden,
  showBrowse,
  wordSaved,
  saving,
  onSave,
  onDone,
}: {
  loop: ReturnType<typeof useReadingLoop>
  hidden: boolean
  showBrowse: boolean
  wordSaved: boolean
  saving: boolean
  onSave: () => void
  onDone: () => void
}) {
  if (hidden) return null
  if (loop.mode === 'browse' && !showBrowse) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 flex justify-center px-3 pb-[max(env(safe-area-inset-bottom),12px)]">
      <div className="max-h-[58vh] w-full max-w-[560px] overflow-y-auto rounded-t-2xl border border-line-soft bg-bg px-4 pt-3.5 pb-3 shadow-card">
        <DockBody loop={loop} wordSaved={wordSaved} saving={saving} onSave={onSave} onDone={onDone} />
      </div>
    </div>
  )
}

function DockBody({
  loop,
  wordSaved,
  saving,
  onSave,
  onDone,
}: {
  loop: ReturnType<typeof useReadingLoop>
  wordSaved: boolean
  saving: boolean
  onSave: () => void
  onDone: () => void
}) {
  switch (loop.mode) {
    case 'guess':
      return <GuessDock loop={loop} wordSaved={wordSaved} saving={saving} onSave={onSave} />
    case 'check':
      return <CheckDock loop={loop} />
    case 'score':
      return <ScoreDock loop={loop} onDone={onDone} />
    case 'browse':
      return <BrowseDock loop={loop} />
    default: {
      const exhaustive: never = loop.mode
      return exhaustive
    }
  }
}

function GuessDock({
  loop,
  wordSaved,
  saving,
  onSave,
}: {
  loop: ReturnType<typeof useReadingLoop>
  wordSaved: boolean
  saving: boolean
  onSave: () => void
}) {
  const item = loop.items[loop.index]
  if (!item) return null
  const revealed = canRevealAnswer(loop.progress)
  const last = loop.items.every((it) => it.id === item.id || loop.revealed.has(it.id))
  const nextLabel = last ? (loop.questions.length ? '去做理解检查' : '读完了') : '下一词'
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-semibold">先猜后查 · {loop.index + 1}/{loop.items.length}</h2>
        {!revealed && (
          <button type="button" onClick={loop.clue} className="h-8 rounded-full border border-line bg-transparent px-3 text-xs text-muted">
            {loop.progress.clue ? '线索已打开' : '看线索'}
          </button>
        )}
      </div>
      {revealed ? (
        <Reveal item={item} correct={loop.progress.correct} nextLabel={nextLabel} wordSaved={wordSaved} saving={saving} onSave={onSave} onNext={loop.nextWord} />
      ) : (
        <GuessForm item={item} loop={loop} />
      )}
    </div>
  )
}

function GuessForm({ item, loop }: { item: GuessItem; loop: ReturnType<typeof useReadingLoop> }) {
  return (
    <div>
      <p className="m-0 text-[14px] text-ink">这个空是什么意思？</p>
      {loop.progress.clue && (
        <div className="mt-2 rounded-xl bg-accent-soft px-3 py-2.5" role="status">
          <div className="text-xs font-semibold text-accent">{loop.progress.wrongs > 0 ? '再看这一句，先别看答案' : '线索句'}</div>
          <p className="m-0 mt-1 font-serif text-[15px] leading-relaxed text-ink">{item.masked}</p>
        </div>
      )}
      <div className="mt-2.5 flex flex-col gap-2" role="radiogroup" aria-label="选择词义">
        {item.options.map((option) => {
          const missed = loop.wrongPicks.some((pick) => pick.trim() === option.trim())
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={false}
              disabled={missed}
              onClick={() => loop.answer(option)}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-[14px] ${
                missed ? 'border-line bg-chip text-faint line-through' : 'border-line bg-surface text-ink'
              }`}
            >
              {option}
            </button>
          )
        })}
      </div>
      <form
        className="mt-2.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (loop.draft.trim()) loop.answer(loop.draft)
        }}
      >
        <input
          value={loop.draft}
          onChange={(e) => loop.setDraft(e.target.value)}
          placeholder="或写下单词 / 简短词义"
          aria-label="写下单词或简短词义"
          autoCapitalize="off"
          autoCorrect="off"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none"
        />
        <button type="submit" disabled={!loop.draft.trim()} className="h-11 shrink-0 rounded-xl border-0 bg-invert-bg px-3.5 text-[14px] text-invert-fg disabled:opacity-40">
          提交
        </button>
      </form>
    </div>
  )
}

function Reveal({
  item,
  correct,
  nextLabel,
  wordSaved,
  saving,
  onSave,
  onNext,
}: {
  item: GuessItem
  correct: boolean | null
  nextLabel: string
  wordSaved: boolean
  saving: boolean
  onSave: () => void
  onNext: () => void
}) {
  const title = correct === true ? '猜对了' : correct === false ? '看一下这个词' : item.word
  return (
    <div role="status">
      <div className={`text-[15px] font-semibold ${correct === false ? 'text-forgot-fg' : 'text-accent'}`}>{title}</div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-serif text-[22px] font-medium">{item.word}</span>
        {item.ipa && <span className="font-serif text-sm text-muted italic">{item.ipa}</span>}
      </div>
      <p className="m-0 mt-1 text-[15px]">词义：{item.meaning}</p>
      {item.clues.length > 0 && <p className="m-0 mt-1 text-[13px] text-muted">线索词：{item.clues.join('、')}</p>}
      <MarkedSentence sentence={item.sentence} clues={item.clues} />
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={wordSaved || saving}
          className="h-11 flex-1 rounded-xl border border-line bg-surface text-[14px] font-medium text-ink disabled:opacity-60"
        >
          {wordSaved ? '已加入复习' : saving ? '正在加入…' : '加入复习'}
        </button>
        <button type="button" onClick={onNext} className="h-11 flex-1 rounded-xl border-0 bg-accent text-[14px] font-medium text-on-accent">
          {nextLabel}
        </button>
      </div>
    </div>
  )
}

function MarkedSentence({ sentence, clues }: { sentence: string; clues: string[] }) {
  const marks = new Set(clues.map((clue) => clue.toLowerCase()))
  const parts = sentence.split(/([A-Za-z][A-Za-z'’-]*[A-Za-z]|[A-Za-z])/)
  return (
    <p className="m-0 mt-2 font-serif text-[15px] leading-relaxed text-muted-2">
      {parts.map((part, i) =>
        marks.has(part.toLowerCase()) ? (
          <mark key={i} className="bg-transparent font-medium text-accent">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  )
}

function CheckDock({ loop }: { loop: ReturnType<typeof useReadingLoop> }) {
  const question = loop.question
  if (!question) return null
  const graded = loop.picked !== null
  const fb = graded && loop.picked ? feedbackFor(question, loop.picked) : null
  const correct = fb?.correct === true
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-full bg-chip px-2.5 py-1 text-xs text-ink">{question.kind}</span>
        <span className="text-xs text-muted">
          理解检查 · {loop.questionIndex + 1}/{loop.questions.length}
        </span>
      </div>
      <p className="m-0 text-[15px] leading-relaxed font-medium">{question.question}</p>
      <div className="mt-2.5 flex flex-col gap-2" role="radiogroup" aria-label="理解检查">
        {question.options.map((option) => {
          const isPicked = loop.picked === option
          const isAnswer = graded && option === question.answer
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isPicked}
              disabled={graded}
              onClick={() => loop.pick(option)}
              className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-[14px] leading-snug ${
                isAnswer ? 'border-accent bg-accent-soft text-ink' : isPicked ? 'border-forgot-fg bg-forgot-bg text-ink' : 'border-line bg-surface text-ink'
              }`}
            >
              {option}
            </button>
          )
        })}
      </div>
      {graded && (
        <div role="status" className={`mt-2.5 rounded-xl px-3 py-2.5 text-[13px] leading-relaxed ${correct ? 'bg-accent-soft text-accent' : 'bg-forgot-bg text-ink'}`}>
          <div className="font-semibold">{correct ? '答对了' : '再看原文'}</div>
          {fb && !fb.correct && fb.evidence && (
            <div className="mt-1.5">
              <div className="text-xs font-semibold text-forgot-fg">原文依据</div>
              {fb.evidence.split('\n').map((line, i) => (
                <p key={i} className="m-0 mt-1 font-serif text-[15px] leading-relaxed text-ink">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <button
        type="button"
        onClick={loop.continueCheck}
        disabled={!graded}
        className="mt-3 h-11 w-full rounded-xl border-0 bg-accent text-[14px] font-medium text-on-accent disabled:opacity-40"
      >
        {loop.questionIndex + 1 >= loop.questions.length ? '看阅读成绩' : '下一题'}
      </button>
    </div>
  )
}

function ScoreDock({ loop, onDone }: { loop: ReturnType<typeof useReadingLoop>; onDone: () => void }) {
  const total = loop.results.length
  return (
    <div>
      <h2 className="m-0 text-[15px] font-semibold">这篇读完了</h2>
      {total > 0 ? (
        <p className="m-0 mt-2 font-serif text-[28px] leading-tight">阅读 {loop.correctCount}/{total}</p>
      ) : (
        <p className="m-0 mt-2 text-[14px] leading-relaxed text-muted">这篇原文太短，先不做理解检查。</p>
      )}
      <p className="m-0 mt-1.5 text-[13px] leading-relaxed text-muted">写作成绩在输出任务里单独统计，不和阅读分混在一起。</p>
      <button type="button" onClick={onDone} className="mt-3 h-11 w-full rounded-xl border-0 bg-accent text-[14px] font-medium text-on-accent">
        回到练习
      </button>
    </div>
  )
}

function BrowseDock({ loop }: { loop: ReturnType<typeof useReadingLoop> }) {
  if (!loop.questions.length) return null
  return (
    <button type="button" onClick={loop.startCheck} className="h-12 w-full rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg">
      读完了，做理解检查
    </button>
  )
}
