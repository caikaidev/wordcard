import { useEffect, useRef, useState, type TouchEvent } from 'react'
import { api } from '../api'
import { dueLabel } from '../../shared/srs'
import type { Item, ItemStatus } from '../../shared/types'
import { refreshStats, useStats } from '../store'
import { Link } from '../router'
import { EnglishDefinition, Highlighted, PageTitle, SpeakButton, errMsg, toast } from '../components/ui'
import { IconCheck, IconCheckCircle, IconGear, IconSearch, IconTrash, IconUndo } from '../components/icons'

const ACTION_W = 88

export default function Library() {
  const [tab, setTab] = useState<ItemStatus>('active')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [swipedId, setSwipedId] = useState<number | null>(null)
  const stats = useStats()

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(
      async () => {
        try {
          const r = await api.items(tab, q.trim())
          if (!cancelled) setItems(r.items)
        } catch (e) {
          if (!cancelled) toast(errMsg(e), 'error')
        }
      },
      q ? 250 : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [tab, q])

  const switchTab = (t: ItemStatus) => {
    if (t === tab) return
    setItems(null)
    setOpenId(null)
    setSwipedId(null)
    setTab(t)
  }

  const toggle = async (item: Item) => {
    const next: ItemStatus = item.status === 'active' ? 'done' : 'active'
    setItems((l) => l?.filter((x) => x.id !== item.id) ?? l)
    setSwipedId(null)
    try {
      await api.update(item.id, { status: next })
      toast(next === 'done' ? `「${item.text}」已标记 DONE` : `「${item.text}」已移回进行中`)
      refreshStats()
    } catch (e) {
      setItems((l) => (l ? [item, ...l] : l))
      toast(errMsg(e), 'error')
    }
  }

  const remove = async (item: Item) => {
    if (!window.confirm(`删除「${item.text}」？删除后不能恢复。`)) return
    setItems((l) => l?.filter((x) => x.id !== item.id) ?? l)
    setSwipedId(null)
    try {
      await api.remove(item.id)
      refreshStats()
    } catch (e) {
      setItems((l) => (l ? [item, ...l] : l))
      toast(errMsg(e), 'error')
    }
  }

  const total = stats ? stats.active + stats.done : null

  return (
    <div className="pt-safe flex flex-1 flex-col md:pt-10">
      <div className="px-4 md:hidden">
        <PageTitle
          eyebrow={`共 ${total ?? '–'} 条`}
          title="词库"
          right={
            <Link
              to="/settings"
              aria-label="设置"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink"
            >
              <IconGear />
            </Link>
          }
        />
      </div>

      <div className="flex flex-col gap-2.5 px-4 pt-4 md:px-6 md:pt-0">
        <div className="relative">
          <label htmlFor="q" aria-label="搜索" className="absolute top-[13px] left-4 flex text-muted">
            <IconSearch size={18} />
          </label>
          <input
            id="q"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="搜索单词、句子或释义"
            className="h-11 w-full rounded-[14px] border border-line bg-surface pr-4 pl-11 text-[15px] text-ink outline-none placeholder:text-faint focus:border-muted"
          />
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-line-soft p-1" role="tablist">
          {(['active', 'done'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => switchTab(t)}
              className={`h-10 rounded-[10px] border-0 text-sm ${
                tab === t ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
              }`}
            >
              {t === 'active' ? '进行中' : 'DONE'}{' '}
              <span className="tabular opacity-70">{stats ? (t === 'active' ? stats.active : stats.done) : ''}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col px-4 pt-1 pb-6 md:px-6">
        {!items ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-shimmer flex-col gap-2 border-b border-line py-4">
              <div className="h-5 w-1/2 rounded bg-line-soft" />
              <div className="h-3.5 w-1/3 rounded bg-line-soft" />
            </div>
          ))
        ) : items.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted">
            {q ? '没有找到匹配的条目' : tab === 'active' ? '还没有进行中的条目，去「添加」里加几个吧' : '还没有标记为 DONE 的条目'}
          </div>
        ) : (
          items.map((item) => (
            <Row
              key={item.id}
              item={item}
              open={openId === item.id}
              swiped={swipedId === item.id}
              onOpen={() => {
                setSwipedId(null)
                setOpenId(openId === item.id ? null : item.id)
              }}
              onSwipe={(s) => setSwipedId(s ? item.id : null)}
              onToggle={() => toggle(item)}
              onRemove={() => remove(item)}
            />
          ))
        )}
      </div>

    </div>
  )
}

