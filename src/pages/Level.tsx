import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { BANDS, CEFR_LEVELS, FAKES_PER_TEST, WORDS_PER_BAND, type LevelStatus, type TestResult } from '../../shared/level'
import { Link } from '../router'
import { refreshStats } from '../store'
import { errMsg, toast } from '../components/ui'
import { IconBack, IconCheck } from '../components/icons'

const TOTAL = BANDS.length * WORDS_PER_BAND + FAKES_PER_TEST
const num = (n: number) => n.toLocaleString('zh-CN')
const bandLabel = (b: { from: number; to: number }) => (b.from === 1 ? `前 ${b.to / 1000}k` : `${(b.from - 1) / 1000}k–${b.to / 1000}k`)

type Test = { id: number; words: string[]; idx: number; known: string[] }

/** 词汇评级：认词测试估算词汇量，之后掌握的词继续往上加 */
export default function Level() {
  const [status, setStatus] = useState<LevelStatus | null>(null)
  const [test, setTest] = useState<Test | null>(null)
  const [starting, setStarting] = useState(false)
  const [result, setResult] = useState<TestResult | null>(null)

  const load = () =>
    api
      .level()
      .then(setStatus)
      .catch((e) => toast(errMsg(e), 'error'))
  useEffect(() => {
    load()
  }, [])

  const start = async () => {
    setStarting(true)
    setResult(null)
    try {
      const r = await api.startLevelTest()
      setTest({ ...r, idx: 0, known: [] })
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setStarting(false)
    }
  }

  const answer = async (knows: boolean) => {
    if (!test) return
    const known = knows ? [...test.known, test.words[test.idx]] : test.known
    if (test.idx + 1 < test.words.length) return setTest({ ...test, idx: test.idx + 1, known })
    setTest({ ...test, idx: test.words.length, known })
    try {
      setResult(await api.submitLevelTest(test.id, known))
      setTest(null)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
      setTest(null)
    }
  }

  return (
    <div className="pt-safe flex flex-1 flex-col pb-10 md:pt-8">
      <div className="flex items-center px-2 md:px-6">
        <Link to="/settings" aria-label="返回设置" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
      </div>
      <div className="px-4 pt-1 md:px-6">
        <div className="text-[13px] tracking-wide text-muted">测一次，之后学会的词会自动往上加</div>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">词汇评级</h1>
      </div>

      <div className="mx-4 mt-5 flex flex-col gap-4 md:mx-6">
        {test ? (
          <TestCard test={test} onAnswer={answer} />
        ) : result ? (
          <ResultCard result={result} onRetry={start} retrying={starting} />
        ) : !status ? (
          <div className="h-56 animate-shimmer rounded-2xl bg-surface" />
        ) : status.vocab === null ? (
          <Intro onStart={start} starting={starting} mastered={status.mastered} />
        ) : (
          <Overview s={status} onRetest={start} starting={starting} />
        )}
      </div>
    </div>
  )
}

function Intro({ onStart, starting, mastered }: { onStart: () => void; starting: boolean; mastered: number }) {
  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-5">
      <div className="text-lg font-semibold">先测一下你认识多少词</div>
      <ul className="mt-2 mb-0 flex list-none flex-col gap-1.5 p-0 text-[14px] leading-relaxed text-muted-2">
        <li>· {TOTAL} 个词，从最常见到很少见，只答「认识 / 不认识」，大约 2 分钟</li>
        <li>· 「认识」= 看到能想起意思；拿不准就选不认识</li>
        <li>· 里面混了几个不存在的假词，乱点「认识」会按比例扣分</li>
        <li>· 测完给出 A1–C2 的等级；认识的词「发现新词」不会再推荐</li>
      </ul>
      {mastered > 0 && <p className="mt-3 mb-0 text-xs text-muted">你已经掌握了 {num(mastered)} 个词，测完之后新掌握的词会继续计入。</p>}
      <button
        onClick={onStart}
        disabled={starting}
        className="mt-4 h-12 w-full rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-50"
      >
        {starting ? '正在出题…' : '开始测试'}
      </button>
    </section>
  )
}

