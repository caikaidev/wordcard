import { useEffect, useState, type ReactNode } from 'react'
import { api } from '../api'
import { speak } from '../audio'
import { TEXT_MODELS, TTS_MODELS, VOICES, isSafeId, type Settings as S } from '../../shared/settings'
import { Link } from '../router'
import StorageCard from '../components/StorageCard'
import { errMsg, toast } from '../components/ui'
import { IconBack, IconCheck, IconPlay, IconSparkle } from '../components/icons'

export default function Settings() {
  const [cur, setCur] = useState<S | null>(null)
  const [defaults, setDefaults] = useState<S | null>(null)
  const [testing, setTesting] = useState<'text' | 'tts' | null>(null)
  const [result, setResult] = useState<{ kind: 'text' | 'tts'; label: string; ms: number; detail: string } | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setCur(r.current)
        setDefaults(r.defaults)
      })
      .catch((e) => toast(errMsg(e), 'error'))
  }, [])

  const save = async (key: keyof S, value: string) => {
    if (!cur || cur[key] === value) return
    const prev = cur
    setCur({ ...cur, [key]: value })
    try {
      const r = await api.saveSettings({ [key]: value === defaults?.[key] ? null : value })
      setCur(r.current)
      setResult(null)
      toast(`已切换到 ${value}`)
    } catch (e) {
      setCur(prev)
      toast(errMsg(e), 'error')
    }
  }

  const testText = async () => {
    if (!cur) return
    setTesting('text')
    const t0 = performance.now()
    try {
      const r = await api.enrich('serendipity')
      setResult({ kind: 'text', label: cur.textModel, ms: performance.now() - t0, detail: `${r.meta.pos} ${r.meta.meaning}` })
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setTesting(null)
    }
  }

  const testTts = () => {
    if (!cur) return
    setTesting('tts')
    const sample = `Hi, I'm ${cur.voice}. Serendipity means finding something good without looking for it.`
    const t0 = performance.now()
    let started = false
    speak(sample, false, () => {
      started = true
      setTesting(null)
      setResult({ kind: 'tts', label: `${cur.ttsModel} · ${cur.voice}`, ms: performance.now() - t0, detail: sample })
    }).then((ok) => {
      if (!started) {
        setTesting(null)
        if (!ok) toast('语音生成失败，换个模型或音色试试', 'error')
      }
    })
  }

  return (
    <div className="pt-safe flex flex-1 flex-col pb-10 md:pt-8">
      <div className="flex items-center px-2 md:px-6">
        <Link to="/library" aria-label="返回词库" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
      </div>
      <div className="px-4 pt-1 md:px-6">
        <div className="text-[13px] tracking-wide text-muted">模型 · 语音 · 存储</div>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">设置</h1>
      </div>

      {!cur ? (
        <div className="mx-4 mt-5 h-64 md:mx-6 animate-shimmer rounded-2xl bg-surface" />
      ) : (
        <>
          <Section title="文本模型" desc="用于 AI 补全和 AI 重组">
            <Options
              options={TEXT_MODELS}
              value={cur.textModel}
              def={defaults?.textModel}
              onChange={(v) => save('textModel', v)}
            />
            <Custom value={cur.textModel} known={TEXT_MODELS} onSave={(v) => save('textModel', v)} placeholder="其他模型，如 gemini-3.9-flash" />
          </Section>

          <Section title="语音模型" desc="切换后新生成的语音使用新模型，旧缓存保留">
            <Options options={TTS_MODELS} value={cur.ttsModel} def={defaults?.ttsModel} onChange={(v) => save('ttsModel', v)} />
            <Custom value={cur.ttsModel} known={TTS_MODELS} onSave={(v) => save('ttsModel', v)} placeholder="其他语音模型" />
          </Section>

          <Section title="音色">
            <div className="grid grid-cols-2 gap-2">
              {VOICES.map((v) => {
                const on = cur.voice === v.id
                return (
                  <button
                    key={v.id}
                    onClick={() => save('voice', v.id)}
                    aria-pressed={on}
                    className={`flex h-14 flex-col items-start justify-center rounded-2xl border px-3.5 text-left ${
                      on ? 'border-ink bg-surface' : 'border-line-soft bg-surface'
                    }`}
                  >
                    <span className="flex w-full items-center justify-between text-[15px] font-medium text-ink">
                      {v.id}
                      {on && <IconCheck size={16} className="text-accent" />}
                    </span>
                    <span className="text-xs text-muted">{v.note}</span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="测试" desc="用当前设置跑一次，看看速度和效果。同一段语音第二次会命中缓存。">
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={testText}
                disabled={!!testing}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface text-sm font-medium text-ink disabled:opacity-50"
              >
                <IconSparkle size={16} />
                {testing === 'text' ? '生成中…' : '测试文本'}
              </button>
              <button
                onClick={testTts}
                disabled={!!testing}
                className="flex h-12 items-center justify-center gap-2 rounded-2xl border-0 bg-invert-bg text-sm font-medium text-invert-fg disabled:opacity-50"
              >
                <IconPlay size={16} />
                {testing === 'tts' ? '生成中…' : '测试语音'}
              </button>
            </div>
            {result && (
              <div className="mt-3 animate-rise rounded-2xl bg-chip px-4 py-3 text-[13px] leading-relaxed">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-medium text-ink">{result.label}</span>
                  <span className="tabular shrink-0 font-semibold text-accent">{(result.ms / 1000).toFixed(1)} 秒</span>
                </div>
                <div className="mt-1 text-muted">{result.detail}</div>
              </div>
            )}
          </Section>
        </>
      )}

      <div className="mt-6 px-4 text-[13px] font-semibold text-ink md:px-6">存储</div>
      <StorageCard />
    </div>
  )
}

function Section({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <section className="mt-5 px-4 md:mt-6 md:px-6">
      <h2 className="m-0 text-[13px] font-semibold">{title}</h2>
      {desc && <p className="mt-0.5 mb-0 text-xs text-muted">{desc}</p>}
      <div className="mt-2.5">{children}</div>
    </section>
  )
}

function Options({
  options,
  value,
  def,
  onChange,
}: {
  options: { id: string; note: string }[]
  value: string
  def?: string
  onChange: (v: string) => void
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface" role="radiogroup">
      {options.map((o, i) => {
        const on = o.id === value
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.id)}
            className={`flex min-h-12 w-full items-center gap-3 border-0 bg-transparent px-4 py-2.5 text-left ${
              i ? 'border-t border-solid border-line-soft' : ''
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                on ? 'border-accent bg-accent text-on-accent' : 'border-faint'
              }`}
            >
              {on && <IconCheck size={12} />}
            </span>
            <span className="flex-1 font-mono text-[14px] text-ink">{o.id}</span>
            <span className="text-xs text-muted">
              {o.note}
              {o.id === def && (o.note ? ' · 默认' : '默认')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 列表里没有的新模型，可以手动输入 */
function Custom({
  value,
  known,
  onSave,
  placeholder,
}: {
  value: string
  known: { id: string }[]
  onSave: (v: string) => void
  placeholder: string
}) {
  const isCustom = !known.some((k) => k.id === value)
  const [text, setText] = useState(isCustom ? value : '')
  const valid = isSafeId(text.trim())
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (valid) onSave(text.trim())
      }}
    >
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        className={`h-11 min-w-0 flex-1 rounded-xl border bg-surface px-3.5 font-mono text-[13px] text-ink outline-none placeholder:font-sans placeholder:text-faint ${
          isCustom ? 'border-accent' : 'border-line'
        }`}
      />
      <button
        type="submit"
        disabled={!valid || text.trim() === value}
        className="h-11 rounded-xl border-0 bg-invert-bg px-4 text-sm text-invert-fg disabled:opacity-40"
      >
        使用
      </button>
    </form>
  )
}
