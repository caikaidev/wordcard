import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { prefetch, speak, stop } from '../audio'
import { previewLabel } from '../../shared/srs'
import { BLANK, clozeOf, contextClozeOf, type Cloze, type Grade, type Item, type ReviewMode } from '../../shared/types'
import { Link } from '../router'
import { libraryJump, refreshStats, useStats } from '../store'
import { Card, Chip, EnglishDefinition, Highlighted, PageTitle, SpeakButton, errMsg, toast } from '../components/ui'
import { IconAlert, IconCheckCircle, IconChevronRight, IconPlusCircle, IconShare, IconSparkle } from '../components/icons'
import { ShareSheet } from '../components/ShareSheet'

const today = () => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`
}

export default function Review() {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const [sharing, setSharing] = useState(false)
  // 本次跳过的卡片：不评分、不改复习时间，只在这一轮里先放一边
  const [skipped, setSkipped] = useState<Item[]>([])
  const [drag, setDrag] = useState(0)
  const touch = useRef<{ x: number; y: number; horizontal?: boolean } | null>(null)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stats = useStats()
  const [mode, setMode] = useState<ReviewMode>('mixed')
  useEffect(() => {
    api
      .settings()
      .then((r) => setMode(r.current.reviewMode))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setError(null)
    try {
      const { items } = await api.review()
      setQueue(items)
      setReviewed(0)
      setSkipped([])
      setFlipped(false)
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    load()
    return () => stop()
  }, [load])

  const card = queue?.[0]
  // 这张卡用哪种方式：混合模式下新卡先认读，之后认读 / 产出交替（按复习次数奇偶）
  const context = mode === 'context'
  const cloze = card ? (context ? contextClozeOf(card) : clozeOf(card)) : null
  const production = !!cloze && (context || mode === 'production' || (mode === 'mixed' && card!.reps % 2 === 1))
  const total = reviewed + (queue?.length ?? 0) + skipped.length

  // 提前准备当前卡片的发音，点播放时基本秒出。
  // Gemini TTS 每天只有 100 次额度，所以只预取最常点的单词发音，例句等你点了再生成
  useEffect(() => {
    if (queue?.length) prefetch([queue[0].text])
  }, [queue])

  const advance = (requeue?: Item) => {
    stop()
    setQueue((q) => {
      if (!q) return q
      const rest = q.slice(1)
      return requeue ? [...rest, requeue] : rest
    })
    setReviewed((n) => n + (requeue ? 0 : 1))
    setFlipped(false)
  }

  const skip = () => {
    if (!card || busy) return
    stop()
    setSkipped((l) => [...l, card])
    setQueue((q) => (q ? q.slice(1) : q))
    setFlipped(false)
    setDrag(0)
  }

  const restoreSkipped = () => {
    setQueue((q) => [...(q ?? []), ...skipped])
    setSkipped([])
    setFlipped(false)
  }

  // 手机上把卡片往左滑 = 跳过
  const onTouchStart = (e: React.TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
  }
  const onTouchMove = (e: React.TouchEvent) => {
    const t = touch.current
    if (!t) return
    const dx = e.touches[0].clientX - t.x
    const dy = e.touches[0].clientY - t.y
    if (t.horizontal === undefined) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      t.horizontal = Math.abs(dx) > Math.abs(dy)
    }
    if (t.horizontal) setDrag(Math.min(0, dx))
  }
  const onTouchEnd = () => {
    const horizontal = touch.current?.horizontal
    touch.current = null
    if (horizontal && drag < -90) skip()
    else setDrag(0)
  }

  const grade = async (g: Grade) => {
    if (!card || busy) return
    setBusy(true)
    try {
      const { item } = await api.grade(card.id, g)
      // “忘了”的卡 10 分钟后到期，这里直接放到本轮队尾再来一次
      advance(g === 0 ? item : undefined)
      refreshStats()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  const markDone = async () => {
    if (!card || busy) return
    setBusy(true)
    try {
      await api.update(card.id, { status: 'done' })
      toast(`「${card.text}」已标记 DONE`)
      advance()
      refreshStats()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }

  // 电脑端快捷键：空格翻转 · 1/2/3 评分 · P 播放 · D 标记 DONE
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {})
  keyRef.current = (e: KeyboardEvent) => {
    if (!card || e.metaKey || e.ctrlKey || e.altKey) return
    const t = e.target as HTMLElement
    if (t.closest('input, textarea, [contenteditable]')) return
    const k = e.key.toLowerCase()
    if (k === ' ' || k === 'enter') {
      if (t.closest('button, a')) return
      e.preventDefault()
      if (!flipped) setFlipped(true)
    } else if (flipped && (k === '1' || k === '2' || k === '3')) {
      grade((Number(k) - 1) as Grade)
    } else if (k === 'p') {
      speak(card.text)
    } else if (k === 'd' && flipped) {
      markDone()
    } else if (k === 's' || k === 'arrowright') {
      skip()
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="pt-safe flex min-h-0 flex-1 flex-col px-4 md:px-6 md:pt-10">
      <div className="md:hidden">
        <PageTitle
          eyebrow="今日复习"
          title={today()}
          right={
            <div className="flex items-center gap-2">
              <Link
                to="/remix"
                aria-label="AI 重组今日到期词"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink"
              >
                <IconSparkle />
              </Link>
              <div className="flex h-10 items-center gap-1.5 rounded-full bg-invert-bg px-3.5 text-[13px] text-invert-fg">
                <span className="opacity-70">剩余</span>
                <span className="tabular font-semibold">{queue?.length ?? '–'}</span>
              </div>
            </div>
          }
        />
      </div>

      <div className="mt-3.5 flex items-center gap-3 md:mt-0 md:gap-4">
        <div className="h-[3px] flex-1 overflow-hidden rounded-sm bg-line">
          <div
            className="h-[3px] rounded-sm bg-accent transition-[width] duration-500"
            style={{ width: total ? `${Math.round((reviewed / total) * 100)}%` : '0%' }}
          />
        </div>
        <div className={`tabular text-xs text-muted md:text-[13px] ${total ? '' : 'invisible'}`}>
          {card ? Math.min(reviewed + 1, total) : reviewed} / {total}
          {skipped.length > 0 && <span className="text-faint"> · 跳过 {skipped.length}</span>}
        </div>
        {card && (
          <button
            onClick={skip}
            disabled={busy}
            aria-label="跳过这张（仅本次）"
            title="跳过这张，仅本次有效（手机上也可以左滑卡片）"
            className="-my-1 flex h-8 items-center gap-1 rounded-full border border-line bg-surface px-3 text-xs text-muted-2 disabled:opacity-40"
          >
            跳过
            <IconChevronRight size={14} />
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-3 pb-3 md:flex-none md:pt-5 md:pb-4">
        {error ? (
          <Empty icon={<IconAlert size={26} />} tone="error" title="加载失败" desc={error} action={<button className={btnPrimary} onClick={load}>重试</button>} />
        ) : !queue ? (
          <Card className="min-h-[300px] flex-1 animate-shimmer md:h-[440px] md:flex-none" />
        ) : !card && skipped.length > 0 ? (
          <Empty
            title={`还有 ${skipped.length} 张跳过的卡片`}
            desc={`${reviewed ? `本轮已复习 ${reviewed} 张。` : ''}跳过的卡片不会改变复习时间，下次打开还会出现。`}
            action={
              <div className="flex gap-2.5">
                <Link to="/practice" className={`${btnGhost} no-underline`}>
                  先到这里
                </Link>
                <button className={btnPrimary} onClick={restoreSkipped}>
                  现在复习它们
                </button>
              </div>
            }
          />
        ) : !card ? (
          <Empty
            title={reviewed ? '今天的复习完成了' : stats && stats.active + stats.done === 0 ? '词库还是空的' : '现在没有要复习的'}
            desc={
              reviewed
                ? `本轮复习了 ${reviewed} 张卡片。可以用 AI 重组再练一遍，或者去添加新词。`
                : stats && stats.active + stats.done === 0
                  ? '先添加几个单词或句子，AI 会帮你补全释义和例句。'
                  : '到期的卡片会自动出现在这里。'
            }
            action={
              <div className="flex flex-col items-center gap-3">
                <div className="flex gap-2.5">
                  <Link to="/add" className={`${btnGhost} no-underline`}>
                    <IconPlusCircle size={18} /> 添加
                  </Link>
                  {stats && stats.active > 0 && (
                    <Link to="/remix" className={`${btnPrimary} no-underline`}>
                      <IconSparkle size={18} /> AI 重组
                    </Link>
                  )}
                </div>
                <Link to="/weekly" className="text-[13px] text-accent no-underline">
                  看看本周回顾 ›
                </Link>
                {reviewed > 0 && (
                  <button
                    onClick={() => setSharing(true)}
                    className="flex h-10 items-center gap-1.5 rounded-xl border-0 bg-accent-soft px-4 text-[13px] font-medium text-accent"
                  >
                    <IconShare size={16} /> 生成分享卡片
                  </button>
                )}
                <ShareSheet open={sharing} onClose={() => setSharing(false)} reviewed={reviewed} />
              </div>
            }
          />
        ) : (
          <div
            className={`flex min-h-0 flex-1 flex-col md:flex-none ${drag ? '' : 'transition-transform duration-200'}`}
            style={{ transform: drag ? `translateX(${drag}px) rotate(${drag / 40}deg)` : undefined, opacity: drag ? Math.max(0.4, 1 + drag / 300) : undefined, touchAction: 'pan-y' }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
          >
            <Card
              key={`${card.id}-${flipped}-${reviewed}-${skipped.length}`}
              className="flex min-h-[240px] flex-1 animate-flip flex-col overflow-hidden md:max-h-[min(640px,calc(100dvh-260px))] md:min-h-[440px] md:flex-none"
            >
              {flipped ? (
                <Back
                  item={card}
                  cloze={production && !context ? cloze : null}
                  onDone={markDone}
                  busy={busy}
                  onUpdate={(item) => setQueue((q) => (q ? q.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : q))}
                />
              ) : (
                production && cloze ? (
                  <ProductionFront cloze={cloze} onFlip={() => setFlipped(true)} context={context} source={card.package_title ? `出自《${card.package_title}》${card.source_ref ? ` · ${card.source_ref}` : ''}` : ''} />
                ) : (
                  <Front item={card} onFlip={() => setFlipped(true)} />
                )
              )}
            </Card>
          </div>
        )}
      </div>

      {card && (
        <div className="pb-3 md:pb-0">
          {!flipped ? (
            <button
              onClick={() => setFlipped(true)}
              className="h-[52px] w-full rounded-[14px] border-0 bg-invert-bg text-base font-medium tracking-wide text-invert-fg md:h-16"
            >
              显示答案
            </button>
          ) : (
            <div className="grid grid-cols-3 gap-2.5 md:gap-3">
              <GradeButton k="1" label="忘了" hint={previewLabel(card.interval, 0)} cls="bg-forgot-bg text-forgot-fg" onClick={() => grade(0)} disabled={busy} />
              <GradeButton k="2" label="模糊" hint={previewLabel(card.interval, 1)} cls="bg-hazy-bg text-ink" onClick={() => grade(1)} disabled={busy} />
              <GradeButton k="3" label="记得" hint={previewLabel(card.interval, 2)} cls="bg-accent text-on-accent" onClick={() => grade(2)} disabled={busy} />
            </div>
          )}
          <div className="mt-5 hidden text-center text-xs text-muted md:block">
            空格 翻转 · 1 / 2 / 3 评分 · P 播放 · D 标记 DONE · S 跳过
          </div>
        </div>
      )}
    </div>
  )
}

const btnPrimary =
  'flex h-12 items-center justify-center gap-2 rounded-2xl border-0 bg-invert-bg px-5 text-[15px] font-medium text-invert-fg'
const btnGhost =
  'flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-5 text-[15px] font-medium text-ink'

function Front({ item, onFlip }: { item: Item; onFlip: () => void }) {
  const isWord = item.type === 'word'
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex items-center justify-between">
        <Chip>{isWord ? '单词' : '句子'}</Chip>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center-safe gap-3 py-2 text-center">
        <div
          className={`font-serif font-medium tracking-tight ${
            isWord ? 'text-[40px] leading-[1.1] md:text-[56px]' : 'text-[22px] leading-snug md:text-[30px]'
          }`}
        >
          {item.text}
        </div>
        {item.meta.ipa && <div className="font-serif text-base text-muted italic md:text-lg">{item.meta.ipa}</div>}
        <div className="mt-3">
          <SpeakButton text={item.text} size={48} label={isWord ? '播放发音' : '播放句子'} />
        </div>
      </div>
      <div className="text-center text-[13px] text-muted">{isWord ? '先在心里回想释义' : '先在心里回想意思'}</div>
    </div>
  )
}

/** 产出正面：中文情境 + 挖空句子，先说出空里的表达 */
function ProductionFront({ cloze, onFlip, context = false, source = '' }: { cloze: Cloze; onFlip: () => void; context?: boolean; source?: string }) {
  const [hint, setHint] = useState(false)
  const [before, after] = cloze.sentence.split(BLANK)
  // 提示：每个词只露首字母，如 "pose a risk to" → "p… a r… t…"
  const hintText = cloze.answer
    .split(/\s+/)
    .map((w) => (w.length <= 1 ? w : `${w[0]}…`))
    .join(' ')
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex items-center justify-between">
        <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium whitespace-nowrap text-accent">
          {context ? '语境 · 原句填空' : '产出 · 说出来'}
        </span>
        {source && <span className="truncate pl-3 text-xs text-muted">{source}</span>}
      </div>
      <div className="flex flex-1 flex-col justify-center-safe gap-5 py-2">
        {cloze.scene && <p className="m-0 text-[15px] leading-relaxed text-muted-2 md:text-[17px]">{cloze.scene}</p>}
        <p className="m-0 font-serif text-[22px] leading-normal md:text-[28px]">
          {before}
          <span className="mx-0.5 inline-block min-w-[3.5em] border-b-2 border-accent text-center text-accent">
            {hint ? hintText : '\u00a0'}
          </span>
          {after}
        </p>
        {!hint && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setHint(true)
            }}
            className="self-start border-0 bg-transparent p-0 text-[13px] text-muted underline decoration-line underline-offset-4"
          >
            提示首字母
          </button>
        )}
      </div>
      <div className="text-center text-[13px] text-muted">{context ? '回想原文里这句话，空里是什么，再看答案' : '先大声说出空里的表达，再看答案'}</div>
    </div>
  )
}

function Back({
  item,
  cloze,
  onDone,
  busy,
  onUpdate,
}: {
  item: Item
  cloze?: Cloze | null
  onDone: () => void
  busy: boolean
  onUpdate: (item: Item) => void
}) {
  const [defining, setDefining] = useState(false)
  const define = async () => {
    setDefining(true)
    try {
      onUpdate((await api.define(item.id)).item)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setDefining(false)
    }
  }
  const m = item.meta
  const isWord = item.type === 'word'
  const filled = cloze ? cloze.sentence.replace(BLANK, cloze.answer) : ''
  const scrollRef = useRef<HTMLDivElement>(null)
  const more = useMoreBelow(scrollRef)
  return (
    <div ref={scrollRef} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pt-5 pb-3 md:px-12 md:py-10">
      {cloze && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-accent-soft/60 px-3.5 py-3 md:mb-6">
          <div className="flex-1">
            <div className="mb-1 text-xs text-muted">{cloze.scene}</div>
            <div className="font-serif text-[18px] leading-normal md:text-[21px]">
              <Highlighted text={filled} marks={[cloze.answer]} />
            </div>
          </div>
          <SpeakButton text={filled} size={36} variant="ghost" waves={1} label="播放整句" />
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
          <div
            className={`font-serif font-medium tracking-tight ${
              isWord ? 'text-[28px] leading-[1.1] md:text-[44px]' : 'text-[19px] leading-snug md:text-[26px]'
            }`}
          >
            {item.text}
          </div>
          {m.ipa && <div className="font-serif text-base text-muted italic md:text-lg">{m.ipa}</div>}
        </div>
        <SpeakButton text={item.text} size={44} />
      </div>

      <div className="my-4 h-px bg-divider md:my-7" />

      <div className="flex items-baseline gap-2.5">
        {m.pos && <span className="font-serif text-[15px] text-muted italic md:text-[17px]">{m.pos}</span>}
        <span className="text-base leading-relaxed font-medium md:text-xl">{m.meaning || '（暂无释义）'}</span>
      </div>
      {m.definitionEn ? (
        <EnglishDefinition text={m.definitionEn} source={m.definitionSrc} word={item.text} className="mt-1.5 text-[15px] md:text-[17px]" />
      ) : (
        isWord && (
          <button
            onClick={define}
            disabled={defining}
            className="mt-1 -ml-1 self-start border-0 bg-transparent px-1 py-1 text-xs text-muted underline decoration-line underline-offset-4 disabled:opacity-50"
          >
            {defining ? '查词典中…' : '查英英释义'}
          </button>
        )
      )}

      {m.example && (
        <div className="mt-5 flex flex-col gap-1.5 md:mt-7 md:gap-2">
          <div className="flex items-center justify-between">
            <div className="text-xs tracking-wider text-muted">例句</div>
            <div className="-my-3 -mr-3">
              <SpeakButton text={m.example} variant="ghost" size={44} waves={1} label="播放例句" />
            </div>
          </div>
          <div className="font-serif text-lg leading-normal md:text-[23px]">
            <Highlighted text={m.example} marks={[m.highlight]} />
          </div>
          {m.exampleZh && <div className="text-sm leading-relaxed text-muted md:text-[15px]">{m.exampleZh}</div>}
        </div>
      )}

      {m.phrases.length > 0 && (
        <div className="mt-4 flex flex-col gap-1 md:mt-5">
          <div className="text-xs tracking-wider text-muted">{isWord ? '搭配' : '重点短语'}</div>
          {m.phrases.map((p, i) => (
            <div key={i} className="text-sm leading-relaxed">
              <span className="font-serif text-base">{p.text}</span>
              <span className="ml-2 text-muted">{p.meaning}</span>
            </div>
          ))}
        </div>
      )}

      {m.memoryTip && (
        <div className="mt-4 rounded-xl bg-chip px-3.5 py-2.5 text-sm leading-relaxed text-muted-2 md:mt-5">💡 {m.memoryTip}</div>
      )}

      <div className="min-h-4 flex-1" />
      {item.package_id && item.package_title && (
        <Link
          to="/library"
          onClick={() => {
            libraryJump.packageId = item.package_id ?? null
          }}
          className="mb-1 self-start text-xs text-muted no-underline"
        >
          来自《{item.package_title}》{item.source_ref && ` · ${item.source_ref}`} ›
        </Link>
      )}
      <button
        onClick={onDone}
        disabled={busy}
        className="flex h-11 items-center gap-1.5 self-start border-0 bg-transparent px-1 text-[13px] text-muted hover:text-ink"
      >
        <IconCheckCircle size={18} />
        已掌握，标记 DONE
      </button>
      {/* 还有内容没看完时，底部渐隐提示可以继续往下滚 */}
      <div
        aria-hidden
        className={`pointer-events-none sticky -bottom-3 -mx-5 -mb-3 h-12 shrink-0 bg-gradient-to-t from-surface to-transparent transition-opacity duration-200 md:-mx-12 ${
          more ? 'opacity-100' : 'opacity-0'
        }`}
        style={{ marginTop: '-3rem' }}
      />
    </div>
  )
}

function GradeButton(p: { k: string; label: string; hint: string; cls: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={p.onClick}
      disabled={p.disabled}
      className={`flex h-[52px] flex-col items-center justify-center gap-0 rounded-[14px] border-0 transition active:scale-[0.97] disabled:opacity-60 md:h-16 md:flex-row md:gap-2.5 ${p.cls}`}
    >
      <span className="hidden h-[22px] w-[22px] items-center justify-center rounded-md border border-current/35 text-xs md:flex">
        {p.k}
      </span>
      <span className="text-[15px] font-semibold md:text-base">{p.label}</span>
      <span className="text-[11px] opacity-85 md:text-[13px]">{p.hint}</span>
    </button>
  )
}

function Empty({
  title,
  desc,
  action,
  icon = <IconCheckCircle size={26} />,
  tone = 'ok',
}: {
  title: string
  desc: string
  action?: ReactNode
  icon?: ReactNode
  tone?: 'ok' | 'error'
}) {
  return (
    <Card className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center md:h-[440px]">
      <div
        className={`mb-2 flex h-14 w-14 items-center justify-center rounded-full ${
          tone === 'error' ? 'bg-forgot-bg text-forgot-fg' : 'bg-accent-soft text-accent'
        }`}
      >
        {icon}
      </div>
      <div className="text-xl font-semibold">{title}</div>
      <div className="max-w-[320px] text-sm leading-relaxed text-muted">{desc}</div>
      {action && <div className="mt-3">{action}</div>}
    </Card>
  )
}

/** 滚动容器下方是否还有没看到的内容 */
function useMoreBelow(ref: React.RefObject<HTMLElement | null>) {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
    check()
    el.addEventListener('scroll', check, { passive: true })
    const ro = new ResizeObserver(check)
    ro.observe(el)
    for (const child of Array.from(el.children)) ro.observe(child)
    return () => {
      el.removeEventListener('scroll', check)
      ro.disconnect()
    }
  }, [ref])
  return more
}