function TestCard({ test, onAnswer }: { test: Test; onAnswer: (knows: boolean) => void }) {
  const done = test.idx >= test.words.length
  const ref = useRef(onAnswer)
  ref.current = onAnswer
  // 电脑上：← / 1 不认识，→ / 2 认识
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'ArrowLeft' || e.key === '1') ref.current(false)
      else if (e.key === 'ArrowRight' || e.key === '2') ref.current(true)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  return (
    <section className="flex flex-col rounded-2xl border border-line-soft bg-surface p-5">
      <div className="flex items-center gap-3">
        <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-line">
          <div className="h-[3px] rounded-sm bg-accent transition-[width] duration-300" style={{ width: `${(test.idx / test.words.length) * 100}%` }} />
        </div>
        <span className="tabular text-xs text-muted">
          {Math.min(test.idx + 1, test.words.length)} / {test.words.length}
        </span>
      </div>
      <div className="flex min-h-[200px] items-center justify-center font-serif text-[40px] text-ink" aria-live="polite">
        {done ? <span className="text-base text-muted">正在算分…</span> : test.words[test.idx]}
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => onAnswer(false)}
          disabled={done}
          className="h-14 rounded-[14px] border border-line bg-transparent text-[15px] text-ink disabled:opacity-40"
        >
          不认识
        </button>
        <button onClick={() => onAnswer(true)} disabled={done} className="h-14 rounded-[14px] border-0 bg-accent text-[15px] font-medium text-on-accent disabled:opacity-40">
          认识
        </button>
      </div>
      <p className="mt-3 mb-0 text-center text-xs text-faint">拿不准就选不认识 · 电脑上可以用 ← →</p>
    </section>
  )
}

function LevelHero({ vocab, level }: { vocab: number; level: NonNullable<LevelStatus['level']> }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-[52px] leading-none font-medium text-ink">{level.id}</span>
        <span className="flex flex-col">
          <span className="text-[15px] font-semibold text-ink">{level.name}</span>
          <span className="text-xs text-muted">{level.desc}</span>
        </span>
      </div>
      <div className="tabular mt-3 text-[15px] text-ink">
        约 <span className="text-[22px] font-semibold">{num(vocab)}</span> 词
      </div>
      {/* 六个等级的格子：已经走过的填满，当前等级按进度填一部分 */}
      <div className="mt-3 grid grid-cols-6 gap-1" aria-hidden>
        {CEFR_LEVELS.map((l, i) => {
          const cur = CEFR_LEVELS.findIndex((x) => x.id === level.id)
          const fill = i < cur ? 1 : i === cur ? level.progress : 0
          return (
            <div key={l.id} className="flex flex-col gap-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-line">
                <div className="h-1.5 rounded-full bg-accent" style={{ width: `${Math.round(fill * 100)}%` }} />
              </div>
              <span className={`text-center text-[11px] ${i === cur ? 'font-semibold text-ink' : 'text-faint'}`}>{l.id}</span>
            </div>
          )
        })}
      </div>
      <p className="mt-2 mb-0 text-xs text-muted">
        {level.next ? `再掌握约 ${num(level.next.need)} 个词升到 ${level.next.id}` : '已经是最高一级了'}
      </p>
    </div>
  )
}

function Overview({ s, onRetest, starting }: { s: LevelStatus; onRetest: () => void; starting: boolean }) {
  return (
    <>
      <section className="rounded-2xl border border-line-soft bg-surface p-5">
        <LevelHero vocab={s.vocab!} level={s.level!} />
        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-solid border-line-soft pt-4">
          <Stat label="测试时" value={num(s.tested!.vocab)} />
          <Stat label="之后新增" value={`+${num(s.gained)}`} />
          <Stat label="近 30 天掌握" value={num(s.recent)} />
        </div>
        <p className="mt-3 mb-0 text-xs leading-relaxed text-muted">
          测试于 {new Date(s.tested!.at).toLocaleDateString('zh-CN')}。之后标「认识」、标 DONE、复习间隔到 21 天以上的词都算掌握，按它在测试里大概率不认识的程度计入。
          数字统计的是词形，只是粗略参考。
        </p>
      </section>
      <div className="flex gap-2.5">
        <Link to="/discover" className="flex h-12 flex-1 items-center justify-center rounded-[14px] border border-line bg-surface text-[14px] text-ink no-underline">
          按这个水平发现新词
        </Link>
        <button onClick={onRetest} disabled={starting} className="h-12 flex-1 rounded-[14px] border-0 bg-invert-bg text-[14px] text-invert-fg disabled:opacity-50">
          {starting ? '正在出题…' : '重新测一次'}
        </button>
      </div>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular text-[17px] font-semibold text-ink">{value}</span>
    </div>
  )
}

