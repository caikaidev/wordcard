import { useCallback, useEffect, useState } from 'react'
import { api, type PassageLadder } from '../api'
import { VOCAB_LEVELS } from '../../shared/discover'
import type { Settings } from '../../shared/settings'
import { Link, passagePath } from '../router'
import { errMsg } from './ui'
import { IconChevronRight } from './icons'

/** 练习页主入口：按词汇档给一篇今日短文，读完才解锁下一篇。 */
export function PassageHome() {
  const [ladder, setLadder] = useState<PassageLadder | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  return (
    <section className="mt-3 rounded-2xl border border-line-soft bg-surface p-4" aria-labelledby="today-passage">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="today-passage" className="m-0 text-[15px] font-semibold">
          今日短文
        </h2>
        {ladder && <span className="text-xs text-muted">{ladder.bandName}档 · 约 {ladder.vocab.toLocaleString('zh-CN')} 词</span>}
      </div>
      <p className="mt-1 mb-0 text-xs leading-relaxed text-muted">
        {ladder?.source === 'setting'
          ? '按你选的词汇量推荐。读完一篇，下一篇才打开。'
          : ladder?.source === 'estimate'
            ? '自动档跟词汇评级走。想固定一档，点下面的数字。'
            : '还没做过词汇评级，先按 5 千档。测过之后会跟着估算走。'}
      </p>

      {!ladder && !error ? (
        <div className="mt-3 h-28 animate-shimmer rounded-xl bg-line-soft" />
      ) : error && !ladder ? (
        <div className="mt-3">
          <p className="m-0 text-sm text-muted">{error}</p>
          <button onClick={load} className="mt-2 h-10 rounded-xl border border-line bg-transparent px-4 text-sm text-ink">
            重试
          </button>
        </div>
      ) : ladder ? (
        <>
          {ladder.today ? (
            <Link to={passagePath(ladder.today.id)} className="mt-3 flex flex-col gap-1 rounded-xl bg-bg px-3.5 py-3 text-ink no-underline">
              <span className="font-serif text-[18px] leading-snug">{ladder.today.title}</span>
              <span className="text-xs text-muted">约 {ladder.today.words} 词 · 先读，点词再查</span>
              <span className="line-clamp-3 font-serif text-[14px] leading-relaxed text-muted-2">{ladder.today.excerpt}</span>
              <span className="mt-1 flex items-center gap-1 text-[14px] font-medium text-accent">
                开始阅读 <IconChevronRight size={16} />
              </span>
            </Link>
          ) : (
            <p className="mt-3 mb-0 rounded-xl bg-bg px-3.5 py-3 text-sm leading-relaxed text-muted">
              这一档的短文都读完了。可以把词汇量调高一档，解锁下一组。不会自动跳到更难的文章。
            </p>
          )}
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
