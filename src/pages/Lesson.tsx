import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from '../api'
import { LEVELS, type GradeResult, type Lesson, type Submission } from '../../shared/practice'
import type { CardMeta } from '../../shared/types'
import { Link, navigate } from '../router'
import { refreshStats } from '../store'
import { Chip, Highlighted, SpeakButton, errMsg, toast } from '../components/ui'
import { IconArrowRight, IconBack, IconBook, IconCheck, IconLock, IconPen, IconPlusCircle, IconTrash } from '../components/icons'

const blankMeta = (): CardMeta => ({ ipa: '', pos: '', meaning: '', example: '', exampleZh: '', highlight: '', phrases: [] })

export default function LessonPage({ id }: { id: number }) {
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())

  useEffect(() => {
    api
      .lesson(id)
      .then((r) => {
        // 语音额度有限（每天 100 次），练习页不预取，点哪段才生成哪段
        setLesson(r.lesson)
      })
      .catch((e) => setError(errMsg(e)))
  }, [id])

  /** 加入复习卡片；已在词库里（409）也算成功 */
  const addCard = async (key: string, type: 'word' | 'sentence', text: string, meta: Partial<CardMeta>) => {
    try {
      await api.create(type, text, { ...blankMeta(), ...meta })
      toast(`已加入复习：${text}`)
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 409)) return toast(errMsg(e), 'error')
      toast('已经在词库里了')
    }
    setAdded((s) => new Set(s).add(key))
    refreshStats()
  }

  const remove = async () => {
    if (!lesson || !window.confirm('删除这份练习和所有提交记录？')) return
    try {
      await api.deleteLesson(lesson.id)
      navigate('/practice')
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const c = lesson?.content

  return (
    <div className="pt-safe flex flex-1 flex-col pb-10 md:pt-8">
      <div className="flex items-center justify-between px-2 pr-3 md:px-6">
        <Link to="/practice" aria-label="返回练习" className="flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
        {lesson && (
          <button
            onClick={remove}
            aria-label="删除这份练习"
            className="flex h-11 w-11 items-center justify-center border-0 bg-transparent text-muted"
          >
            <IconTrash size={18} />
          </button>
        )}
      </div>

      {error ? (
        <p className="px-4 text-sm text-forgot-fg md:px-6">{error}</p>
      ) : !lesson || !c ? (
        <div className="mx-4 mt-2 h-72 animate-shimmer rounded-2xl bg-surface md:mx-6" />
      ) : (
        <div className="flex flex-col px-4 md:px-6">
          {/* 标题与难度 */}
          <div className="flex items-center gap-2 text-xs text-muted">
            <Chip>{LEVELS[lesson.level - 1]?.name}</Chip>
            <span>{new Date(lesson.created_at).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}</span>
            {lesson.source_url && (
              <a href={lesson.source_url} target="_blank" rel="noreferrer" className="truncate text-accent">
                原文
              </a>
            )}
          </div>
          <h1 className="m-0 mt-2 font-serif text-[24px] leading-tight font-medium tracking-tight">{c.title}</h1>
          <div
            className={`mt-3 rounded-xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
              c.fit === 'hard' ? 'bg-forgot-bg text-forgot-fg' : 'bg-chip text-ink'
            }`}
          >
            <span className="font-semibold">{c.fit === 'ok' ? '难度合适' : c.fit === 'hard' ? '偏难' : '偏简单'}</span>
            {c.fitNote && <span className="text-muted"> · {c.fitNote}</span>}
          </div>
          <div className="mt-3 flex items-start gap-2">
            <p className="m-0 flex-1 font-serif text-[17px] leading-relaxed">{c.summary}</p>
            <SpeakButton text={c.summary} size={40} waves={1} label="播放概要" />
          </div>
          {lesson.readable && (
            <Link
              to={`/practice/${lesson.id}/read`}
              className="mt-3 flex h-11 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface text-[14px] font-medium text-ink no-underline"
            >
              <IconBook size={17} /> 读原文 · 点词查义、收藏
            </Link>
          )}

          {/* 生词 */}
          {c.words.length > 0 && (
            <Section title="生词" count={c.words.length}>
              {c.words.map((w, i) => (
                <Row key={i} first={i === 0}>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-serif text-[18px] font-medium">{w.word}</span>
                      {w.ipa && <span className="font-serif text-sm text-muted italic">{w.ipa}</span>}
                    </div>
                    <div className="text-[13px]">{w.meaning}</div>
                    {w.quote && (
                      <div className="mt-0.5 font-serif text-[14px] leading-snug text-muted italic">
                        <Highlighted text={w.quote} marks={[w.word]} />
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center">
                    <SpeakButton text={w.word} size={36} variant="ghost" />
                    <AddButton
                      done={added.has(`w${i}`)}
                      onClick={() =>
                        addCard(`w${i}`, /\s/.test(w.word) ? 'sentence' : 'word', w.word, {
                          ipa: w.ipa,
                          meaning: w.meaning,
                          example: w.quote,
                          highlight: w.word,
                        })
                      }
                    />
                  </div>
                </Row>
              ))}
            </Section>
          )}

          {/* 句式 */}
          {c.expressions.length > 0 && (
            <Section title="表达句式" count={c.expressions.length}>
              {c.expressions.map((e, i) => (
                <Row key={i} first={i === 0}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="font-serif text-[17px] leading-snug font-medium">{e.pattern}</div>
                    <div className="text-[13px] text-muted">{e.meaning}</div>
                    <div className="font-serif text-[15px] leading-snug">{e.example}</div>
                  </div>
                  <div className="flex shrink-0 items-center">
                    <SpeakButton text={e.example} size={36} variant="ghost" waves={1} label="播放例句" />
                    <AddButton
                      done={added.has(`e${i}`)}
                      onClick={() => addCard(`e${i}`, 'sentence', e.pattern, { meaning: e.meaning, example: e.example })}
                    />
                  </div>
                </Row>
              ))}
            </Section>
          )}

          {/* 输出任务 */}
          <h2 className="mt-7 mb-0 text-[13px] font-semibold">输出任务 · 3 句话</h2>
          <p className="mt-0.5 mb-0 text-xs text-muted">一句一句来。提交前先大声读一遍，读不顺的地方通常就是写得不自然的地方。</p>
          <div className="mt-2.5 flex flex-col gap-2.5">
            {c.tasks.map((t, idx) => (
              <TaskStep
                key={idx}
                lesson={lesson}
                idx={idx}
                onGraded={(l) => {
                  setLesson(l)
                  refreshStats()
                }}
                onRemember={(r) => addCard(`r${idx}-${r.text}`, /\s/.test(r.text) ? 'sentence' : 'word', r.text, { meaning: r.meaning, example: r.example })}
                rememberAdded={(text) => added.has(`r${idx}-${text}`)}
                goal={t.goal}
              />
            ))}
          </div>

          {/* 口语 */}
          {c.speaking.length > 0 && (
            <Section title="口语任务" count={c.speaking.length} note="散步时用英文回答，每题 1 分钟">
              {c.speaking.map((q, i) => (
                <Row key={i} first={i === 0}>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="font-serif text-[16px] leading-snug">{q.question}</div>
                    {q.hint && <div className="text-[13px] leading-relaxed text-muted">{q.hint}</div>}
                  </div>
                  <SpeakButton text={q.question} size={40} waves={1} label="播放题目" />
                </Row>
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, count, note, children }: { title: string; count: number; note?: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h2 className="m-0 text-[13px] font-semibold">
        {title} <span className="font-normal text-muted">{count}</span>
      </h2>
      {note && <p className="mt-0.5 mb-0 text-xs text-muted">{note}</p>}
      <div className="mt-2 overflow-hidden rounded-2xl border border-line-soft bg-surface">{children}</div>
    </section>
  )
}

function Row({ first, children }: { first: boolean; children: ReactNode }) {
  return <div className={`flex items-start gap-2 py-3 pr-2 pl-4 ${first ? '' : 'border-t border-line-soft'}`}>{children}</div>
}

function AddButton({ done, onClick }: { done: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={done}
      aria-label={done ? '已加入复习' : '加入复习'}
      className={`flex h-9 w-9 items-center justify-center rounded-full border-0 bg-transparent ${done ? 'text-accent' : 'text-muted'}`}
    >
      {done ? <IconCheck size={18} /> : <IconPlusCircle size={20} />}
    </button>
  )
}

/* ---------------------------- 单句任务 ---------------------------- */

/** 模板里的空：___（三个及以上下划线） */
const BLANK_RE = /_{2,}/g
/** 句子开头模板末尾的省略号，预填时去掉，光标直接接着写 */
const trimStarter = (t: string) => t.replace(/\s*(\.{3}|…)\s*$/, ' ').replace(/^\s+/, '')
/** 空里写了中文但没加括号时自动加上，批改时按“不会的部分”处理 */
const wrapCjk = (v: string) => v.replace(/(^|[^(（])([\u3400-\u9fff][\u3400-\u9fff\s，、。]*[\u3400-\u9fff]|[\u3400-\u9fff])(?![)）])/g, '$1($2)')

function TaskStep({
  lesson,
  idx,
  goal,
  onGraded,
  onRemember,
  rememberAdded,
}: {
  lesson: Lesson
  idx: number
  goal: string
  onGraded: (l: Lesson) => void
  onRemember: (r: GradeResult['remember']) => void
  rememberAdded: (text: string) => boolean
}) {
  const task = lesson.content.tasks[idx]
  const history = lesson.submissions.filter((s) => s.idx === idx)
  const last = history[history.length - 1]
  const passed = history.some((s) => s.passed)
  // 前一句提交过才展开下一句，保持“一句一句来”
  const prevDone = idx === 0 || lesson.submissions.some((s) => s.idx === idx - 1)
  const [open, setOpen] = useState(prevDone && !passed)
  const blanks = !last && lesson.level === 1 && /_{2,}/.test(task.template)
  // 第一次写：填空档用行内填空；其它情况用整句输入框（引导档预填句子开头）
  const [mode, setMode] = useState<'blanks' | 'free'>(blanks ? 'blanks' : 'free')
  const [text, setText] = useState(last?.text ?? (lesson.level === 2 ? trimStarter(task.template) : ''))
  const [fills, setFills] = useState<string[]>(() => Array(task.template.split(BLANK_RE).length - 1).fill(''))
  // 有批改结果时先收起输入框，看完结果再点“改一改”
  const [editing, setEditing] = useState(!last)
  const [busy, setBusy] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  const justGraded = useRef(false)

  useEffect(() => {
    if (prevDone && !passed) setOpen(true)
  }, [prevDone, passed])

  useEffect(() => {
    const el = areaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${Math.max(el.scrollHeight, 88)}px`
    }
  }, [text, open, editing, mode])

  // 批改回来后，把视线带到新结果的顶部（结果出现在输入框上方，不滚动的话看不到）
  useEffect(() => {
    if (!justGraded.current || !last) return
    justGraded.current = false
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [last?.id])

  const parts = task.template.split(BLANK_RE)
  const composed = mode === 'blanks' ? parts.map((p, i) => p + (i < fills.length ? wrapCjk(fills[i].trim()) : '')).join('') : text
  const missing = mode === 'blanks' ? fills.filter((f) => !f.trim()).length : 0
  const canSubmit = !busy && !!composed.trim() && missing === 0

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    try {
      const r = await api.submit(lesson.id, idx, composed.replace(/\s+/g, ' ').trim())
      justGraded.current = true
      setText(composed.replace(/\s+/g, ' ').trim())
      setMode('free')
      setEditing(false)
      onGraded(r.lesson)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const startEditing = () => {
    setEditing(true)
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      areaRef.current?.focus({ preventScroll: true })
    })
  }

  const goNext = () => {
    const next = document.getElementById(`task-step-${idx + 1}`)
    next?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const status = passed ? '通过' : last ? '需修改' : prevDone ? '待提交' : '未开始'

  return (
    <div
      id={`task-step-${idx}`}
      className={`scroll-mt-3 overflow-hidden rounded-2xl border bg-surface ${open ? 'border-line' : 'border-line-soft'}`}
    >
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 border-0 bg-transparent px-4 py-3.5 text-left text-ink"
      >
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold ${
            passed ? 'bg-accent text-on-accent' : 'bg-chip text-muted-2'
          }`}
        >
          {passed ? <IconCheck size={14} /> : idx + 1}
        </span>
        <span className="flex-1 text-[15px] font-semibold">{goal}</span>
        <span className={`text-xs ${passed ? 'text-accent' : last ? 'text-forgot-fg' : 'text-muted'}`}>{status}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 px-4 pb-4">
          {task.prompt && <p className="m-0 text-[13px] leading-relaxed text-muted">{task.prompt}</p>}
          {task.template && !(editing && mode === 'blanks') && (
            <div className="rounded-xl bg-chip px-3.5 py-2.5 font-serif text-[15px] leading-relaxed">
              <span className="mr-1.5 font-sans text-xs text-muted">{lesson.level === 1 ? '模板' : '开头'}</span>
              {task.template}
            </div>
          )}

          {/* 之前的提交（折叠） */}
          {history.length > 1 && (
            <button
              onClick={() => setShowOld(!showOld)}
              className="self-start border-0 bg-transparent p-0 text-xs text-muted underline decoration-line underline-offset-4"
            >
              {showOld ? '收起之前的提交' : `之前提交过 ${history.length - 1} 次`}
            </button>
          )}
          {showOld &&
            history.slice(0, -1).map((s) => <GradeView key={s.id} sub={s} compact onRemember={onRemember} rememberAdded={rememberAdded} />)}
          {last && (
            <div ref={resultRef} className="scroll-mt-3">
              <GradeView sub={last} onRemember={onRemember} rememberAdded={rememberAdded} />
            </div>
          )}

          {/* 看完结果：改一改 / 下一句 */}
          {last && !editing && (
            <div className="flex gap-2.5">
              <button
                onClick={startEditing}
                className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] text-[15px] font-medium ${
                  passed ? 'border border-line bg-surface text-ink' : 'border-0 bg-invert-bg text-invert-fg'
                }`}
              >
                <IconPen size={17} /> {passed ? '再改进一版' : '改一改'}
              </button>
              {idx < 2 && (
                <button
                  onClick={goNext}
                  className={`flex h-11 flex-1 items-center justify-center gap-1.5 rounded-[14px] text-[15px] font-medium ${
                    passed ? 'border-0 bg-invert-bg text-invert-fg' : 'border border-line bg-surface text-ink'
                  }`}
                >
                  下一句 <IconArrowRight size={17} />
                </button>
              )}
            </div>
          )}

          {/* 输入 */}
          {editing && (
            <div ref={editorRef} className="flex scroll-mt-3 flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor={`task-${idx}`} className="text-xs text-muted">
                  {last ? (passed ? '再改进一版' : '按提示改一改，再提交') : mode === 'blanks' ? '把空填上' : '你的句子'}
                  {lesson.level < 3 && <span className="text-faint"> · 写不出的地方可以先写中文</span>}
                </label>
                {mode === 'blanks' && (
                  <button
                    onClick={() => {
                      setText(composed.replace(BLANK_RE, '').replace(/\s+/g, ' ').trim())
                      setMode('free')
                    }}
                    className="shrink-0 border-0 bg-transparent p-0 text-xs text-muted underline decoration-line underline-offset-4"
                  >
                    改成整句自己写
                  </button>
                )}
              </div>

              {mode === 'blanks' ? (
                <BlankFill parts={parts} fills={fills} onChange={setFills} onSubmit={submit} />
              ) : (
                <textarea
                  id={`task-${idx}`}
                  ref={areaRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={3}
                  autoCapitalize="sentences"
                  className="w-full resize-none overflow-hidden rounded-xl border border-line bg-bg px-3.5 py-3 font-serif text-[16px] leading-relaxed text-ink outline-none focus:border-muted"
                />
              )}

              <button
                onClick={submit}
                disabled={!canSubmit}
                className="flex h-12 items-center justify-center rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-40"
              >
                {busy ? (
                  <span className="animate-shimmer">教练批改中…</span>
                ) : missing > 0 && fills.some((f) => f.trim()) ? (
                  `还有 ${missing} 个空没填`
                ) : last ? (
                  '再次提交'
                ) : (
                  '提交批改'
                )}
              </button>
              {last && (
                <button onClick={() => setEditing(false)} className="self-center border-0 bg-transparent p-1 text-xs text-muted">
                  先不改了
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 行内填空：模板原样显示，空的位置直接输入（可换行的行内输入框） */
function BlankFill({
  parts,
  fills,
  onChange,
  onSubmit,
}: {
  parts: string[]
  fills: string[]
  onChange: (f: string[]) => void
  onSubmit: () => void
}) {
  const refs = useRef<(HTMLSpanElement | null)[]>([])
  const focusBlank = (i: number) => {
    const el = refs.current[i]
    if (!el) return
    el.focus()
    // 光标放到末尾
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(r)
  }
  return (
    <div
      className="rounded-xl border border-line bg-bg px-3.5 py-3 font-serif text-[17px] leading-[2.1] text-ink"
      onClick={(e) => {
        // 点在空白处：跳到第一个没填的空
        if (e.target === e.currentTarget) focusBlank(Math.max(0, fills.findIndex((f) => !f.trim())))
      }}
    >
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < fills.length && (
            <span
              ref={(el) => {
                refs.current[i] = el
              }}
              role="textbox"
              aria-label={`第 ${i + 1} 个空`}
              contentEditable
              suppressContentEditableWarning
              autoCapitalize="off"
              spellCheck
              inputMode="text"
              enterKeyHint={i === fills.length - 1 ? 'send' : 'next'}
              onInput={(e) => {
                const next = [...fills]
                next[i] = e.currentTarget.textContent ?? ''
                onChange(next)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                e.preventDefault()
                if (i < fills.length - 1) focusBlank(i + 1)
                else onSubmit()
              }}
              onPaste={(e) => {
                e.preventDefault()
                document.execCommand('insertText', false, e.clipboardData.getData('text/plain').replace(/\s+/g, ' '))
              }}
              className={`mx-0.5 inline-block min-w-[4.5em] rounded-md border-b-2 px-1.5 align-baseline leading-normal whitespace-pre-wrap outline-none focus:border-accent focus:bg-accent-soft ${
                fills[i]?.trim() ? 'border-accent/60 bg-accent-soft/60' : 'border-muted/50 bg-chip'
              }`}
            />
          )}
        </span>
      ))}
    </div>
  )
}

/* ---------------------------- 批改结果 ---------------------------- */

const SCORE_LABELS: [keyof GradeResult['scores'], string][] = [
  ['content', '内容'],
  ['grammar', '语法'],
  ['naturalness', '自然'],
  ['expression', '句式'],
]

function GradeView({
  sub,
  compact = false,
  onRemember,
  rememberAdded,
}: {
  sub: Submission
  compact?: boolean
  onRemember: (r: GradeResult['remember']) => void
  rememberAdded: (text: string) => boolean
}) {
  const r = sub.result
  const pass = r.verdict === 'pass'
  return (
    <div className={`flex flex-col gap-2.5 rounded-xl border px-3.5 py-3 ${compact ? 'border-line-soft opacity-80' : 'border-line-soft bg-bg'}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap ${pass ? 'bg-accent-soft text-accent' : 'bg-forgot-bg text-forgot-fg'}`}
        >
          第 {sub.attempt} 次 · {pass ? '通过' : '需修改'}
        </span>
        <span className="tabular text-[11px] whitespace-nowrap text-muted">
          {SCORE_LABELS.map(([k, label]) => `${label} ${r.scores[k]}`).join(' · ')}
        </span>
      </div>

      <p className="m-0 font-serif text-[15px] leading-relaxed text-muted-2">{sub.text}</p>
      {compact ? null : (
        <>
          {r.praise && <p className="m-0 text-[13px] leading-relaxed">{r.praise}</p>}

          {r.keyPoint && (
            <div className="rounded-lg bg-accent-soft px-3 py-2.5 text-[13px] leading-relaxed">
              <div className="mb-0.5 text-xs font-semibold text-accent">最重要的一个改进点</div>
              {r.keyPoint}
            </div>
          )}

          {r.corrections.length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {r.corrections.map((x, i) => (
                <li key={i} className="text-[13px] leading-relaxed">
                  <span className="font-serif text-[15px] text-forgot-fg line-through decoration-forgot-fg/50">{x.original}</span>
                  <span className="mx-1.5 text-faint">→</span>
                  <span className="font-serif text-[15px] font-medium text-accent">{x.fixed}</span>
                  {x.reason && <div className="text-muted">{x.reason}</div>}
                </li>
              ))}
            </ul>
          )}

          {r.translations.length > 0 && (
            <div className="flex flex-col gap-1 text-[13px]">
              {r.translations.map((t, i) => (
                <div key={i}>
                  <span className="text-muted">（{t.zh}）</span>
                  <span className="mx-1.5 text-faint">→</span>
                  <span className="font-serif text-[15px]">{t.en}</span>
                </div>
              ))}
            </div>
          )}

          {r.hint && (
            <div className="rounded-lg bg-chip px-3 py-2.5 text-[13px] leading-relaxed">
              <div className="mb-0.5 text-xs font-semibold text-muted-2">提示</div>
              {r.hint}
            </div>
          )}

          {r.reference ? (
            <div className="flex items-start gap-2 rounded-lg border border-line-soft bg-surface px-3 py-2.5">
              <div className="flex-1">
                <div className="mb-0.5 text-xs font-semibold text-muted-2">参考版本</div>
                <div className="font-serif text-[15px] leading-relaxed">{r.reference}</div>
              </div>
              <SpeakButton text={r.reference} size={36} variant="ghost" waves={1} label="播放参考版本" />
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs text-faint">
              <IconLock size={14} />
              通过或改过两次后显示参考版本
            </div>
          )}

          {r.remember.text && (
            <div className="flex items-start gap-2 rounded-lg bg-chip px-3 py-2.5">
              <div className="flex-1 text-[13px] leading-relaxed">
                <div className="mb-0.5 text-xs font-semibold text-muted-2">值得记</div>
                <span className="font-serif text-[15px] font-medium">{r.remember.text}</span>
                <span className="ml-1.5 text-muted">{r.remember.meaning}</span>
                {r.remember.example && <div className="mt-0.5 font-serif text-[14px] text-muted">{r.remember.example}</div>}
              </div>
              <AddButton done={rememberAdded(r.remember.text)} onClick={() => onRemember(r.remember)} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
