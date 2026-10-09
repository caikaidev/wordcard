import { useEffect, useState } from 'react'
import { api } from '../api'
import type { WeeklyReport } from '../../shared/types'
import { Link } from '../router'
import { errMsg } from '../components/ui'
import { IconBack } from '../components/icons'

const DAYS = ['一', '二', '三', '四', '五', '六', '日']

const md = (ts: number) => {
  const d = new Date(ts + 8 * 3600_000)
  return `${d.getUTCMonth() + 1}月${d.getUTCDate()}日`
}

/** 每周回顾：本周新增、复习、掌握了多少，一句话总结 + 每天的复习量 */
export default function Weekly() {
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState<WeeklyReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    api
      .weekly(offset)
      .then((r) => !cancelled && setData(r))
      .catch((e) => !cancelled && setError(errMsg(e)))
    return () => {
      cancelled = true
    }
  }, [offset, attempt])

  const label = data ? (offset === 0 ? '本周' : offset === -1 ? '上周' : `${-offset} 周前`) : '每周回顾'
  const range = data ? `${md(data.start)} – ${md(data.end - 1)}` : ' '

  return (
    <div className="pt-safe flex flex-1 flex-col pb-8 md:pt-8">
      <div className="flex items-center justify-between px-2 pr-4 md:px-6">
        <Link to="/" aria-label="返回复习" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
        <div className="flex gap-1.5">
          <button
            onClick={() => setOffset(offset - 1)}
            aria-label="上一周"
            className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink"
          >
            ‹ 上一周
          </button>
          <button
            onClick={() => setOffset(offset + 1)}
            disabled={offset === 0}
            aria-label="下一周"
            className="h-9 rounded-full border border-line bg-surface px-3.5 text-[13px] text-ink disabled:opacity-40"
          >
            下一周 ›
          </button>
        </div>
      </div>

      <div className="px-4 pt-1 md:px-6">
        <div className="text-[13px] tracking-wide text-muted">{range}</div>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">{label}回顾</h1>
      </div>

      {error ? (
        <div className="mx-4 mt-5 rounded-2xl border border-line-soft bg-surface p-6 text-center md:mx-6">
          <div className="text-sm text-muted">{error}</div>
          <button onClick={() => setAttempt((n) => n + 1)} className="mt-4 h-11 rounded-2xl border-0 bg-invert-bg px-5 text-sm text-invert-fg">
            重试
          </button>
        </div>
      ) : !data ? (
        <div className="mx-4 mt-5 h-64 animate-shimmer rounded-2xl bg-surface md:mx-6" />
      ) : (
        <Report d={data} />
      )}
    </div>
  )
}

function Report({ d }: { d: WeeklyReport }) {
  const who = d.offset === 0 ? '本周' : '这一周'
  const empty = d.added + d.reviews + d.mastered + d.practiceSubmissions === 0
  const max = Math.max(1, ...d.perDay)
  // 复习流水从上线才开始记，之前的周复习次数不完整
  const partial = d.logSince === null || d.logSince > d.start

  return (
    <>
      <p className="mx-4 mt-4 mb-0 rounded-2xl bg-chip px-4 py-3.5 text-[15px] leading-relaxed md:mx-6">
        {empty ? (
          `${who}还没有学习记录，从复习几张卡片开始吧。`
        ) : (
          <>
            {who}新增 <b className="text-accent">{d.added}</b> 个词
            {d.addedImported > 0 && `（其中 ${d.addedImported} 个来自学习包）`}，复习了 <b className="text-accent">{d.reviews}</b> 次
            {d.reviews > 0 && `（${Math.round((d.remembered / d.reviews) * 100)}% 记得）`}，掌握了 <b className="text-accent">{d.mastered}</b> 个词
            {d.practiceDays > 0 && `，练习打卡 ${d.practiceDays} 天`}。
          </>
        )}
      </p>

      <div className="mx-4 mt-3 grid grid-cols-3 gap-2 md:mx-6">
        <Tile label="新增" value={d.added} prev={d.prev.added} />
        <Tile label="复习" value={d.reviews} prev={d.prev.reviews} unit="次" />
        <Tile label="掌握" value={d.mastered} prev={d.prev.mastered} />
      </div>

      <section className="mx-4 mt-3 rounded-2xl border border-line-soft bg-surface p-4 md:mx-6" aria-label="每天的复习次数">
        <h2 className="m-0 text-[13px] font-semibold">每天复习</h2>
        <div className="mt-3 flex h-24 items-end gap-2">
          {d.perDay.map((n, i) => (
            <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <span className="tabular text-[11px] text-muted">{n || ''}</span>
              <div
                className={`w-full rounded-md ${i === d.todayIdx ? 'bg-accent' : 'bg-accent/40'}`}
                style={{ height: n ? `${Math.max(6, (n / max) * 100)}%` : 3, opacity: n ? 1 : 0.35 }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-2">
          {DAYS.map((x, i) => (
            <span key={x} className={`flex-1 text-center text-[11px] ${i === d.todayIdx ? 'font-semibold text-ink' : 'text-muted'}`}>
              {x}
            </span>
          ))}
        </div>
        {partial && (
          <p className="mt-3 mb-0 text-xs leading-relaxed text-faint">复习次数从功能上线后才开始记录，更早的周数据不完整。</p>
        )}
      </section>

      {d.trouble.length > 0 && (
        <section className="mx-4 mt-3 rounded-2xl border border-line-soft bg-surface p-4 md:mx-6">
          <h2 className="m-0 text-[13px] font-semibold">{who}最容易忘的</h2>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.trouble.map((t) => (
              <span key={t.text} className="max-w-full truncate rounded-lg border border-line bg-bg px-2.5 py-1 font-serif text-[15px]">
                {t.text} <span className="tabular text-xs text-muted">忘 {t.n} 次</span>
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Tile({ label, value, prev, unit = '个' }: { label: string; value: number; prev: number; unit?: string }) {
  const diff = value - prev
  return (
    <div className="rounded-2xl border border-line-soft bg-surface px-3.5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular mt-0.5 text-[26px] leading-tight font-semibold tracking-tight">
        {value}
        <span className="ml-0.5 text-xs font-normal text-muted">{unit}</span>
      </div>
      <div className={`tabular text-xs ${diff > 0 ? 'text-accent' : 'text-muted'}`}>
        {diff === 0 ? '与上周持平' : `比上周 ${diff > 0 ? '+' : ''}${diff}`}
      </div>
    </div>
  )
}
