import { useCallback, useEffect, useState } from 'react'
import { api, type PassageLadder } from '../api'
import { readingMinutes } from '../../shared/retention'
import { VOCAB_LEVELS } from '../../shared/discover'
import type { Settings } from '../../shared/settings'
import { Link, passagePath } from '../router'
import { useStats } from '../store'
import { errMsg } from './ui'
import { IconChevronRight, IconFlame } from './icons'

/** 练习页主入口：按词汇档给一篇今日短文，读完才解锁下一篇。 */
export function PassageHome() {
  const [ladder, setLadder] = useState<PassageLadder | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [streak, setStreak] = useState<number | null>(null)
  const due = useStats()?.due

  const load = useCallback(() => {
    setError(null)
    return api
      .passages()
      .then(setLadder)
      .catch((e) => setError(errMsg(e)))
  }, [])

  useEffect(() => {
    load()
    api
      .settings()
      .then((r) => setSettings(r.current))
      .catch(() => {})
    api
      .streak()
      .then((s) => setStreak(s.streak))
      .catch(() => {})
  }, [load])

  const saveBand = async (id: number) => {
    if (!settings || settings.vocabLevel === id || saving) return
    setSaving(true)
    try {
      const r = await api.saveSettings({ vocabLevel: id })
      setSettings(r.current)
      await load()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const reviewLabel = due == null ? '复习' : `复习 ${due}`
  return (
    <section className="mt-3 rounded-2xl border border-line-soft bg-surface p-4" aria-labelledby="today-next">
      <div className="flex items-start justify-between gap-3">
        <p id="today-next" className="m-0 text-xs font-semibold tracking-wide text-accent">
          今天的下一步
        </p>
        <Link
          to="/"
          aria-label={due == null ? '去复习' : `复习 ${due} 张`}
          className="flex h-8 shrink-0 items-center rounded-full border border-line bg-bg px-3 text-xs text-muted-2 no-underline"
        >
          {reviewLabel}
        </Link>
      </div>

      {!ladder && !error ? (
        <div className="mt-3 h-28 animate-shimmer rounded-xl bg-line-soft" aria-hidden />
      ) : error && !ladder ? (
        <div className="mt-3">
          <p className="m-0 text-sm text-muted">{error}</p>
          <button onClick={load} className="mt-2 h-10 rounded-xl border border-line bg-transparent px-4 text-sm text-ink">
            重试
          </button>
        </div>
      ) : ladder ? (
        <>
          <h1 className="m-0 mt-1 font-serif text-[26px] leading-tight font-medium">
            {ladder.today ? ladder.today.title : '这一档读完了'}
          </h1>
          <p className="mt-1.5 mb-0 flex items-center gap-1 text-[13px] text-muted">
            {ladder.today ? <span>约 {readingMinutes(ladder.today.words)} 分钟 · </span> : null}
            <IconFlame size={14} className={streak ? 'text-forgot-fg' : 'text-faint'} />
            连续 {streak ?? '–'} 天
          </p>
          {ladder.today ? (
            <Link
              to={passagePath(ladder.today.id)}
              className="mt-3 flex h-12 items-center justify-center gap-1 rounded-[14px] bg-invert-bg text-[15px] font-medium text-invert-fg no-underline"
            >
              开始阅读 <IconChevronRight size={16} />
            </Link>
          ) : (
            <p className="mt-3 mb-0 text-sm leading-relaxed text-muted">
              这一档的短文都读完了。可以把词汇量调高一档，解锁下一组。不会自动跳到更难的文章。
            </p>
          )}
          <p className="mt-3 mb-0 text-xs leading-relaxed text-muted">
            {ladder.source === 'setting'
              ? `${ladder.bandName}档。读完一篇，下一篇才打开。`
              : ladder.source === 'estimate'
                ? '自动档跟词汇评级走。想固定一档，点下面的数字。'
                : '还没做过词汇评级，先按 5 千档。测过之后会跟着估算走。'}
          </p>
          <ol className="mt-3 flex flex-col gap-1.5 p-0">
            {ladder.items.map((item, i) => {
              const body = (
                <>
                  <span className="tabular w-5 shrink-0 text-xs text-faint">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-serif text-[15px]">{item.title}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {item.state === 'done' ? '已读' : item.state === 'current' ? '今天' : '未解锁'}
                  </span>
                </>
              )
              const cls = 'flex items-center gap-2 rounded-lg px-1 py-1'
              if (item.state === 'locked') {
                return (
                  <li key={item.id} className={`${cls} text-faint`} title="读完上一篇后解锁">
                    {body}
                  </li>
                )
              }
              return (
                <li key={item.id}>
                  <Link to={passagePath(item.id)} className={`${cls} text-ink no-underline`}>
                    {body}
                  </Link>
                </li>
              )
            })}
          </ol>
        </>
      ) : null}

      <div className="mt-3 grid grid-cols-5 gap-1 rounded-[14px] bg-line-soft p-1" role="radiogroup" aria-label="短文词汇档">
        {VOCAB_LEVELS.map((l) => (
          <button
            key={l.id}
            role="radio"
            aria-checked={settings?.vocabLevel === l.id}
            disabled={!settings || saving}
            title={l.desc}
            onClick={() => saveBand(l.id)}
            className={`h-8 rounded-[10px] border-0 text-[13px] disabled:opacity-50 ${
              settings?.vocabLevel === l.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>
      {error && ladder && <p className="mt-2 mb-0 text-xs text-muted">{error}</p>}
    </section>
  )
}
