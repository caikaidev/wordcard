import { useEffect, useState } from 'react'
import { api } from '../api'
import { errMsg, toast } from './ui'
import { IconRefresh, IconTrash } from './icons'

type Info = Awaited<ReturnType<typeof api.storage>>

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

/** 词库页底部：R2 音频缓存用量与清理 */
export default function StorageCard() {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState<'load' | 'unused' | 'all' | null>('load')

  const load = async () => {
    setBusy('load')
    try {
      setInfo(await api.storage())
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(null)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const cleanup = async (mode: 'unused' | 'all') => {
    if (
      mode === 'all' &&
      !window.confirm('清空全部音频缓存？之后每段语音第一次播放时会重新生成，会消耗 Gemini 额度。')
    )
      return
    setBusy(mode)
    try {
      const r = await api.cleanup(mode)
      toast(r.deleted ? `已删除 ${r.deleted} 段音频，释放 ${formatBytes(r.freedBytes)}` : '没有需要清理的音频')
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
      setBusy(null)
    }
  }

  const pct = info ? Math.min(100, (info.bytes / info.limitBytes) * 100) : 0
  const warn = pct >= 80

  return (
    <section className="mx-6 mt-4 mb-2 rounded-[22px] border border-line-soft bg-surface p-5" aria-labelledby="storage-title">
      <div className="flex items-center justify-between">
        <h2 id="storage-title" className="m-0 text-[15px] font-semibold">
          音频缓存
        </h2>
        <button
          onClick={load}
          disabled={!!busy}
          aria-label="刷新用量"
          className="-mr-2.5 flex h-10 w-10 items-center justify-center border-0 bg-transparent text-muted disabled:opacity-40"
        >
          <IconRefresh size={16} className={busy === 'load' ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="mt-1 flex items-baseline justify-between text-[13px] text-muted">
        <span className="tabular">
          {info ? (
            <>
              <span className={`text-base font-semibold ${warn ? 'text-forgot-fg' : 'text-ink'}`}>
                {formatBytes(info.bytes)}
              </span>{' '}
              / {formatBytes(info.limitBytes)} 免费额度
            </>
          ) : (
            '统计中…'
          )}
        </span>
        {info && <span className="tabular">{info.count} 段</span>}
      </div>

      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line-soft">
        <div
          className={`h-1.5 rounded-full transition-[width] duration-500 ${warn ? 'bg-forgot-fg' : 'bg-accent'}`}
          style={{ width: info ? `${Math.max(pct, info.bytes ? 1 : 0)}%` : '0%' }}
        />
      </div>

      {info && (
        <p className="mt-3 mb-0 text-[13px] leading-relaxed text-muted">
          {warn
            ? `已用 ${pct.toFixed(0)}%，接近免费额度，建议清理。`
            : `已用 ${pct < 0.1 ? '不到 0.1' : pct.toFixed(1)}%。`}
          {info.unusedCount > 0
            ? `其中 ${info.unusedCount} 段（${formatBytes(info.unusedBytes)}）已不属于任何词条，比如删掉的词、AI 重组的句子。`
            : '所有音频都属于词库里的词条。'}
        </p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => cleanup('unused')}
          disabled={!!busy || !info?.unusedCount}
          className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border-0 bg-invert-bg text-sm font-medium text-invert-fg disabled:opacity-40"
        >
          {busy === 'unused' ? '清理中…' : '清理无用音频'}
        </button>
        <button
          onClick={() => cleanup('all')}
          disabled={!!busy || !info?.count}
          className="flex h-11 items-center justify-center gap-1.5 rounded-2xl border border-line bg-transparent text-sm text-forgot-fg disabled:opacity-40"
        >
          <IconTrash size={16} />
          {busy === 'all' ? '清空中…' : '全部清空'}
        </button>
      </div>
    </section>
  )
}
