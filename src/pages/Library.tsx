import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { api } from '../api'
import { dueLabel } from '../../shared/srs'
import type { Item, ItemStatus, PackageInfo } from '../../shared/types'
import { libraryJump, refreshStats, useStats } from '../store'
import ImportSheet from '../components/ImportSheet'
import PackagePractice from '../components/PackagePractice'
import EditSheet from '../components/EditSheet'
import { useExampleZh } from '../exampleZh'
import { Link } from '../router'
import { EnglishDefinition, Highlighted, PageTitle, SpeakButton, confirmDialog, errMsg, toast } from '../components/ui'
import { IconCheck, IconCheckCircle, IconGear, IconPen, IconSearch, IconTrash, IconUndo } from '../components/icons'

const ACTION_W = 88

export default function Library() {
  const [tab, setTab] = useState<ItemStatus>('active')
  const [q, setQ] = useState('')
  const [items, setItems] = useState<Item[] | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [swipedId, setSwipedId] = useState<number | null>(null)
  const [packages, setPackages] = useState<PackageInfo[]>([])
  // 从复习卡片的「来自《包名》」跳过来时直接筛选该包（严格模式下初始化函数会跑两次，所以到 effect 里再清空）
  const [pkgId, setPkgId] = useState<number | null>(() => libraryJump.packageId)
  useEffect(() => {
    libraryJump.packageId = null
  }, [])
  const [showImport, setShowImport] = useState(false)
  const [editing, setEditing] = useState<Item | null>(null)
  const stats = useStats()

  const loadPackages = () =>
    api
      .packages()
      .then((r) => setPackages(r.packages))
      .catch(() => {})
  useEffect(() => {
    loadPackages()
  }, [])

  useEffect(() => {
    let cancelled = false
    const t = setTimeout(
      async () => {
        try {
          const r = await api.items(tab, q.trim(), pkgId ?? undefined)
          if (!cancelled) setItems(r.items)
        } catch (e) {
          if (!cancelled) toast(errMsg(e), 'error')
        }
      },
      q ? 200 : 0,
    )
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [tab, q, pkgId])

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
      loadPackages()
    } catch (e) {
      setItems((l) => (l ? [item, ...l] : l))
      toast(errMsg(e), 'error')
    }
  }

  const remove = async (item: Item) => {
    if (!(await confirmDialog(`删除「${item.text}」？删除后不能恢复。`, { ok: '删除', danger: true }))) return
    setItems((l) => l?.filter((x) => x.id !== item.id) ?? l)
    setSwipedId(null)
    setOpenId(null)
    try {
      await api.remove(item.id)
      toast(`已删除「${item.text}」`, 'success')
      refreshStats()
      loadPackages()
    } catch (e) {
      setItems((l) => (l ? [item, ...l] : l))
      toast(errMsg(e), 'error')
    }
  }

  const replace = (item: Item) => setItems((l) => l?.map((x) => (x.id === item.id ? { ...x, ...item } : x)) ?? l)

  const total = stats ? stats.active + stats.done : null
  const query = q.trim().toLowerCase()
  const current = packages.find((p) => p.id === pkgId) ?? null
  const finished = (p: PackageInfo) => p.total > 0 && p.done === p.total

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
            onKeyDown={(e) => {
              // 输入时已经实时过滤，回车只用来收起手机键盘
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            enterKeyHint="search"
            placeholder="搜索单词、句子或释义（输入即搜）"
            className="h-11 w-full rounded-[14px] border border-line bg-surface pr-4 pl-11 text-[15px] text-ink outline-none placeholder:text-faint focus:border-muted"
          />
        </div>
        {query && items && (
          <div className="-mt-1 px-1 text-xs text-muted" aria-live="polite">
            找到 {items.length} 条 · 单词本身匹配的排在前面，其后是释义或例句里出现「{q.trim()}」的
          </div>
        )}
        <div className="flex items-center justify-between px-1">
          <span className="text-xs tracking-wider text-muted">{packages.length > 0 ? '按学习包筛选' : ''}</span>
          <button
            onClick={() => setShowImport(true)}
            className="-my-1 h-8 shrink-0 border-0 bg-transparent px-1 text-[13px] text-accent"
            title="导入整理好的单词包（JSON 文件），比如一本书的生词表"
          >
            ＋ 导入学习包
          </button>
        </div>
        <div className={`flex items-center gap-2 overflow-x-auto pb-0.5 ${packages.length ? '' : 'hidden'}`} aria-label="学习包">
          {packages.length > 0 && (
            <>
              <PkgChip active={pkgId === null} onClick={() => setPkgId(null)}>
                全部
              </PkgChip>
              {packages.map((p) => (
                <PkgChip key={p.id} active={pkgId === p.id} onClick={() => setPkgId(pkgId === p.id ? null : p.id)}>
                  {finished(p) && '🏅 '}
                  {p.title} <span className="tabular opacity-70">{p.done}/{p.total}</span>
                </PkgChip>
              ))}
            </>
          )}
        </div>
        {current && <PackagePractice pkg={current} onCreated={loadPackages} />}
        {current && finished(current) && (
          <div className="rounded-xl bg-accent-soft px-3.5 py-2.5 text-[13px] text-accent">
            🏅 你学完了《{current.title}》，{current.total} 张卡片全部 DONE
          </div>
        )}
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
            {q ? `没有找到包含「${q.trim()}」的条目` : tab === 'active' ? '还没有进行中的条目，去「添加」里加几个吧' : '还没有标记为 DONE 的条目'}
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
              query={query}
              onToggle={() => toggle(item)}
              onRemove={() => remove(item)}
              onEdit={() => setEditing(item)}
              onUpdate={replace}
            />
          ))
        )}
      </div>

      {editing && (
        <EditSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={(item) => {
            replace(item)
            setEditing(null)
          }}
        />
      )}

      {showImport && (
        <ImportSheet
          onClose={() => setShowImport(false)}
          onImported={(id) => {
            setShowImport(false)
            setItems(null)
            setTab('active')
            setPkgId(id)
            refreshStats()
            loadPackages()
          }}
        />
      )}
    </div>
  )
}

function PkgChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`h-8 max-w-[14rem] shrink-0 truncate rounded-full border px-3 text-[13px] ${
        active ? 'border-transparent bg-invert-bg text-invert-fg' : 'border-line bg-surface text-ink'
      }`}
    >
      {children}
    </button>
  )
}

function Row({
  item,
  open,
  swiped,
  onOpen,
  onSwipe,
  query,
  onToggle,
  onRemove,
  onEdit,
  onUpdate,
}: {
  item: Item
  open: boolean
  swiped: boolean
  onOpen: () => void
  onSwipe: (s: boolean) => void
  query: string
  onToggle: () => void
  onRemove: () => void
  onEdit: () => void
  onUpdate: (item: Item) => void
}) {
  const isDone = item.status === 'done'
  const due = isDone ? '已掌握' : dueLabel(item.due_at)
  const m = item.meta
  const translating = useExampleZh(item, onUpdate, open)
  // 搜索词只出现在例句等地方时标出来，免得以为搜错了
  const indirect = !!query && !item.text.toLowerCase().includes(query) && !m.meaning.toLowerCase().includes(query)
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
              {indirect && <span className="mr-1.5 rounded bg-chip px-1.5 py-0.5 text-[11px] text-muted-2">例句中出现</span>}
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
                  {m.exampleZh ? (
                    <div className="text-[13px] text-muted">{m.exampleZh}</div>
                  ) : (
                    translating && <div className="animate-shimmer text-[13px] text-faint">正在翻译例句…</div>
                  )}
                </div>
                <SpeakButton text={m.example} size={40} waves={1} label="播放例句" />
              </div>
            )}
            {m.memoryTip && <div className="rounded-xl bg-chip px-3 py-2 text-[13px] leading-relaxed text-muted-2">💡 {m.memoryTip}</div>}
            {item.package_title && (
              <div className="text-xs text-muted">
                来自《{item.package_title}》{item.source_ref && ` · ${item.source_ref}`}
              </div>
            )}
            <div className="flex items-center gap-2">
              <SpeakButton text={item.text} size={40} />
              <div className="flex-1" />
              <button
                onClick={onEdit}
                className="flex h-10 items-center gap-1.5 rounded-xl border border-line bg-transparent px-3 text-[13px] text-ink"
              >
                <IconPen size={16} />
                编辑
              </button>
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
