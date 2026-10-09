import { useRef, useState } from 'react'
import { api, type ImportReport } from '../api'
import { IMPORT_FORMAT, parseImport, type ImportParse } from '../../shared/import'
import { errMsg } from './ui'

const BATCH = 100

type Loaded = { raw: { cards: unknown[] } & Record<string, unknown>; parsed: Extract<ImportParse, { ok: true }> }

/** 词库页：导入学习包（shiju-import-v1）。选文件 → 预览 → 确认 → 汇总报告 */
export default function ImportSheet({ onClose, onImported }: { onClose: () => void; onImported: (packageId: number) => void }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [report, setReport] = useState<(ImportReport & { invalid: string[] }) | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setLoaded(null)
    let raw: unknown
    try {
      raw = JSON.parse(await file.text())
    } catch {
      return setError('这不是有效的 JSON 文件')
    }
    const parsed = parseImport(raw)
    if (!parsed.ok) return setError(parsed.error)
    if (!parsed.cards.length) return setError('没有可导入的卡片' + (parsed.invalid[0] ? `：${parsed.invalid[0]}` : ''))
    setLoaded({ raw: raw as Loaded['raw'], parsed })
  }

  const run = async () => {
    if (!loaded) return
    const { raw, parsed } = loaded
    // 按包内顺序切成小批提交，每批带上它在整包里的位置
    const ordered = parsed.cards.map((c) => raw.cards[c.index])
    const total = ordered.length
    const sum: ImportReport = { packageId: 0, added: 0, skipped: 0, invalid: [] }
    setError(null)
    setProgress({ done: 0, total })
    try {
      for (let i = 0; i < total; i += BATCH) {
        const r = await api.importPackage({
          format: IMPORT_FORMAT,
          package: raw.package,
          cards: ordered.slice(i, i + BATCH),
          batch: { offset: i, total },
        })
        sum.packageId = r.packageId
        sum.added += r.added
        sum.skipped += r.skipped
        setProgress({ done: Math.min(i + BATCH, total), total })
      }
      sum.invalid = parsed.invalid
      setReport(sum)
    } catch (e) {
      setError(`${errMsg(e)}（已导入的部分不会丢，重新选择同一个文件即可继续，重复的会自动跳过）`)
    } finally {
      setProgress(null)
    }
  }

  const busy = progress !== null
  const p = loaded?.parsed

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => !busy && onClose()}>
      <div
        role="dialog"
        aria-label="导入学习包"
        onClick={(e) => e.stopPropagation()}
        className="pb-safe flex max-h-[85dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-bg p-5 md:rounded-3xl"
      >
        <h2 className="m-0 text-lg font-semibold">导入学习包</h2>

        {report ? (
          <>
            <div className="rounded-2xl bg-chip px-4 py-3.5 text-[15px] leading-relaxed">
              「{p?.pkg.title}」导入完成：新增 <b className="text-accent">{report.added}</b> 条，跳过{' '}
              <b>{report.skipped}</b> 条（已存在）
              {report.invalid.length > 0 && <>，<b>{report.invalid.length}</b> 条格式不完整未导入</>}
            </div>
            {report.invalid.length > 0 && (
              <ul className="m-0 list-disc pl-5 text-[13px] leading-relaxed text-muted">
                {report.invalid.slice(0, 5).map((m) => (
                  <li key={m}>{m}</li>
                ))}
                {report.invalid.length > 5 && <li>…另有 {report.invalid.length - 5} 条</li>}
              </ul>
            )}
            <button onClick={() => onImported(report.packageId)} className="h-11 rounded-2xl border-0 bg-invert-bg text-[15px] text-invert-fg">
              查看这个包
            </button>
          </>
        ) : (
          <>
            <p className="m-0 text-[13px] leading-relaxed text-muted">
              选择助手生成的 <code>.json</code> 学习包（{IMPORT_FORMAT}）。内容已预置完整，导入时不调用 AI。
            </p>
            <input ref={input} type="file" accept=".json,application/json" hidden onChange={(e) => pick(e.target.files?.[0])} />
            {!loaded && (
              <button
                onClick={() => input.current?.click()}
                className="h-12 rounded-2xl border border-dashed border-line bg-surface text-[15px] text-ink"
              >
                选择 .json 文件
              </button>
            )}
            {error && <div className="rounded-xl bg-forgot-bg px-3.5 py-2.5 text-[13px] leading-relaxed text-forgot-fg">{error}</div>}

            {p && (
              <>
                <div className="rounded-2xl border border-line-soft bg-surface p-4">
                  <div className="font-serif text-xl">{p.pkg.title}</div>
                  <div className="mt-0.5 text-[13px] text-muted">
                    共 {p.cards.length} 张卡片
                    {p.invalid.length > 0 && `（另有 ${p.invalid.length} 条格式不完整，将被忽略）`}
                    {p.pkg.source_type && ` · ${p.pkg.source_type}`}
                  </div>
                  <div className="mt-3 flex flex-col divide-y divide-line-soft">
                    {p.cards.slice(0, 3).map((c) => (
                      <div key={c.text} className="py-2">
                        <div className="font-serif text-base">
                          {c.text} <span className="text-[13px] text-muted italic">{c.meta.ipa}</span>
                        </div>
                        <div className="text-[13px] text-muted">{c.meta.meaning}</div>
                        <div className="text-[13px] leading-snug text-muted-2">{c.meta.example}</div>
                      </div>
                    ))}
                  </div>
                </div>
                {busy ? (
                  <div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-line-soft">
                      <div className="h-1.5 rounded-full bg-accent transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
                    </div>
                    <div className="tabular mt-1.5 text-center text-xs text-muted">
                      导入中 {progress.done} / {progress.total}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2.5">
                    <button onClick={() => { setLoaded(null); setError(null) }} className="h-11 rounded-2xl border border-line bg-transparent text-[15px] text-ink">
                      重新选择
                    </button>
                    <button onClick={run} className="h-11 rounded-2xl border-0 bg-invert-bg text-[15px] text-invert-fg">
                      确认导入
                    </button>
                  </div>
                )}
              </>
            )}
            {!loaded && !busy && (
              <button onClick={onClose} className="h-10 border-0 bg-transparent text-[13px] text-muted">
                取消
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
