import type { Difficulty } from '../../shared/difficulty'
import SpeakingExercise from '../components/SpeakingExercise'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { speak, speakFast, stop, prefetch, prefetchCached } from '../audio'
import { setSfx, sfx, sfxOn } from '../sfx'
import { STAGES, STAGE_ICONS, buildStage, routeStatus, sameTokens, unlocked, type Exercise, type Quest, type StageId } from '../../shared/quest'
import { Link, navigate } from '../router'
import { celebrate } from '../components/Streak'
import { WaitProgress, confirmDialog, errMsg, toast } from '../components/ui'
import { IconBack, IconCheck, IconClose, IconLock, IconSpeaker } from '../components/icons'


/** 闯关：一份练习拆成几关，一题一屏 */
export default function QuestPage({ id }: { id: number }) {
  const [quest, setQuest] = useState<Quest | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [playing, setPlaying] = useState<StageId | null>(null)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const load = useCallback(() => {
    setError(null)
    api.quest(id).then((result) => {
      if ('pending' in result) {
        timer.current = setTimeout(load, 1500)
      } else {
        setQuest(result)
      }
    }).catch((e) => setError(errMsg(e)))
  }, [id])
  useEffect(() => {
    load()
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [load])

  // 一进路线页就把音频准备好：听力句子要云端语音（出题时服务器已在后台生成，这里基本是直接取缓存），
  // 单词和填空句只取现成缓存，没有的点的时候用系统朗读，不等
  useEffect(() => {
    if (!quest) return
    prefetch(quest.content.listening.map((l) => l.en))
    prefetchCached([...quest.content.words.map((w) => w.en), ...quest.content.cloze.map((q) => q.sentence.replace('____', q.answer))])
  }, [quest?.lessonId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (playing && quest)
    return (
      <Runner
        quest={quest}
        stage={playing}
        onExit={() => setPlaying(null)}
        onPassed={(progress) => setQuest((q) => q ? { ...q, progress } : q)}
        onDifficulty={(stage, difficulty) => setQuest((q) => q ? { ...q, feedback: { ...q.feedback, [stage]: difficulty } } : q)}
      />
    )

  return (
    <div className="pt-safe flex min-h-0 flex-1 flex-col overflow-y-auto pb-10 md:pt-8">
      <div className="flex items-center justify-between px-2 md:px-6">
        <Link to={`/practice/${id}`} aria-label="返回练习" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
        {quest && (
          <span className="tabular mr-2 rounded-full bg-hazy-bg px-3 py-1 text-[13px] font-semibold text-ink" title="经验值">
            ⚡ {quest.progress.xp} XP
          </span>
        )}
      </div>
      <div className="px-4 pt-1 md:px-6">
        <div className="text-[13px] tracking-wide text-muted">闯关</div>
        <h1 className="m-0 mt-1 text-[22px] leading-snug font-semibold tracking-tight">{quest?.title ?? '…'}</h1>
      </div>

      {error ? (
        <div className="mx-4 mt-6 rounded-2xl border border-line-soft bg-surface p-5 text-center md:mx-6">
          <p className="m-0 text-sm text-muted">{error}</p>
          <button onClick={load} className="mt-3 h-11 rounded-xl border-0 bg-invert-bg px-5 text-sm text-invert-fg">
            重试
          </button>
        </div>
      ) : !quest ? (
        <div className="mx-4 mt-6 rounded-2xl border border-line-soft bg-surface p-5 md:mx-6">
          <WaitProgress
            timeout={120}
            slowAfter={40}
            stages={[
              [0, '正在为这篇文章出题…'],
              [8, '认词、听力、阅读题都在准备…'],
              [20, '快好了，第一次出题要久一点，之后直接用'],
            ]}
          />
        </div>
      ) : (
        <Path quest={quest} onPlay={setPlaying} />
      )}
    </div>
  )
}

/* ------------------------------ 关卡路线 ------------------------------ */

function Path({ quest, onPlay }: { quest: Quest; onPlay: (s: StageId) => void }) {
  const p = quest.progress
  const current = routeStatus(p, quest.writeDone).next
  return (
    <div className="relative mt-8 flex flex-col items-center gap-7 pb-6">
      {STAGES.map((s, i) => {
        const done = s.id === 'write' ? quest.writeDone : !!p.stages[s.id]
        const open = done || unlocked(p, s.id)
        const isCurrent = s.id === current
        const best = p.stages[s.id]?.accuracy
        // 多邻国式的左右错落
        const offset = [0, 56, 0, -56, 0][i]
        const go = () => {
          if (!open) return toast('先过前一关')
          if (s.id === 'write') return navigate(`/practice/${quest.lessonId}`)
          onPlay(s.id)
        }
        return (
          <div key={s.id} className="flex flex-col items-center" style={{ transform: `translateX(${offset}px)` }}>
            {isCurrent && <span className="mb-2 animate-rise rounded-xl bg-surface px-3 py-1 text-xs font-semibold text-accent shadow-card">开始</span>}
            <button
              onClick={go}
              aria-label={`${s.name}：${s.desc}${done ? '，已通过' : open ? '' : '，未解锁'}`}
              className={`relative flex h-[76px] w-[76px] items-center justify-center rounded-full border-0 text-[30px] transition-transform active:translate-y-0.5 ${
                done
                  ? 'bg-accent shadow-[0_6px_0_var(--accent-soft)]'
                  : open
                    ? `bg-surface shadow-[0_6px_0_var(--line)] ${isCurrent ? 'ring-4 ring-accent/40' : ''}`
                    : 'bg-line-soft opacity-70 shadow-[0_6px_0_var(--line)]'
              }`}
            >
              {open || done ? <span aria-hidden>{STAGE_ICONS[s.id]}</span> : <IconLock size={26} className="text-faint" />}
              {done && (
                <span className="absolute -right-1 -bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-surface text-accent shadow-card">
                  <IconCheck size={14} />
                </span>
              )}
            </button>
            <span className="mt-2.5 text-[14px] font-semibold text-ink">{s.name}</span>
            <span className="text-xs text-muted">{best !== undefined ? s.id === 'speak' ? '已完成 · 自评' : `最好 ${Math.round(best * 100)}%` : s.desc}</span>
          </div>
        )
      })}
    </div>
  )
}

/* ------------------------------ 做题 ------------------------------ */

type Answer = { correct: boolean; picked?: string }

function Runner({
  quest,
  stage,
  onExit,
  onPassed,
  onDifficulty,
}: {
  quest: Quest
  stage: StageId
  onExit: () => void
  onPassed: (p: Quest['progress']) => void
  onDifficulty: (stage: StageId, difficulty: Difficulty) => void
}) {
  const initial = useMemo(() => buildStage(stage, quest.content), [stage, quest.content])
  // 答错的题排到最后再来一次（每题最多重来一次）
  const [queue, setQueue] = useState<{ ex: Exercise; retry: boolean }[]>(() => initial.map((ex) => ({ ex, retry: false })))
  const [pos, setPos] = useState(0)
  const [firstTry, setFirstTry] = useState({ right: 0, total: initial.length })
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [finished, setFinished] = useState<{ accuracy: number; gained: number } | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  // 连对几题：3 题起显示「连对 N」
  const [combo, setCombo] = useState(0)
  const [sound, setSound] = useState(sfxOn)

  const item = queue[pos]
  const done = pos >= queue.length

  // 当前题的「检查」：题目组件告诉外层能不能点、点了做什么（按钮本身固定在底部，不随题目进出）
  const checkRef = useRef<(() => void) | null>(null)
  const [canCheck, setCanCheck] = useState(false)
  const bindCheck = useCallback<BindCheck>((fn) => {
    checkRef.current = fn
    setCanCheck(!!fn)
  }, [])

  // 听力题的句子提前准备好音频
  useEffect(() => {
    prefetch(initial.flatMap((e) => (e.kind === 'order' ? [e.audio] : e.kind === 'choice' && e.prompt === 'audio' ? [e.text] : [])))
    return () => stop()
  }, [initial])

  const submit = (a: Answer) => {
    setAnswer(a)
    if (!item.retry) setFirstTry((f) => ({ ...f, right: f.right + (a.correct ? 1 : 0) }))
    if (a.correct) {
      sfx.correct()
      setCombo((n) => stage === 'speak' ? 0 : n + 1)
    } else {
      sfx.wrong()
      navigator.vibrate?.(80)
      setCombo(0)
      if (!item.retry) setQueue((q) => [...q, { ex: item.ex, retry: true }])
    }
  }

  const saveCompletion = async () => {
    const accuracy = firstTry.total ? firstTry.right / firstTry.total : 1
    setSaving(true)
    setSaveError('')
    try {
      const r = await api.passStage(quest.lessonId, stage, accuracy)
      onPassed(r.progress)
      celebrate(r.checkin)
      setFinished({ accuracy, gained: r.gained })
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }
  const next = async () => {
    setAnswer(null)
    stop()
    if (pos + 1 < queue.length) return setPos(pos + 1)
    setPos(pos + 1)
    await saveCompletion()
  }

  const leave = async () => {
    if (done || (await confirmDialog('现在退出？这一关的进度不会保存。', { ok: '退出', danger: true }))) onExit()
  }

  // 回车：检查之后继续
  const nextRef = useRef(next)
  nextRef.current = next
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && answer) {
        e.preventDefault()
        nextRef.current()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [answer])

  const progress = queue.length ? Math.min(pos + (answer ? 1 : 0), queue.length) / queue.length : 1

  if (!initial.length) return <div className="p-6 text-center"><p>这份练习暂时没有可用的本关题目。</p><button className="min-h-11 underline" onClick={onExit}>返回关卡路线</button></div>

  return (
    <div className="pt-safe flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-3 pt-3 md:px-6 md:pt-6">
        <button onClick={leave} aria-label="退出这一关" className="flex h-10 w-10 items-center justify-center rounded-full border-0 bg-transparent text-muted">
          <IconClose size={22} />
        </button>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-line">
          <div
            // 每答对一题换一次 key，让进度条亮一下
            key={answer?.correct ? `glow-${pos}` : 'bar'}
            className={`h-3 rounded-full bg-accent transition-[width] duration-500 ease-out ${answer?.correct ? 'animate-glow' : ''}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
        {/* 固定宽度的位置：「连对 N」「再来一次」出现、消失时进度条长度不变 */}
        <span className="flex w-[4.5rem] shrink-0 justify-end text-xs whitespace-nowrap text-forgot-fg">
          {combo >= 3 && !done ? (
            <span key={combo} className="animate-pop font-semibold">
              🔥 连对 {combo}
            </span>
          ) : (
            item?.retry && !done && '再来一次'
          )}
        </span>
        <button
          onClick={() => {
            setSfx(!sound)
            setSound(!sound)
          }}
          aria-label={sound ? '关闭音效' : '打开音效'}
          className="flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent text-base"
        >
          {sound ? '🔊' : '🔇'}
        </button>
      </div>

      {finished || done ? (
        <Finish stage={stage} result={finished} saving={saving} onBack={onExit} lessonId={quest.lessonId} previous={quest.feedback?.[stage]} onDifficulty={onDifficulty} error={saveError} onRetry={saveCompletion} />
      ) : (
        <>
          {/*
            题目区 + 底部固定操作区；反馈条浮在操作区上面，弹出时不改变布局。
            overflow-hidden 必须有：反馈条从屏幕下方滑上来时，没裁掉的部分会让外层页面临时多出一截可滚动高度，iPhone 上整页会跳一下
          */}
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className={`min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-5 md:px-6 ${answer ? 'pb-44' : 'pb-4'}`}>
              <ExerciseView key={`${pos}-${item.retry}`} ex={item.ex} answered={answer} onSubmit={submit} bindCheck={bindCheck} />
            </div>
            <div className="pb-safe shrink-0 px-4 pt-2 pb-3 md:px-6">
              {item.ex.kind === 'match' ? (
                <div className="flex h-12 items-center justify-center text-[13px] text-muted">先点英文，再点它的意思</div>
              ) : (
                <button
                  onClick={() => checkRef.current?.()}
                  disabled={!canCheck || !!answer}
                  className="h-12 w-full rounded-[14px] border-0 bg-accent text-[15px] font-semibold text-on-accent shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,black)] transition-transform active:translate-y-0.5 active:shadow-none disabled:bg-line disabled:text-muted disabled:shadow-none"
                >
                  {item.ex.kind === 'speak' ? '完成这句跟读' : '检查'}
                </button>
              )}
            </div>
            {answer && (
              <div className="absolute inset-x-0 bottom-0 z-10">
                <Feedback ex={item.ex} answer={answer} combo={combo} onNext={next} />
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const CONFETTI_COLORS = ['var(--accent)', '#f2b84b', '#e8735a', '#5bb98c', '#8f7ae5']

/** 撒花：一次性生成几十片纸屑，方向和旋转随机 */
function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => {
        const angle = (Math.random() * 0.9 + 0.05) * Math.PI
        const dist = 140 + Math.random() * 160
        return {
          '--dx': `${Math.cos(angle) * dist * (Math.random() < 0.5 ? -1 : 1)}px`,
          '--dy': `${-Math.sin(angle) * dist + 220}px`,
          '--rot': `${Math.random() * 720 - 360}deg`,
          background: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
          animationDelay: `${Math.random() * 0.15}s`,
        } as React.CSSProperties
      }),
    [],
  )
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((style, i) => (
        <span key={i} className="confetti-piece" style={style} />
      ))}
    </div>
  )
}

/** 数字从 0 涨到目标值 */
function CountUp({ to, suffix = '' }: { to: number; suffix?: string }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 700)
      setN(Math.round(to * (1 - Math.pow(1 - k, 3))))
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to])
  return (
    <>
      {n}
      {suffix}
    </>
  )
}

function Finish({ stage, result, saving, onBack, lessonId, previous, onDifficulty, error, onRetry }: {
  stage: StageId; result: { accuracy: number; gained: number } | null; saving: boolean; onBack: () => void
  lessonId: number; previous?: Difficulty; onDifficulty: (stage: StageId, difficulty: Difficulty) => void
  error: string; onRetry: () => void
}) {
  const [selected, setSelected] = useState<Difficulty | undefined>(previous)
  const [feedbackBusy, setFeedbackBusy] = useState(false)
  const [feedbackError, setFeedbackError] = useState('')
  const rate = async (difficulty: Difficulty) => {
    setFeedbackBusy(true)
    setFeedbackError('')
    try {
      await api.questFeedback(lessonId, stage, difficulty)
      setSelected(difficulty)
      onDifficulty(stage, difficulty)
    } catch (e) { setFeedbackError(errMsg(e)) }
    finally { setFeedbackBusy(false) }
  }
  const name = STAGES.find((s) => s.id === stage)?.name
  const perfect = stage !== 'speak' && result?.accuracy === 1
  useEffect(() => {
    if (result) sfx.finish()
  }, [result])
  return (
    <div className="relative flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto px-6 py-8 text-center">
      {result && <Confetti />}
      <span className="animate-bounce-in text-6xl">{perfect ? '🏆' : '🎉'}</span>
      <div className="animate-rise text-2xl font-semibold" style={{ animationDelay: '0.1s' }}>
        「{name}」完成！
      </div>
      {perfect && (
        <div className="animate-rise text-sm font-medium text-accent" style={{ animationDelay: '0.2s' }}>
          全部一次答对 ✨
        </div>
      )}
      {saving || !result ? (
        <div className="text-sm text-muted">{error ? <><p role="alert">{error}</p><button className="min-h-11 underline" onClick={onRetry}>重试保存进度</button></> : '正在保存…'}</div>
      ) : (
        <div className="mt-2 grid w-full max-w-[320px] grid-cols-2 gap-2.5">
          <div className="animate-rise rounded-2xl border-2 border-[#f2b84b]/60 bg-surface p-3" style={{ animationDelay: '0.25s' }}>
            <div className="text-xs text-muted">⚡ 经验值</div>
            <div className="tabular text-2xl font-semibold text-ink">
              +<CountUp to={result.gained} />
            </div>
          </div>
          <div className="animate-rise rounded-2xl border-2 border-accent/40 bg-surface p-3" style={{ animationDelay: '0.35s' }}>
            <div className="text-xs text-muted">{stage === 'speak' ? '🎙️ 跟读练习' : '🎯 一次答对'}</div>
            <div className="tabular text-2xl font-semibold text-ink">
              {stage === 'speak' ? '已完成' : <CountUp to={Math.round(result.accuracy * 100)} suffix="%" />}
            </div>
          </div>
        </div>
      )}
      {result && <fieldset disabled={feedbackBusy} className="mt-3 w-full max-w-[360px] rounded-2xl border border-line p-3">
        <legend className="px-2 text-sm font-semibold">这一关对你来说怎么样？</legend>
        <div className="grid grid-cols-3 gap-2">
          {([['easy', '偏简单'], ['right', '刚刚好'], ['hard', '有点难']] as const).map(([value, label]) => (
            <button key={value} aria-pressed={selected === value} onClick={() => rate(value)}
              className={`min-h-11 rounded-xl border px-1 text-sm ${selected === value ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-surface text-ink'}`}>{label}</button>
          ))}
        </div>
        <p role="status" className="mb-0 text-xs text-muted">{feedbackBusy ? '正在保存反馈…' : selected ? '反馈已保存，可修改' : '可跳过；用于调整之后新练习的分项难度'}</p>
        {feedbackError && <p role="alert" className="mb-0 text-xs text-forgot-fg">{feedbackError}，请重新选择重试</p>}
      </fieldset>}
      <button
        onClick={onBack}
        disabled={saving || feedbackBusy}
        className="mt-4 h-12 w-full max-w-[320px] rounded-[14px] border-0 bg-accent text-[15px] font-semibold text-on-accent shadow-[0_4px_0_var(--accent-soft)] active:translate-y-0.5 disabled:opacity-50"
      >
        继续
      </button>
    </div>
  )
}

const PRAISE = ['答对了！', '太棒了！', '就是这样！', '完美！', '漂亮！']

function Feedback({ ex, answer, combo, onNext }: { ex: Exercise; answer: Answer; combo: number; onNext: () => void }) {
  const right = ex.kind === 'choice' ? ex.answer : ex.kind === 'order' ? ex.audio : ''
  const note = ex.kind === 'choice' ? ex.note : ex.kind === 'order' ? ex.zh : undefined
  const [praise] = useState(() => (combo >= 3 ? `连对 ${combo} 题！` : PRAISE[Math.floor(Math.random() * PRAISE.length)]))
  // 聚焦「继续」方便回车 / 读屏，但不能让 iOS 为了聚焦去滚动页面
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => btn.current?.focus({ preventScroll: true }), [])
  return (
    <div
      role="status"
      className={`pb-safe animate-sheet px-4 pt-4 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] md:px-6 ${answer.correct ? 'bg-accent-soft' : 'bg-forgot-bg'}`}
    >
      <div className={`flex items-center gap-2.5 text-[18px] font-bold ${answer.correct ? 'text-accent' : 'text-forgot-fg'}`}>
        <span
          className={`animate-bounce-in flex h-8 w-8 items-center justify-center rounded-full text-on-accent ${answer.correct ? 'bg-accent' : 'bg-forgot-fg'}`}
          style={{ animationDelay: '0.08s' }}
        >
          {answer.correct ? <IconCheck size={18} /> : <IconClose size={18} />}
        </span>
        {answer.correct ? ex.kind === 'speak' ? '跟读完成！' : praise : ex.kind === 'match' ? '有配错的，最后再来一次' : '正确答案：'}
      </div>
      {!answer.correct && right && <div className="mt-1 text-[15px] text-ink">{right}</div>}
      {note && <div className="mt-1 text-[13px] leading-relaxed text-muted-2">{note}</div>}
      <button
        ref={btn}
        onClick={onNext}
        className={`mt-3 mb-3 h-12 w-full rounded-[14px] border-0 text-[15px] font-semibold text-on-accent active:translate-y-0.5 ${
          answer.correct ? 'bg-accent shadow-[0_4px_0_color-mix(in_srgb,var(--accent)_60%,black)]' : 'bg-forgot-fg shadow-[0_4px_0_color-mix(in_srgb,var(--forgot-fg)_60%,black)]'
        }`}
      >
        继续
      </button>
    </div>
  )
}

