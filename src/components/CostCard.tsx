import { useEffect, useState } from 'react'
import { api, type UsageBucket, type UsageReport } from '../api'
import { PRICING_URL } from '../../shared/pricing'
import { errMsg } from './ui'
import { IconRefresh } from './icons'

const KINDS: { id: string; label: string }[] = [
  { id: 'lesson', label: '生成练习' },
  { id: 'grade', label: '批改' },
  { id: 'enrich', label: 'AI 补全' },
  { id: 'remix', label: 'AI 重组' },
  { id: 'tts', label: '语音' },
]

export const usd = (n: number) =>
  n === 0 ? '$0' : n < 0.0001 ? '< $0.0001' : `$${n < 0.01 ? n.toFixed(4) : n < 1 ? n.toFixed(3) : n.toFixed(2)}`
const tokens = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : `${n}`)

/** 设置页：按记录的 token 用量 × 官方单价估算费用 */
export default function CostCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const [data, setData] = useState<UsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await api.usage())
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [refreshKey])

  const t = data?.month.total
  // 每添加一个词 ≈ 1 次补全 + 2 段语音（单词 + 例句）
  const avg = (b?: UsageBucket) => (b && b.calls ? b.cost / b.calls : null)
  const e = avg(data?.month.byKind.enrich)
  const a = avg(data?.month.byKind.tts)
  const per100 = e !== null && a !== null ? (e + 2 * a) * 100 : null
  return (
    <section className="mx-4 mt-2.5 rounded-2xl border border-line-soft bg-surface p-5 md:mx-6" aria-labelledby="cost-title">
      <div className="flex items-center justify-between">
        <h2 id="cost-title" className="m-0 text-[15px] font-semibold">
          本月费用预估
        </h2>
        <button
          onClick={load}
          disabled={loading}
          aria-label="刷新费用"
          className="-mr-2.5 flex h-10 w-10 items-center justify-center border-0 bg-transparent text-muted disabled:opacity-40"
        >
          <IconRefresh size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error ? (
        <p className="mt-2 mb-0 text-[13px] text-forgot-fg">{error}</p>
      ) : !data || !t ? (
        <div className="mt-2 h-24 animate-shimmer rounded-xl bg-chip" />
      ) : (
        <>
          <div className="mt-1 flex items-end justify-between gap-3">
            <div>
              <div className="tabular text-[28px] leading-tight font-semibold tracking-tight">{usd(t.cost)}</div>
              <div className="text-xs text-muted">
                本月 {t.calls} 次调用 · {tokens(t.input + t.output)} token
              </div>
            </div>
            <div className="text-right text-xs leading-relaxed text-muted">
              <div>
                月底约 <span className="tabular font-medium text-ink">{usd(data.projected)}</span>
              </div>
              <div>
                上月 <span className="tabular">{usd(data.lastMonth.cost)}</span>
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-hidden rounded-xl border border-line-soft">
            {KINDS.map((k, i) => {
              const b: UsageBucket | undefined = data.month.byKind[k.id]
              return (
                <div
                  key={k.id}
                  className={`flex items-center gap-3 px-3.5 py-2.5 text-[13px] ${i ? 'border-t border-line-soft' : ''}`}
                >
                  <span className="w-16 shrink-0 font-medium">{k.label}</span>
                  <span className="tabular flex-1 text-muted">
                    {b ? `${b.calls} 次 · ${tokens(b.input + b.output)}` : '—'}
                  </span>
                  <span className="tabular font-medium">{b ? usd(b.cost) : '$0'}</span>
                </div>
              )
            })}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <Quota label={data.users ? '全站今日 AI' : '今日 AI 调用'} used={data.today.text} limit={data.today.textLimit} />
            <Quota label={data.users ? '全站今日语音' : '今日新语音'} used={data.today.tts} limit={data.today.ttsLimit} />
          </div>
          {data.today.disabled && (
            <div className="mt-2 rounded-xl bg-forgot-bg px-3.5 py-2.5 text-[13px] text-forgot-fg">
              AI 功能已暂停（AI_DISABLED），已缓存的语音照常能播
            </div>
          )}

          {data.users && data.users.length > 0 && (
            <div className="mt-3 overflow-hidden rounded-xl border border-line-soft">
              <div className="bg-chip px-3.5 py-2 text-xs font-medium text-muted-2">本月各成员</div>
              {data.users.map((u) => (
                <div key={u.email} className="flex items-center gap-3 border-t border-line-soft px-3.5 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{u.email}</span>
                  <span className="tabular text-muted">{u.calls} 次</span>
                  <span className="tabular w-16 text-right font-medium">{usd(u.cost)}</span>
                </div>
              ))}
            </div>
          )}

          {per100 !== null && (
            <div className="mt-3 rounded-xl bg-chip px-3.5 py-2.5 text-[13px]">
              按目前用量，每添加 <span className="font-medium">100 个词</span>（补全 + 单词和例句发音）约{' '}
              <span className="tabular font-semibold text-accent">{usd(per100)}</span>
            </div>
          )}

          <p className="mt-3 mb-0 text-xs leading-relaxed text-muted">
            按 Google 付费层级单价估算
            {t.unpriced > 0 && `（有 ${t.unpriced} 次调用的模型不在价目表里，未计入）`}
            。语音命中缓存不产生费用。如果你的 key 没有绑定结算账户（免费层级），实际不收费。
            <a href={PRICING_URL} target="_blank" rel="noreferrer" className="text-accent">
              官方价格
            </a>
            {' · '}
            <a href="https://aistudio.google.com/usage" target="_blank" rel="noreferrer" className="text-accent">
              AI Studio 实际用量
            </a>
          </p>
        </>
      )}
    </section>
  )
}

/** 每日上限：超过 80% 变成警示色 */
function Quota({ label, used, limit }: { label: string; used: number; limit: number }) {
  const pct = Math.min(100, (used / limit) * 100)
  const warn = pct >= 80
  return (
    <div className="rounded-xl border border-line-soft px-3 py-2.5">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular">
          <span className={`font-semibold ${warn ? 'text-forgot-fg' : 'text-ink'}`}>{used}</span> / {limit}
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line-soft">
        <div className={`h-1 rounded-full ${warn ? 'bg-forgot-fg' : 'bg-accent'}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
