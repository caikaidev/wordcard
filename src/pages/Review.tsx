import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { prefetch, speak, stop } from '../audio'
import { previewLabel } from '../../shared/srs'
import type { Grade, Item } from '../../shared/types'
import { Link } from '../router'
import { refreshStats, useStats } from '../store'
import { Card, Chip, Highlighted, PageTitle, SpeakButton, errMsg, toast } from '../components/ui'
import { IconAlert, IconCheckCircle, IconPlusCircle, IconSparkle } from '../components/icons'

const today = () => {
  const d = new Date()
  return `${d.getMonth() + 1}月${d.getDate()}日 周${'日一二三四五六'[d.getDay()]}`
}

export default function Review() {
  const [queue, setQueue] = useState<Item[] | null>(null)
  const [reviewed, setReviewed] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stats = useStats()

  const load = useCallback(async () => {
    setError(null)
    try {
      const { items } = await api.review()
      setQueue(items)
      setReviewed(0)
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
  const total = reviewed + (queue?.length ?? 0)

  // 提前准备当前卡片和下一张的语音，点播放时基本秒出
  useEffect(() => {
    if (!queue?.length) return
    const [cur, next] = queue
    prefetch([cur.text, cur.meta.example, next?.text, next?.meta.example])
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
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  return (
    <div className="pt-safe flex flex-1 flex-col px-4 md:px-6 md:pt-10">
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
          {Math.min(reviewed + 1, total)} / {total}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col pt-3 pb-3 md:flex-none md:pt-5 md:pb-4">
        {error ? (
          <Empty icon={<IconAlert size={26} />} tone="error" title="加载失败" desc={error} action={<button className={btnPrimary} onClick={load}>重试</button>} />
        ) : !queue ? (
          <Card className="min-h-[300px] flex-1 animate-shimmer md:h-[440px] md:flex-none" />
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
            }
          />
        ) : (
          <Card key={`${card.id}-${flipped}-${reviewed}`} className="flex min-h-[300px] flex-1 animate-flip flex-col overflow-hidden md:min-h-[440px] md:flex-none">
            {flipped ? (
              <Back item={card} onDone={markDone} busy={busy} />
            ) : (
              <Front item={card} onFlip={() => setFlipped(true)} />
            )}
          </Card>
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
            空格 翻转 · 1 / 2 / 3 评分 · P 播放 · D 标记 DONE
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
    <div className="flex flex-1 flex-col px-5 pt-4 pb-5 md:px-12 md:py-10" onClick={onFlip}>
      <div className="flex items-center justify-between">
        <Chip>{isWord ? '单词' : '句子'}</Chip>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
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

function Back({ item, onDone, busy }: { item: Item; onDone: () => void; busy: boolean }) {
  const m = item.meta
  const isWord = item.type === 'word'
  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-5 pt-5 pb-3 md:px-12 md:py-10">
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

      <div className="min-h-4 flex-1" />
      <button
        onClick={onDone}
        disabled={busy}
        className="flex h-11 items-center gap-1.5 self-start border-0 bg-transparent px-1 text-[13px] text-muted hover:text-ink"
      >
        <IconCheckCircle size={18} />
        已掌握，标记 DONE
      </button>
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
