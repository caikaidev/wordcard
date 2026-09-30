import { useEffect, useState, type ReactNode } from 'react'
import { api, type Me } from '../api'
import { speak } from '../audio'
import { COACH_PROFILE_MAX, REVIEW_MODES, TEXT_MODELS, TTS_MODELS, VOICES, isSafeId, type Settings as S } from '../../shared/settings'
import { LEVELS, type Level } from '../../shared/practice'
import { Link } from '../router'
import StorageCard from '../components/StorageCard'
import CostCard from '../components/CostCard'
import { MerriamWebsterLogo, errMsg, toast } from '../components/ui'
import { IconBack, IconCheck, IconPlay, IconSparkle } from '../components/icons'

export default function Settings() {
  const [cur, setCur] = useState<S | null>(null)
  const [defaults, setDefaults] = useState<S | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [testing, setTesting] = useState<'text' | 'tts' | null>(null)
  const [usageKey, setUsageKey] = useState(0)
  const [result, setResult] = useState<{ kind: 'text' | 'tts'; label: string; ms: number; detail: string } | null>(null)

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setCur(r.current)
        setDefaults(r.defaults)
        setMe(r.me)
      })
      .catch((e) => toast(errMsg(e), 'error'))
  }, [])

  const save = async (key: keyof S, value: string | number, label = `已切换到 ${value}`) => {
    if (!cur || cur[key] === value) return
    const prev = cur
    setCur({ ...cur, [key]: value } as S)
    try {
      const r = await api.saveSettings({ [key]: key !== 'practiceLevel' && value === defaults?.[key] ? null : value })
      setCur(r.current)
      setResult(null)
      toast(label)
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
      setUsageKey((k) => k + 1)
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
      setUsageKey((k) => k + 1)
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
        <div className="text-[13px] tracking-wide text-muted">
          {me ? (
            <>
              {me.email}
              <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${me.admin ? 'bg-accent-soft text-accent' : 'bg-chip text-muted-2'}`}>
                {me.admin ? '管理员' : '成员'}
              </span>
            </>
          ) : (
            '复习 · 练习 · 模型 · 费用'
          )}
        </div>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">设置</h1>
      </div>

      {!cur ? (
        <div className="mx-4 mt-5 h-64 md:mx-6 animate-shimmer rounded-2xl bg-surface" />
      ) : (
        <>
          <Section title="复习方式" desc="产出：看中文情境说出英文表达，练的是“能说出来”">
            <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-line-soft p-1" role="radiogroup" aria-label="复习方式">
              {REVIEW_MODES.map((m) => (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={cur.reviewMode === m.id}
                  onClick={() => save('reviewMode', m.id, `复习方式：${m.name}`)}
                  className={`h-10 rounded-[10px] border-0 text-sm ${
                    cur.reviewMode === m.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
                  }`}
                >
                  {m.name}
                </button>
              ))}
            </div>
            <p className="mt-1.5 mb-0 text-xs leading-relaxed text-muted">
              {REVIEW_MODES.find((m) => m.id === cur.reviewMode)?.desc}
            </p>
          </Section>

          <Section title="练习档位" desc="新建练习时的默认档位，每次新建时也可以临时切换">
            <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface" role="radiogroup">
              {LEVELS.map((l, i) => {
                const on = cur.practiceLevel === l.id
                return (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={on}
                    onClick={() => save('practiceLevel', l.id as Level, `默认档位：${l.name}`)}
                    className={`flex w-full items-start gap-3 border-0 bg-transparent px-4 py-3 text-left ${
                      i ? 'border-t border-solid border-line-soft' : ''
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                        on ? 'border-accent bg-accent text-on-accent' : 'border-faint'
                      }`}
                    >
                      {on && <IconCheck size={12} />}
                    </span>
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[15px] font-medium text-ink">{l.name}</span>
                      <span className="text-xs leading-relaxed text-muted">{l.desc}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </Section>

          <Section title="教练设定" desc="你的背景、目标和原则。出题和批改都会参考这段话，写得越具体，练习越贴合你">
            <CoachProfile
              value={cur.coachProfile}
              isDefault={cur.coachProfile === defaults?.coachProfile}
              onSave={(v) => save('coachProfile', v, '教练设定已保存')}
              onReset={() => save('coachProfile', '', '已恢复默认设定')}
            />
          </Section>

          {me?.admin ? (
            <>
          <Section title="文本模型" desc="用于生成练习、批改、AI 补全和 AI 重组">
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
            </>
          ) : (
            <Section title="模型与音色" desc="全站共用，由管理员统一设置">
              <div className="rounded-2xl border border-line-soft bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
                文本 <span className="font-mono text-ink">{cur.textModel}</span>
                <br />
                语音 <span className="font-mono text-ink">{cur.ttsModel}</span> · {cur.voice}
              </div>
            </Section>
          )}

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

      <div className="mt-6 px-4 text-[13px] font-semibold text-ink md:px-6">词典来源</div>
      <section className="mx-4 mt-2.5 flex items-center gap-4 rounded-2xl border border-line-soft bg-surface p-4 md:mx-6">
        <MerriamWebsterLogo size={50} />
        <p className="m-0 flex-1 text-[13px] leading-relaxed text-muted">
          英英释义来自{' '}
          <a href="https://www.merriam-webster.com/" target="_blank" rel="noreferrer" className="text-accent">
            Merriam-Webster&apos;s Collegiate® Dictionary
          </a>
          ，查不到的词使用{' '}
          <a href="https://en.wiktionary.org/" target="_blank" rel="noreferrer" className="text-accent">
            Wiktionary
          </a>{' '}
          数据。中文释义、例句和练习由 AI 生成，重要表达请以词典为准。
        </p>
      </section>

      <div className="mt-6 px-4 text-[13px] font-semibold text-ink md:px-6">费用</div>
      <CostCard refreshKey={usageKey} />

      {me?.admin && <div className="mt-6 px-4 text-[13px] font-semibold text-ink md:px-6">存储</div>}
      {me?.admin && <StorageCard />}
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

function CoachProfile({
  value,
  isDefault,
  onSave,
  onReset,
}: {
  value: string
  isDefault: boolean
  onSave: (v: string) => void
  onReset: () => void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const dirty = text.trim() !== value.trim()
  return (
    <div className="flex flex-col gap-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, COACH_PROFILE_MAX))}
        rows={9}
        aria-label="教练设定"
        className="w-full resize-y rounded-2xl border border-line bg-surface px-4 py-3 text-[14px] leading-relaxed text-ink outline-none focus:border-muted"
      />
      <div className="flex items-center gap-2">
        <span className="tabular flex-1 text-xs text-faint">
          {text.length} / {COACH_PROFILE_MAX}
          {isDefault && ' · 当前是默认设定'}
        </span>
        {!isDefault && (
          <button onClick={onReset} className="h-10 rounded-xl border border-line bg-transparent px-3.5 text-[13px] text-muted">
            恢复默认
          </button>
        )}
        <button
          onClick={() => onSave(text)}
          disabled={!dirty || !text.trim()}
          className="h-10 rounded-xl border-0 bg-invert-bg px-4 text-[13px] text-invert-fg disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </div>
  )
}