function Row({
  item,
  open,
  swiped,
  onOpen,
  onSwipe,
  onToggle,
  onRemove,
}: {
  item: Item
  open: boolean
  swiped: boolean
  onOpen: () => void
  onSwipe: (s: boolean) => void
  onToggle: () => void
  onRemove: () => void
}) {
  const isDone = item.status === 'done'
  const due = isDone ? '已掌握' : dueLabel(item.due_at)
  const m = item.meta
  const [drag, setDrag] = useState<number | null>(null)
  const start = useRef<{ x: number; y: number; base: number; locked?: 'x' | 'y' } | null>(null)
  const actionsW = ACTION_W * 2

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]
    start.current = { x: t.clientX, y: t.clientY, base: swiped ? -actionsW : 0 }
  }
  const onTouchMove = (e: TouchEvent) => {
    const s = start.current
    if (!s) return
    const t = e.touches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (!s.locked) {
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return
      s.locked = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y'
    }
    if (s.locked === 'x') setDrag(Math.min(0, Math.max(-actionsW - 24, s.base + dx)))
  }
  const onTouchEnd = () => {
    if (drag !== null) onSwipe(drag < -actionsW / 2)
    setDrag(null)
    start.current = null
  }

  const offset = drag ?? (swiped ? -actionsW : 0)

  return (
    <div className="relative overflow-hidden border-b border-line">
      {/* 左滑露出的操作 */}
      <div className="absolute inset-y-0 right-0 flex" style={{ width: actionsW }} aria-hidden={!swiped}>
        <button
          tabIndex={swiped ? 0 : -1}
          onClick={onToggle}
          className="flex flex-1 flex-col items-center justify-center gap-1 border-0 bg-accent text-[13px] font-semibold text-on-accent"
        >
          {isDone ? <IconUndo size={18} /> : <IconCheck size={18} />}
          {isDone ? '恢复' : 'DONE'}
        </button>
        <button
          tabIndex={swiped ? 0 : -1}
          onClick={onRemove}
          className="flex flex-1 flex-col items-center justify-center gap-1 border-0 bg-forgot-bg text-[13px] font-semibold text-forgot-fg"
        >
          <IconTrash size={18} />
          删除
        </button>
      </div>

      <div
        className={`relative bg-bg ${drag === null ? 'transition-transform duration-200' : ''}`}
        style={{ transform: offset ? `translateX(${offset}px)` : undefined, touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div className="flex items-center gap-3 py-4">
          <button
            onClick={onOpen}
            aria-expanded={open}
            className="flex min-w-0 flex-1 flex-col gap-1 border-0 bg-transparent p-0 text-left text-ink"
          >
            <div
              className={`w-full truncate font-serif leading-snug ${item.type === 'sentence' ? 'text-[17px]' : 'text-[19px]'} ${open ? 'whitespace-normal' : ''}`}
            >
              {item.text}
            </div>
            <div className={`w-full text-[13px] text-muted ${open ? '' : 'truncate'}`}>
              {m.pos && `${m.pos} `}
              {m.meaning}
            </div>
          </button>
          <div className={`text-xs whitespace-nowrap ${due === '今天' ? 'text-accent' : 'text-muted'}`}>{due}</div>
          <button
            onClick={onToggle}
            aria-label={isDone ? '移回进行中' : '标记 DONE'}
            className={`-mr-2.5 flex h-11 w-11 items-center justify-center border-0 bg-transparent ${isDone ? 'text-accent' : 'text-faint hover:text-muted'}`}
          >
            <IconCheckCircle size={20} />
          </button>
        </div>

        {open && (
          <div className="flex animate-rise flex-col gap-3 pb-4">
            {m.ipa && <div className="font-serif text-[15px] text-muted italic">{m.ipa}</div>}
            {m.definitionEn && <EnglishDefinition text={m.definitionEn} source={m.definitionSrc} word={item.text} className="text-[15px]" />}
            {m.example && (
              <div className="flex items-start gap-2">
                <div className="flex flex-1 flex-col gap-1">
                  <div className="font-serif text-[17px] leading-normal">
                    <Highlighted text={m.example} marks={[m.highlight]} />
                  </div>
                  {m.exampleZh && <div className="text-[13px] text-muted">{m.exampleZh}</div>}
                </div>
                <SpeakButton text={m.example} size={40} waves={1} label="播放例句" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <SpeakButton text={item.text} size={40} />
              <div className="flex-1" />
              <button
                onClick={onRemove}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-transparent px-3 text-[13px] text-muted hover:text-forgot-fg"
              >
                <IconTrash size={16} />
                删除
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
