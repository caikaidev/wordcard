import { useEffect, useState } from 'react'
import { api } from '../api'
import { LEVELS, type Level } from '../../shared/practice'
import type { PackageInfo } from '../../shared/types'
import { navigate } from '../router'
import { errMsg, toast } from './ui'

let defaultLevel: Level | null = null

/** 为一个学习包生成下一套练习：不用贴文章、默认档位已选好，点一下就出 */
export default function PackagePractice({ pkg, onCreated }: { pkg: PackageInfo; onCreated?: () => void }) {
  const [level, setLevel] = useState<Level>(defaultLevel ?? 1)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (defaultLevel) return
    api
      .settings()
      .then((r) => {
        defaultLevel = r.current.practiceLevel
        setLevel(defaultLevel)
      })
      .catch(() => {})
  }, [])

  const active = pkg.total - pkg.done
  const pct = pkg.total ? Math.round((pkg.practiced / pkg.total) * 100) : 0
  const allPracticed = active > 0 && pkg.pending === 0

  const create = async (repeat = false) => {
    if (busy) return
    setBusy(true)
    try {
      const r = await api.createPackageLesson(pkg.id, { level, repeat })
      onCreated?.()
      navigate(`/practice/${r.id}`)
    } catch (e) {
      toast(errMsg(e), 'error')
      setBusy(false)
    }
  }

  return (
    <section className="rounded-2xl border border-line-soft bg-surface p-4" aria-label={`为《${pkg.title}》生成练习`}>
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="m-0 min-w-0 truncate font-serif text-[17px] font-medium">{pkg.title}</h3>
        <span className="tabular shrink-0 text-xs text-muted">
          已练 {pkg.practiced} / {pkg.total} 词 · {pkg.lessons} 套
        </span>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-line-soft">
        <div className="h-1 rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>

      {active === 0 ? (
        <p className="mt-3 mb-0 text-[13px] text-muted">🏅 这个包的词都已 DONE，没有要练的了。</p>
      ) : (
        <>
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
          <button
            onClick={() => create(allPracticed)}
            disabled={busy}
            className="mt-3 flex h-12 w-full items-center justify-center rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-60"
          >
            {busy ? (
              <span className="animate-shimmer">AI 正在出练习…（10–20 秒）</span>
            ) : allPracticed ? (
              '词都练过一遍了，再练一轮'
            ) : (
              `生成第 ${pkg.lessons + 1} 套练习（${Math.min(5, pkg.pending)} 个词，还剩 ${pkg.pending}）`
            )}
          </button>
        </>
      )}
    </section>
  )
}