/* ------------------------------ 各题型 ------------------------------ */

type BindCheck = (fn: (() => void) | null) => void

function ExerciseView({ ex, answered, onSubmit, bindCheck }: { ex: Exercise; answered: Answer | null; onSubmit: (a: Answer) => void; bindCheck: BindCheck }) {
  if (ex.kind === 'speak') return <SpeakingExercise en={ex.en} zh={ex.zh} answered={!!answered} bindCheck={bindCheck} onComplete={() => onSubmit({ correct: true })} />
  if (ex.kind === 'match') return <MatchView ex={ex} answered={!!answered} onSubmit={onSubmit} />
  if (ex.kind === 'order') return <OrderView ex={ex} answered={answered} onSubmit={onSubmit} bindCheck={bindCheck} />
  return <ChoiceView ex={ex} answered={answered} onSubmit={onSubmit} bindCheck={bindCheck} />
}

const TITLES: Record<Extract<Exercise, { kind: 'choice' }>['prompt'], string> = {
  word: '选出正确的意思',
  audio: '听句子，选出意思',
  cloze: '选词填空',
  reading: '读一读，回答问题',
}

function BigSpeaker({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-4">
      <button
        onClick={() => speak(text)}
        aria-label="播放"
        className="flex h-20 w-20 items-center justify-center rounded-3xl border-0 bg-accent text-on-accent shadow-[0_5px_0_var(--accent-soft)] active:translate-y-0.5"
      >
        <IconSpeaker size={34} />
      </button>
      <button onClick={() => speak(text, true)} aria-label="慢速播放" className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-lg">
        🐢
      </button>
    </div>
  )
}

