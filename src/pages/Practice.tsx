import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { LEVELS, type Level, type LessonSummary, type PracticeStats } from '../../shared/practice'
import { Link, navigate } from '../router'
import { PageTitle, errMsg, toast } from '../components/ui'
import { IconChevronRight, IconClipboard, IconClose, IconFlame, IconImage, IconLink, IconShare, IconSparkle, IconText } from '../components/icons'
import { ShareSheet } from '../components/ShareSheet'

type Source = 'url' | 'text' | 'image'

export default function Practice() {
  const [stats, setStats] = useState<PracticeStats | null>(null)
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null)

  useEffect(() => {
    api.practiceStats().then(setStats).catch((e) => toast(errMsg(e), 'error'))
    api
      .lessons()
      .then((r) => setLessons(r.lessons))
      .catch((e) => toast(errMsg(e), 'error'))
  }, [])

  return (
    <div className="pt-safe flex flex-1 flex-col px-4 pb-6 md:px-6 md:pt-10">
      <div className="md:hidden">
        <PageTitle eyebrow="英语教练" title="练习" />
      </div>
      <StatsCard stats={stats} />
      <Composer />

      <h2 className="mt-6 mb-1 text-[13px] font-semibold">最近的练习</h2>
      {!lessons ? (
        <div className="mt-2 h-32 animate-shimmer rounded-2xl bg-surface" />
      ) : lessons.length === 0 ? (
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          还没有练习。发一篇你感兴趣的英文文章（博客、新闻、Reddit 帖子都可以），开始第一次练习吧。
        </p>
      ) : (
        <div className="mt-1.5 overflow-hidden rounded-2xl border border-line-soft bg-surface">
          {lessons.map((l, i) => (
            <Link
              key={l.id}
              to={`/practice/${l.id}`}
              className={`flex items-center gap-3 px-4 py-3.5 text-ink no-underline ${i ? 'border-t border-line-soft' : ''}`}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="truncate font-serif text-[17px] leading-snug">{l.title}</div>
                <div className="flex items-center gap-2 text-xs text-muted">
                  <span>{dateLabel(l.created_at)}</span>
                  <span>·</span>
                  <span>{LEVELS[l.level - 1]?.short}</span>
                </div>
              </div>
              <Progress passed={l.passed} submitted={l.submitted} />
              <IconChevronRight size={16} className="shrink-0 text-faint" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function dateLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 3 个小圆点：通过 = 实心，已提交未通过 = 空心描边 */
function Progress({ passed, submitted }: { passed: number; submitted: number }) {
  return (
    <div className="flex shrink-0 items-center gap-1" aria-label={`3 句中通过 ${passed} 句，已提交 ${submitted} 句`}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full ${
            i < passed ? 'bg-accent' : i < submitted ? 'border-[1.5px] border-accent' : 'bg-line'
          }`}
        />
      ))}
    </div>
  )
}

/* ---------------------------- 打卡统计 ---------------------------- */

function StatsCard({ stats }: { stats: PracticeStats | null }) {
  const [sharing, setSharing] = useState(false)
  if (!stats) return <div className="mt-4 h-[168px] animate-shimmer rounded-2xl bg-surface md:mt-0" />
  const checked = new Set(stats.days)
  const checkedToday = checked.has(stats.today)
  return (
    <section className="mt-4 rounded-2xl border border-line-soft bg-surface p-4 md:mt-0" aria-label="本月打卡">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="本月打卡" value={stats.checkinDays} target={stats.targets.days} unit="天" />
        <Stat label="完成练习" value={stats.completed} target={stats.targets.completed} unit="次" />
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-muted">连续</span>
          <span className="tabular flex items-center gap-1 text-[22px] leading-tight font-semibold">
            <IconFlame size={18} className={stats.streak ? 'text-forgot-fg' : 'text-faint'} />
            {stats.streak}
            <span className="text-xs font-normal text-muted">天</span>
          </span>
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap gap-[5px]" aria-hidden>
        {Array.from({ length: stats.daysInMonth }, (_, i) => i + 1).map((d) => (
          <span
            key={d}
            className={`h-2.5 w-2.5 rounded-[3px] ${
              checked.has(d) ? 'bg-accent' : d === stats.today ? 'border-[1.5px] border-accent' : d < stats.today ? 'bg-line' : 'bg-line-soft'
            }`}
          />
        ))}
      </div>

      {checkedToday && (
        <button
          onClick={() => setSharing(true)}
          className="mt-3.5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border-0 bg-accent-soft text-[13px] font-medium text-accent"
        >
          <IconShare size={16} /> 今天已打卡，生成分享卡片
        </button>
      )}
      <ShareSheet open={sharing} onClose={() => setSharing(false)} />

      {stats.missedYesterday && (
        <div className="mt-3 rounded-xl bg-forgot-bg px-3 py-2 text-[13px] text-forgot-fg">
          昨天没练，今天练一次就不算连断两天。
        </div>
      )}
    </section>
  )
}

function Stat({ label, value, target, unit }: { label: string; value: number; target: number; unit: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular text-[22px] leading-tight font-semibold">
        {value}
        <span className="text-xs font-normal text-muted">
          {' '}
          / {target} {unit}
        </span>
      </span>
    </div>
  )
}

/* ---------------------------- 新建练习 ---------------------------- */

const MAX_IMAGES = 6

/** 缩到最长边 1600px 的 JPEG，截图文字依然清晰，体积小很多 */
async function compress(file: File): Promise<{ mime: string; data: string; preview: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const url = canvas.toDataURL('image/jpeg', 0.85)
  return { mime: 'image/jpeg', data: url.split(',')[1], preview: url }
}

/** 从系统“分享”进来：/practice?url=…&text=…&title=… → 预填链接或正文 */
function sharedInput(): { url: string; text: string } | null {
  const q = new URLSearchParams(window.location.search)
  if (!q.has('url') && !q.has('text') && !q.has('title')) return null
  // 用过就清掉，刷新或返回时不再重复预填
  window.history.replaceState(null, '', '/practice')
  const all = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ')
  const url = q.get('url')?.trim() || /https?:\/\/\S+/.exec(all)?.[0] || ''
  const text = (q.get('text') ?? '').replace(url, '').trim()
  return { url, text }
}

function Composer() {
  const [shared] = useState(sharedInput)
  const [source, setSource] = useState<Source>(shared && !shared.url && shared.text.length > 80 ? 'text' : 'url')
  const [url, setUrl] = useState(shared?.url ?? '')
  const [text, setText] = useState(shared && !shared.url ? shared.text : '')
  const sectionRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (shared) sectionRef.current?.scrollIntoView({ block: 'center' })
  }, [shared])
  const [images, setImages] = useState<{ mime: string; data: string; preview: string }[]>([])
  const [level, setLevel] = useState<Level | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api
      .settings()
      .then((r) => setLevel((l) => l ?? r.current.practiceLevel))
      .catch(() => setLevel((l) => l ?? 1))
  }, [])

  const ready = source === 'url' ? /^https?:\/\/\S+$/.test(url.trim()) : source === 'text' ? text.trim().length > 80 : images.length > 0

  const addFiles = async (files: FileList | null) => {
    if (!files) return
    const room = MAX_IMAGES - images.length
    const picked = [...files].filter((f) => f.type.startsWith('image/')).slice(0, room)
    if (files.length > room) toast(`最多 ${MAX_IMAGES} 张截图`)
    try {
      const out = await Promise.all(picked.map(compress))
      setImages((l) => [...l, ...out])
    } catch {
      toast('图片读取失败，换一张试试', 'error')
    }
  }

  /** 一键粘贴：剪贴板里有链接就填链接，是一大段英文就填正文 */
  const paste = async () => {
    try {
      const clip = (await navigator.clipboard.readText()).trim()
      const link = /https?:\/\/\S+/.exec(clip)?.[0]
      if (link) {
        setSource('url')
        setUrl(link)
      } else if (clip.length > 80) {
        setSource('text')
        setText(clip)
      } else toast(clip ? '剪贴板里不是链接或文章' : '剪贴板是空的')
    } catch {
      toast('没有读取剪贴板的权限，可以长按输入框粘贴', 'error')
    }
  }

  const create = async () => {
    if (!ready || busy) return
    setBusy(true)
    try {
      const r = await api.createLesson({
        level: level ?? 1,
        ...(source === 'url' ? { url: url.trim() } : source === 'text' ? { text: text.trim() } : {}),
        ...(source === 'image' ? { images: images.map(({ mime, data }) => ({ mime, data })) } : {}),
      })
      navigate(`/practice/${r.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
      setBusy(false)
    }
  }

  const tabs: { id: Source; label: string; icon: ReactNode }[] = [
    { id: 'url', label: '链接', icon: <IconLink size={16} /> },
    { id: 'text', label: '正文', icon: <IconText size={16} /> },
    { id: 'image', label: '截图', icon: <IconImage size={16} /> },
  ]

  return (
    <section
      ref={sectionRef}
      className={`mt-3 rounded-2xl border bg-surface p-4 ${shared ? 'border-accent' : 'border-line-soft'}`}
      aria-labelledby="new-lesson"
    >
      <h2 id="new-lesson" className="m-0 flex items-center gap-1.5 text-[15px] font-semibold">
        <IconSparkle size={16} className="text-accent" />
        新练习
      </h2>
      <p className="mt-1 mb-0 text-xs text-muted">
        {shared ? '已从分享带入，确认档位后点「生成练习」' : '发一篇文章，AI 按你的档位出生词、句式和 3 句输出任务'}
      </p>

      <div className="mt-3 grid grid-cols-3 gap-1 rounded-xl bg-line-soft p-1" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={source === t.id}
            onClick={() => setSource(t.id)}
            className={`flex h-9 items-center justify-center gap-1.5 rounded-lg border-0 text-[13px] ${
              source === t.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-3">
        {source === 'url' && (
          <div className="relative">
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            aria-label="文章链接"
            autoCapitalize="off"
            autoComplete="off"
            spellCheck={false}
            className="h-12 w-full rounded-xl border border-line bg-bg pr-20 pl-3.5 text-[15px] text-ink outline-none placeholder:text-faint focus:border-muted"
          />
            <button
              onClick={paste}
              className="absolute top-1.5 right-1.5 flex h-9 items-center gap-1 rounded-lg border-0 bg-chip px-3 text-[13px] font-medium text-ink"
            >
              <IconClipboard size={15} /> 粘贴
            </button>
          </div>
        )}
        {source === 'text' && (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="粘贴英文文章正文（Reddit 帖子、邮件、文档都可以）"
            aria-label="文章正文"
            rows={6}
            className="w-full resize-y rounded-xl border border-line bg-bg px-3.5 py-3 font-serif text-[15px] leading-relaxed text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-muted"
          />
        )}
        {source === 'image' && (
          <div className="grid grid-cols-3 gap-2">
            {images.map((img, i) => (
              <div key={i} className="relative aspect-[3/4] overflow-hidden rounded-xl border border-line bg-bg">
                <img src={img.preview} alt={`截图 ${i + 1}`} className="h-full w-full object-cover object-top" />
                <button
                  onClick={() => setImages((l) => l.filter((_, j) => j !== i))}
                  aria-label={`删除截图 ${i + 1}`}
                  className="absolute top-1 right-1 flex h-7 w-7 items-center justify-center rounded-full border-0 bg-invert-bg/80 text-invert-fg"
                >
                  <IconClose size={14} />
                </button>
              </div>
            ))}
            {images.length < MAX_IMAGES && (
              <button
                onClick={() => fileRef.current?.click()}
                className="flex aspect-[3/4] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-faint bg-bg text-xs text-muted"
              >
                <IconImage size={20} />
                添加截图
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </div>
        )}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-xs text-muted">档位</span>
        <div className="grid flex-1 grid-cols-3 gap-1 rounded-xl bg-line-soft p-1" role="radiogroup" aria-label="练习档位">
          {LEVELS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={level === l.id}
              onClick={() => setLevel(l.id)}
              className={`h-8 rounded-lg border-0 text-[13px] ${
                level === l.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
              }`}
            >
              {l.short}
            </button>
          ))}
        </div>
      </div>
      {level && <p className="mt-1.5 mb-0 text-xs leading-relaxed text-muted">{LEVELS[level - 1].desc}</p>}

      <button
        onClick={create}
        disabled={!ready || busy}
        className="mt-3.5 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-40"
      >
        {busy ? (
          <span className="animate-shimmer">AI 正在读文章、出练习…（10–20 秒）</span>
        ) : (
          '生成练习'
        )}
      </button>
    </section>
  )
}