function ResultCard({ result, onRetry, retrying }: { result: TestResult; onRetry: () => void; retrying: boolean }) {
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const toggle = (w: string) => setPicked((s) => (s.has(w) ? new Set([...s].filter((x) => x !== w)) : new Set([...s, w])))

  const add = async () => {
    setAdding(true)
    const ok = new Set(added)
    for (const w of result.unknown.filter((u) => picked.has(u.word))) {
      try {
        await api.create('word', w.word, { ipa: '', pos: '', meaning: w.meaning ?? '', example: '', exampleZh: '', highlight: '', phrases: [] })
        ok.add(w.word)
      } catch (e) {
        // 已经在词库里的就当加过了
        if (String(errMsg(e)).includes('已经在词库')) ok.add(w.word)
        else toast(errMsg(e), 'error')
      }
    }
    setAdded(ok)
    setPicked(new Set())
    setAdding(false)
    refreshStats()
    toast('已加入复习，可以在词库里用 AI 补全例句', 'success')
  }

  return (
    <>
      <section className="rounded-2xl border border-line-soft bg-surface p-5">
        <div className="mb-3 text-[13px] text-muted">测试结果</div>
        <LevelHero vocab={result.vocab} level={result.level} />
        {result.unreliable ? (
          <p className="mt-3 mb-0 rounded-xl bg-forgot-bg px-3 py-2 text-xs leading-relaxed text-forgot-fg">
            {result.fakesShown} 个假词里你点了 {result.fakesClaimed} 个「认识」，这次的结果不太可靠，没有计入评级。再测一次，拿不准就选不认识。
          </p>
        ) : result.fakesClaimed > 0 && (
          <p className="mt-3 mb-0 rounded-xl bg-hazy-bg px-3 py-2 text-xs leading-relaxed text-ink">
            {result.fakesShown} 个假词里你点了 {result.fakesClaimed} 个「认识」，估算已经按比例扣掉了。下次拿不准就选不认识，结果会更准。
          </p>
        )}
        <div className="mt-4 flex flex-col gap-1.5 border-t border-solid border-line-soft pt-4">
          <div className="text-xs text-muted">各词频段认识的比例</div>
          {result.bands.map((b) => (
            <div key={b.from} className="flex items-center gap-2 text-xs">
              <span className="tabular w-16 shrink-0 text-muted-2">{bandLabel(b)}</span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.round(b.ratio * 100)}%` }} />
              </div>
              <span className="tabular w-9 shrink-0 text-right text-muted">{Math.round(b.ratio * 100)}%</span>
            </div>
          ))}
        </div>
      </section>

      {result.unknown.length > 0 && (
        <section className="rounded-2xl border border-line-soft bg-surface p-4">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-semibold">不认识的词</span>
            <span className="text-xs text-muted">勾选想学的，加入复习</span>
          </div>
          <div className="flex flex-col">
            {result.unknown.map((u) => {
              const done = added.has(u.word)
              const on = picked.has(u.word)
              return (
                <button
                  key={u.word}
                  onClick={() => !done && toggle(u.word)}
                  disabled={done}
                  aria-pressed={on}
                  className="flex min-h-11 items-center gap-3 border-0 border-t border-solid border-line-soft bg-transparent px-0 py-2 text-left first:border-t-0"
                >
                  <span
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-[1.5px] ${
                      on || done ? 'border-accent bg-accent text-on-accent' : 'border-faint'
                    }`}
                  >
                    {(on || done) && <IconCheck size={12} />}
                  </span>
                  <span className="font-serif text-[17px] text-ink">{u.word}</span>
                  <span className="flex-1 truncate text-[13px] text-muted">{done ? '已加入' : u.meaning}</span>
                </button>
              )
            })}
          </div>
          {picked.size > 0 && (
            <button onClick={add} disabled={adding} className="mt-3 h-11 w-full rounded-xl border-0 bg-accent text-[14px] font-medium text-on-accent disabled:opacity-50">
              {adding ? '正在加入…' : `加入复习（${picked.size}）`}
            </button>
          )}
        </section>
      )}

      <div className="flex gap-2.5">
        <Link to="/discover" className="flex h-12 flex-1 items-center justify-center rounded-[14px] border border-line bg-surface text-[14px] text-ink no-underline">
          按这个水平发现新词
        </Link>
        <button onClick={onRetry} disabled={retrying} className="h-12 flex-1 rounded-[14px] border-0 bg-invert-bg text-[14px] text-invert-fg disabled:opacity-50">
          {retrying ? '正在出题…' : '再测一次'}
        </button>
      </div>
    </>
  )
}