function ChoiceView({ ex, answered, onSubmit, bindCheck }: { ex: Extract<Exercise, { kind: 'choice' }>; answered: Answer | null; onSubmit: (a: Answer) => void; bindCheck: BindCheck }) {
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => {
    if (ex.prompt === 'audio') speak(ex.text)
    else if (ex.prompt === 'word') speakFast(ex.text)
  }, [ex])
  const pick = (o: string) => {
    sfx.tap()
    setPicked(o)
  }
  const check = () => picked && onSubmit({ correct: picked === ex.answer, picked })
  // 底部的「检查」按钮在外层固定区域里，这里只告诉它现在能不能点、点了做什么
  useEffect(() => bindCheck(!answered && picked ? check : null))
  // 数字键选项，回车检查
  const ref = useRef({ check, ex, answered })
  ref.current = { check, ex, answered }
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const { ex, answered, check } = ref.current
      if (answered || e.metaKey || e.ctrlKey) return
      const n = Number(e.key)
      if (n >= 1 && n <= ex.options.length) pick(ex.options[n - 1])
      else if (e.key === 'Enter') {
        e.preventDefault()
        check()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  const [before, after] = ex.prompt === 'cloze' ? ex.text.split('____') : ['', '']
  return (
    <div className="flex h-full flex-col">
      <h2 className="m-0 text-xl font-semibold">{TITLES[ex.prompt]}</h2>
      <div className="mt-4">
        {ex.prompt === 'word' && (
          <button onClick={() => speak(ex.text)} className="flex items-center gap-3 border-0 bg-transparent p-0 py-3 text-left" aria-label={`播放 ${ex.text}`}>
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
              <IconSpeaker size={22} />
            </span>
            <span className="font-serif text-[30px] leading-tight text-ink">{ex.text}</span>
          </button>
        )}
        {ex.prompt === 'audio' && <BigSpeaker text={ex.text} />}
        {ex.prompt === 'cloze' && (
          <p className="m-0 rounded-2xl border border-line-soft bg-surface p-4 font-serif text-[19px] leading-relaxed text-ink">
            {before}
            <span
              key={picked ?? ''}
              className={`inline-block min-w-[80px] border-b-2 px-1 text-center ${picked ? 'animate-pop border-accent text-accent' : 'border-muted'}`}
            >
              {picked ?? ' '}
            </span>
            {after}
          </p>
        )}
        {ex.prompt === 'reading' && (
          <>
            <div className="max-h-[38vh] overflow-y-auto rounded-2xl border border-line-soft bg-surface p-4 font-serif text-[16px] leading-relaxed text-ink">{ex.passage}</div>
            <p className="mt-3 mb-0 text-[16px] font-medium text-ink">{ex.text}</p>
          </>
        )}
      </div>
      <div className="mt-4 flex flex-col gap-2.5" role="radiogroup">
        {ex.options.map((o, i) => {
          const isPicked = picked === o
          const showRight = answered && o === ex.answer
          const showWrong = answered && isPicked && o !== ex.answer
          return (
            <button
              key={o}
              role="radio"
              aria-checked={isPicked}
              disabled={!!answered}
              onClick={() => pick(o)}
              className={`flex min-h-[52px] items-center gap-3 rounded-2xl border-2 px-4 py-2.5 text-left text-[15px] text-ink shadow-[0_3px_0_var(--line)] transition-[transform,background-color,border-color] duration-150 active:translate-y-0.5 active:shadow-none ${
                showRight
                  ? 'animate-pop border-accent bg-accent-soft'
                  : showWrong
                    ? 'animate-shake border-forgot-fg bg-forgot-bg'
                    : isPicked
                      ? 'animate-pop border-accent bg-accent-soft/50'
                      : 'border-line bg-surface'
              } ${ex.prompt === 'cloze' ? 'font-serif text-[17px]' : ''}`}
            >
              <span className="tabular hidden h-6 w-6 shrink-0 items-center justify-center rounded-md border border-line text-xs text-muted md:flex">{i + 1}</span>
              {o}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function OrderView({ ex, answered, onSubmit, bindCheck }: { ex: Extract<Exercise, { kind: 'order' }>; answered: Answer | null; onSubmit: (a: Answer) => void; bindCheck: BindCheck }) {
  // 用下标记录选了哪些块（同一个词可能出现两次）
  const [chosen, setChosen] = useState<number[]>([])
  const [hint, setHint] = useState(false)
  useEffect(() => {
    speak(ex.audio)
  }, [ex])
  const check = () => onSubmit({ correct: sameTokens(chosen.map((i) => ex.tiles[i]), ex.answer) })
  useEffect(() => bindCheck(!answered && chosen.length ? check : null))
  return (
    <div className="flex h-full flex-col">
      <h2 className="m-0 text-xl font-semibold">听句子，把单词排好</h2>
      <BigSpeaker text={ex.audio} />
      <button onClick={() => setHint(true)} disabled={hint} className="mx-auto h-8 rounded-full border border-line bg-transparent px-3 text-xs text-muted">
        {hint ? ex.zh : '看中文提示'}
      </button>
      <div className="mt-4 flex min-h-[64px] flex-wrap content-start gap-2 border-b-2 border-line pb-3">
        {chosen.map((ti, i) => (
          <button
            key={`${ti}-${i}`}
            disabled={!!answered}
            onClick={() => {
              sfx.tap()
              setChosen(chosen.filter((_, j) => j !== i))
            }}
            className={`animate-pop h-10 rounded-xl border-2 px-3 font-serif text-[16px] text-ink shadow-[0_2px_0_var(--line)] ${
              answered ? (answered.correct ? 'border-accent bg-accent-soft' : 'animate-shake border-forgot-fg bg-forgot-bg') : 'border-line bg-surface'
            }`}
          >
            {ex.tiles[ti]}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {ex.tiles.map((t, i) => {
          const used = chosen.includes(i)
          return (
            <button
              key={i}
              disabled={used || !!answered}
              onClick={() => {
                sfx.tap()
                setChosen([...chosen, i])
              }}
              className={`h-10 rounded-xl border-2 px-3 font-serif text-[16px] transition-colors active:translate-y-0.5 ${
                used ? 'border-line-soft bg-line-soft text-transparent' : 'border-line bg-surface text-ink shadow-[0_2px_0_var(--line)]'
              }`}
            >
              {t}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function MatchView({ ex, answered, onSubmit }: { ex: Extract<Exercise, { kind: 'match' }>; answered: boolean; onSubmit: (a: Answer) => void }) {
  const left = useMemo(() => ex.pairs.map((p) => p.en), [ex])
  const right = useMemo(() => [...ex.pairs.map((p) => p.zh)].sort(() => Math.random() - 0.5), [ex])
  const [selL, setSelL] = useState<string | null>(null)
  const [selR, setSelR] = useState<string | null>(null)
  const [matched, setMatched] = useState<Set<string>>(new Set())
  const [wrong, setWrong] = useState<[string, string] | null>(null)
  // 刚配对成功的那一对：先绿着弹一下，再变灰
  const [flash, setFlash] = useState<string | null>(null)
  const mistakes = useRef(0)

  useEffect(() => {
    if (!selL || !selR) return
    const ok = ex.pairs.some((p) => p.en === selL && p.zh === selR)
    if (ok) {
      const m = new Set(matched).add(selL)
      setMatched(m)
      setFlash(selL)
      setTimeout(() => setFlash((f) => (f === selL ? null : f)), 450)
      // 最后一对的声音交给整题的「答对了」
      if (m.size === ex.pairs.length) onSubmit({ correct: mistakes.current === 0 })
      else sfx.correct()
    } else {
      mistakes.current++
      sfx.wrong()
      setWrong([selL, selR])
      navigator.vibrate?.(60)
      setTimeout(() => setWrong(null), 500)
    }
    setSelL(null)
    setSelR(null)
  }, [selL, selR]) // eslint-disable-line react-hooks/exhaustive-deps

  const zhDone = (zh: string) => ex.pairs.some((p) => p.zh === zh && matched.has(p.en))
  const zhFlash = (zh: string) => ex.pairs.some((p) => p.zh === zh && p.en === flash)
  const cls = (sel: boolean, done: boolean, bad: boolean, flashing: boolean) =>
    `min-h-[52px] min-w-0 w-full [overflow-wrap:anywhere] rounded-2xl border-2 px-3 py-2 text-[15px] transition-[background-color,border-color,color,opacity] duration-300 active:translate-y-0.5 ${
      flashing
        ? 'animate-pop border-accent bg-accent-soft text-accent'
        : done
          ? 'border-line-soft bg-line-soft text-faint opacity-60'
          : bad
            ? 'animate-shake border-forgot-fg bg-forgot-bg text-ink'
            : sel
              ? 'animate-pop border-accent bg-accent-soft text-ink'
              : 'border-line bg-surface text-ink shadow-[0_3px_0_var(--line)]'
    }`
  return (
    <div>
      <h2 className="m-0 text-xl font-semibold">配对：英文和意思</h2>
      <div className="mt-5 grid grid-cols-2 gap-2.5">
        {left.map((en, i) => {
          const zh = right[i]
          return (
            <Fragment key={en}>
              <button
                disabled={matched.has(en) || answered}
                onClick={() => {
                  setSelL(en)
                  // A deliberate tap uses media playback, including on iPhones in silent mode.
                  // Cached audio plays immediately; otherwise the normal cloud/fallback path applies.
                  speak(en)
                }}
                className={`${cls(selL === en, matched.has(en), wrong?.[0] === en, flash === en)} font-serif`}
              >
                {en}
              </button>
              <button
                disabled={zhDone(zh) || answered}
                onClick={() => {
                  sfx.tap()
                  setSelR(zh)
                }}
                className={cls(selR === zh, zhDone(zh), wrong?.[1] === zh, zhFlash(zh))}
              >
                {zh}
              </button>
            </Fragment>
          )
        })}
      </div>
    </div>
  )
}


