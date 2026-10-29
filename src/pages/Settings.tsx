import { useEffect, useState, type ReactNode } from 'react'
import { SETTINGS_CHANGED_EVENT, api, ttsUrl, type ApiToken, type Me } from '../api'
import { speak, speakSystem } from '../audio'
import {
  COACH_PROFILE_MAX,
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  OPENAI_MODELS,
  REVIEW_MODES,
  TEXT_MODELS,
  cleanOpenAiApiKey,
  isOpenAiApiKey,
  isOpenAiBaseUrl,
  isSafeId,
  normalizeOpenAiBaseUrl,
  type Settings as S,
} from '../../shared/settings'
import { openAiResumePath } from '../../shared/ai-failure'
import { LEVELS, type Level } from '../../shared/practice'
import { DAILY_GOALS, REMINDER_HOURS, RESCUE_HOUR } from '../../shared/streak'
import type { LevelStatus } from '../../shared/level'
import { LESSON_DOC_URL } from '../../shared/lesson-import'
import { disablePush, enablePush, pushState, type PushState } from '../push'
import { Link, asAppPath, navigate } from '../router'
import { reportAiFailure } from '../components/AiFailureDialog'
import { OPENAI_RESUME_EVENT, scheduleFinishOpenAiResume } from '../openai-retry'
import StorageCard from '../components/StorageCard'
import CostCard from '../components/CostCard'
import { MerriamWebsterLogo, confirmDialog, errMsg, toast } from '../components/ui'
import { IconBack, IconCheck, IconPlay, IconSparkle } from '../components/icons'

function engineLabel(cur: S) {
  if (cur.textProvider === 'openai') return `OpenAI · ${cur.openaiModel}`
  if (cur.textProvider === 'gemini') return `Gemini · ${cur.textModel}`
  return 'Cloudflare · Qwen3 30B A3B'
}

function openAiKeyHint(cur: S) {
  if (cur.openaiKeySource === 'user') return '已保存个人 key，这里不会显示原文。清除后，如果部署环境配了 OPENAI_API_KEY，会改用那一把。'
  if (cur.openaiKeySource === 'server') return '部署环境已经有 OPENAI_API_KEY。填写个人 key 后，优先用你自己的额度。'
  return '还没有 key。填在这里会存在这个账号；也可以由部署环境的 OPENAI_API_KEY 提供。'
}

export default function Settings() {
  const [cur, setCur] = useState<S | null>(null)
  const [defaults, setDefaults] = useState<S | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [level, setLevel] = useState<LevelStatus | null>(null)
  const [testing, setTesting] = useState<'text' | 'tts' | null>(null)
  const [cloudAudioReady, setCloudAudioReady] = useState(false)
  const [usageKey, setUsageKey] = useState(0)
  const [result, setResult] = useState<{ kind: 'text' | 'tts'; label: string; ms: number; detail: string } | null>(null)
  const [resumeArmed, setResumeArmed] = useState(false)
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiBase, setOpenaiBase] = useState('')
  const [savingOpenAi, setSavingOpenAi] = useState(false)

  useEffect(() => {
    api
      .settings()
      .then((r) => {
        setCur(r.current)
        setDefaults(r.defaults)
        setMe(r.me)
      })
      .catch((e) => toast(errMsg(e), 'error'))
    api
      .level()
      .then(setLevel)
      .catch(() => {})
  }, [])

  useEffect(() => {
    const sync = () => {
      try {
        setResumeArmed(!!openAiResumePath(sessionStorage))
      } catch {
        setResumeArmed(false)
      }
    }
    sync()
    window.addEventListener(OPENAI_RESUME_EVENT, sync)
    return () => window.removeEventListener(OPENAI_RESUME_EVENT, sync)
  }, [])

  useEffect(() => {
    const onChange = (event: Event) => {
      const next = (event as CustomEvent<S>).detail
      if (next?.textProvider) setCur(next)
    }
    window.addEventListener(SETTINGS_CHANGED_EVENT, onChange)
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, onChange)
  }, [])

  useEffect(() => {
    if (!cur) return
    setOpenaiBase(cur.openaiBaseUrl)
    if (!resumeArmed) return
    document.getElementById('openai-api-key')?.focus()
  }, [cur, resumeArmed])

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
      setResult({ kind: 'text', label: engineLabel(cur), ms: performance.now() - t0, detail: `${r.meta.pos} ${r.meta.meaning}` })
      setUsageKey((k) => k + 1)
    } catch (e) {
      if (!reportAiFailure(e, () => { void testText() })) toast(errMsg(e), 'error')
    } finally {
      setTesting(null)
    }
  }

  const sampleTts = 'Serendipity means finding something good without looking for it.'
  const testTts = async () => {
    if (!cur) return
    setTesting('tts')
    setCloudAudioReady(false)
    setResult(null)
    const t0 = performance.now()
    try {
      // This only checks the server and stores the generated audio in R2.
      // Do NOT play after await: iPhone Safari requires a fresh user gesture.
      const response = await fetch(ttsUrl(sampleTts), {
        credentials: 'same-origin',
        redirect: 'manual',
        signal: AbortSignal.timeout(45_000),
      })
      if (response.type === 'opaqueredirect') throw new Error('登录已失效，请重新打开拾句登录')
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        throw new Error('HTTP ' + response.status + '：' + (body?.error || 'MeloTTS 请求失败'))
      }
      const type = response.headers.get('content-type') || ''
      if (!type.startsWith('audio/')) throw new Error('服务器未返回音频（可能被登录页面重定向）')
      const buffer = await response.arrayBuffer()
      if (buffer.byteLength < 16) throw new Error('服务器返回的音频为空')
      setCloudAudioReady(true)
      setResult({ kind: 'tts', label: 'Cloudflare MeloTTS 云端检查成功',
        ms: performance.now() - t0,
        detail: '已返回 ' + type + '（' + buffer.byteLength + ' 字节）。请点击「播放云端测试音频」确认 Safari 可播放。' })
      setUsageKey((k) => k + 1)
    } catch (error) {
      setResult({ kind: 'tts', label: 'MeloTTS 云端检查失败',
        ms: performance.now() - t0,
        detail: error instanceof Error ? error.message : '未知网络错误' })
    } finally {
      setTesting(null)
    }
  }

  const playCloudTest = () => {
    const t0 = performance.now()
    speak(sampleTts, false, (engine) => {
      setResult({ kind: 'tts',
        label: engine === 'melo' ? 'Safari 云端音频播放成功' : 'Safari 使用系统朗读',
        ms: performance.now() - t0,
        detail: sampleTts })
    })
  }

  const saveOpenAiKey = async (value: string | null) => {
    if (!cur || savingOpenAi) return
    const cleaned = value === null ? null : cleanOpenAiApiKey(value)
    if (cleaned !== null && !isOpenAiApiKey(cleaned)) {
      toast('OpenAI API key 格式不对：不能有空格，长度 8 到 300', 'error')
      return
    }
    setSavingOpenAi(true)
    try {
      const r = await api.saveSettings({ openaiApiKey: cleaned })
      setCur(r.current)
      setOpenaiKey('')
      toast(cleaned ? 'OpenAI API key 已保存' : '已清除个人 OpenAI API key')
      if (!cleaned || !r.current.openaiKeySet) return
      let back: string | null = null
      try {
        back = openAiResumePath(sessionStorage)
      } catch {
        return
      }
      if (!back) return
      if (back === '/settings') {
        void testText()
        scheduleFinishOpenAiResume('/settings')
        return
      }
      const path = asAppPath(back)
      if (path) navigate(path)
      else scheduleFinishOpenAiResume(back)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSavingOpenAi(false)
    }
  }

  const saveOpenAiBase = async () => {
    const trimmed = openaiBase.trim()
    if (!trimmed) {
      await save('openaiBaseUrl', '', '已恢复默认 OpenAI 地址')
      return
    }
    if (!isOpenAiBaseUrl(trimmed)) {
      toast('OpenAI Base URL 必须是 https 地址（本机可用 http://localhost），不能带账号或查询参数', 'error')
      return
    }
    const normalized = normalizeOpenAiBaseUrl(trimmed)
    await save('openaiBaseUrl', normalized, `OpenAI 地址已保存`)
  }

  const testSystemVoice = () => {
    const t0 = performance.now()
    setResult({ kind: 'tts', label: '正在测试 Safari 系统朗读', ms: 0, detail: '如未发声，请点击页面下方的系统朗读按钮。' })
    speakSystem(sampleTts, false, () => {
      setResult({ kind: 'tts', label: 'Safari 系统朗读成功启动', ms: performance.now() - t0, detail: sampleTts })
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
        {resumeArmed && (
          <p className="mt-3 mb-0 rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-relaxed text-ink">
            保存 OpenAI API key 后，会自动回到刚才的页面再试一次。
          </p>
        )}
      </div>

      {!cur ? (
        <div className="mx-4 mt-5 h-64 md:mx-6 animate-shimmer rounded-2xl bg-surface" />
      ) : (
        <>
          <section className="mt-5 px-4 md:mt-6 md:px-6">
            <Link
              to="/weekly"
              className="flex h-12 items-center justify-between rounded-2xl border border-line-soft bg-surface px-4 text-[15px] text-ink no-underline"
            >
              每周回顾
              <span className="text-muted">›</span>
            </Link>
            <Link
              to="/level"
              className="mt-2 flex h-12 items-center justify-between rounded-2xl border border-line-soft bg-surface px-4 text-[15px] text-ink no-underline"
            >
              词汇评级
              <span className="text-[13px] text-muted">
                {level?.level ? `${level.level.id} · 约 ${level.vocab!.toLocaleString('zh-CN')} 词` : '测一测'} ›
              </span>
            </Link>
          </section>

          <Section title="复习方式" desc="产出：看中文情境说出英文表达，练的是“能说出来”">
            <div className="grid grid-cols-4 gap-1 rounded-[14px] bg-line-soft p-1" role="radiogroup" aria-label="复习方式">
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

          <Section title="每日目标" desc="复习满这么多张就算今天打卡；写一句练习也算。到期的卡不够时，复习完到期的就算">
            <div className="grid grid-cols-4 gap-1 rounded-[14px] bg-line-soft p-1" role="radiogroup" aria-label="每日目标">
              {DAILY_GOALS.map((g) => (
                <button
                  key={g.id}
                  role="radio"
                  aria-checked={cur.dailyGoal === g.id}
                  onClick={() => save('dailyGoal', g.id, `每日目标：${g.desc}`)}
                  className={`flex h-12 flex-col items-center justify-center rounded-[10px] border-0 text-sm ${
                    cur.dailyGoal === g.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
                  }`}
                >
                  {g.name}
                  <span className="tabular text-[11px] font-normal text-muted">{g.id} 张</span>
                </button>
              ))}
            </div>
          </Section>

          <Section title="每日提醒" desc="到点还没打卡就推送一条；有连续天数时，22 点再提醒一次">
            <Reminder hour={cur.reminderHour} onHour={(h) => save('reminderHour', h, h < 0 ? '已关闭每日提醒' : `每天 ${h}:00 提醒`)} />
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

          <Section title="教练设定" desc="默认是「入门日常阅读」。出题和批改都会参考这段话；想换成别的目标，直接改这里">
            <CoachProfile
              value={cur.coachProfile}
              isDefault={cur.coachProfile === defaults?.coachProfile}
              onSave={(v) => save('coachProfile', v, '教练设定已保存')}
              onReset={() => save('coachProfile', '', '已恢复默认设定')}
            />
          </Section>

          <Section title="文本 AI 引擎" desc="单选后立刻作用于下一次生成、批改、重组和闯关。后台自动补题仍走 Cloudflare。语音继续使用 MeloTTS。">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup" aria-label="文本 AI 提供商">
              {([
                { id: 'cloudflare', name: 'Qwen', note: 'Cloudflare 免费' },
                { id: 'gemini', name: 'Gemini', note: cur.textModel },
                { id: 'openai', name: 'OpenAI', note: cur.openaiModel },
              ] as const).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={cur.textProvider === p.id}
                  onClick={() => save('textProvider', p.id, `已切换为 ${p.name}`)}
                  className={`flex min-h-[76px] flex-col items-start justify-center gap-1 rounded-2xl border p-3.5 text-left ${cur.textProvider === p.id ? 'border-accent bg-accent-soft' : 'border-line-soft bg-surface'}`}
                >
                  <span className="flex w-full items-center justify-between text-[15px] font-semibold">
                    {p.name}
                    {cur.textProvider === p.id && <IconCheck size={16} />}
                  </span>
                  <span className="text-xs text-muted">{p.note}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 mb-0 text-[12px] leading-relaxed text-muted">
              默认是 Cloudflare Workers AI 的 Qwen3 30B A3B，用共享免费 Neurons 配额；Paid 计划超额可能计费。
              Qwen 失败不会自动改道。截图或打不开的链接需要 Gemini。
            </p>
          </Section>

          <Section
            title="OpenAI"
            desc={`默认模型 ${DEFAULT_OPENAI_MODEL}（当前最强旗舰，可在下面改）。默认地址 ${DEFAULT_OPENAI_BASE_URL}，可改成其它兼容 Chat Completions 的地址。结构化任务使用较低推理强度。个人 key 存在你的账号里，页面不会回显。`}
          >
            <form
              className="flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void saveOpenAiKey(openaiKey)
              }}
            >
              <label htmlFor="openai-api-key" className="text-xs text-muted">
                API key
              </label>
              <input
                id="openai-api-key"
                type="password"
                autoComplete="off"
                value={openaiKey}
                onChange={(event) => setOpenaiKey(event.target.value)}
                placeholder={cur.openaiKeySource === 'none' ? 'sk-…' : '留空表示不改；要换 key 就贴新的'}
                className="h-12 w-full rounded-2xl border border-line bg-surface px-4 font-mono text-sm text-ink outline-none placeholder:font-sans placeholder:text-faint focus:border-ink"
              />
              <p className="m-0 text-xs leading-relaxed text-muted">{openAiKeyHint(cur)}</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="submit"
                  disabled={savingOpenAi || !openaiKey.trim()}
                  className="h-11 rounded-2xl border-0 bg-invert-bg text-sm font-medium text-invert-fg disabled:opacity-40"
                >
                  保存 key
                </button>
                <button
                  type="button"
                  disabled={savingOpenAi || cur.openaiKeySource !== 'user'}
                  onClick={() => void saveOpenAiKey(null)}
                  className="h-11 rounded-2xl border border-line bg-surface text-sm text-ink disabled:opacity-40"
                >
                  清除个人 key
                </button>
              </div>
            </form>
            <div className="mt-4">
              <div className="mb-2 text-xs text-muted">模型 · 默认 {DEFAULT_OPENAI_MODEL}</div>
              <Options
                options={OPENAI_MODELS}
                value={cur.openaiModel}
                def={defaults?.openaiModel}
                onChange={(v) => save('openaiModel', v, `OpenAI 模型：${v}`)}
              />
              <Custom value={cur.openaiModel} known={OPENAI_MODELS} onSave={(v) => save('openaiModel', v, `OpenAI 模型：${v}`)} placeholder="其它 OpenAI 模型" />
            </div>
            <form
              className="mt-4 flex flex-col gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                void saveOpenAiBase()
              }}
            >
              <label htmlFor="openai-base-url" className="text-xs text-muted">
                Base URL · 默认 {DEFAULT_OPENAI_BASE_URL}
              </label>
              <input
                id="openai-base-url"
                value={openaiBase}
                onChange={(event) => setOpenaiBase(event.target.value)}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-12 w-full rounded-2xl border border-line bg-surface px-4 font-mono text-sm text-ink outline-none focus:border-ink"
              />
              <button type="submit" className="h-11 rounded-2xl border border-line bg-surface text-sm font-medium text-ink">
                保存地址
              </button>
            </form>
          </Section>

          <Section title="模型与语音" desc="显示当前实际文本引擎；发音统一使用 MeloTTS。">
            <div className="rounded-2xl border border-line-soft bg-surface px-4 py-3 text-[13px] leading-relaxed text-muted">
              文本 <span className="font-mono text-ink">{engineLabel(cur)}</span>
              <br />
              语音 <span className="font-mono text-ink">Cloudflare · MeloTTS (en)</span>
              <br />
              <span className="text-xs">慢速朗读为本地 0.75 倍速，额度不足时使用系统朗读；不会自动调用 Gemini TTS。</span>
            </div>
          </Section>

          {me?.admin && (
            <details className="group mt-5 px-4 md:mt-6 md:px-6">
              <summary className="flex h-11 cursor-pointer list-none items-center justify-between rounded-2xl border border-line-soft bg-surface px-4 text-[13px] text-muted-2 [&::-webkit-details-marker]:hidden">
                高级：Gemini 模型、文本与语音测试
                <span className="transition-transform group-open:rotate-90">›</span>
              </summary>
              <div className="-mx-4 md:-mx-6">
          <Section title="Gemini 备用模型" desc="仅当上方切换为 Gemini 时使用；免费模式不走这个模型">
            <Options
              options={TEXT_MODELS}
              value={cur.textModel}
              def={defaults?.textModel}
              onChange={(v) => save('textModel', v)}
            />
            <Custom value={cur.textModel} known={TEXT_MODELS} onSave={(v) => save('textModel', v)} placeholder="其他 Gemini 模型" />
          </Section>

          <Section title="语音模型" desc="当前试用统一使用 MeloTTS；Workers AI 的托管模型不支持切换 Gemini 音色。">
            <div className="rounded-2xl bg-chip p-3.5 text-[13px] text-muted">
              语音生成走 Cloudflare Workers AI，共享每天 10,000 Neurons 免费配额。
              本站另设每日新语音段数上限；在 Workers Paid 计划中，超过 Cloudflare 免费配额仍可能计费，请在 Cloudflare 控制台检查实际 Neurons 用量。
            </div>
          </Section>
          <Section title="测试" desc="先检查 MeloTTS 云端返回的真实音频格式，再手动点击试听（适配 iPhone Safari）；也可单独测试系统朗读。">
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
            <div className="mt-2 grid grid-cols-2 gap-2.5">
              <button
                onClick={playCloudTest}
                disabled={!cloudAudioReady}
                className="flex h-11 items-center justify-center rounded-xl border border-line bg-surface text-[13px] font-medium text-ink disabled:opacity-40"
              >
                播放云端测试音频
              </button>
              <button
                onClick={testSystemVoice}
                className="flex h-11 items-center justify-center rounded-xl border border-line bg-surface text-[13px] font-medium text-ink"
              >
                测试 Safari 系统朗读
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
              </div>
            </details>
          )}
        </>
      )}

      <Section title="API 令牌" desc="让脚本、快捷指令或 AI 助手按 shiju-lesson-v1 格式把文章（和整理好的练习、闯关题）直接传进来">
        <ApiTokens />
      </Section>

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

/** 个人令牌：明文只在创建时显示一次 */
function ApiTokens() {
  const [list, setList] = useState<ApiToken[] | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () =>
    api
      .tokens()
      .then((r) => setList(r.tokens))
      .catch((e) => toast(errMsg(e), 'error'))
  useEffect(() => {
    load()
  }, [])
  const create = async () => {
    setBusy(true)
    try {
      const r = await api.createToken(name.trim() || '未命名')
      setCreated(r.token)
      setName('')
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const remove = async (t: ApiToken) => {
    if (!(await confirmDialog(`删除令牌「${t.name}」？用它的脚本会立刻失效。`, { ok: '删除', danger: true }))) return
    try {
      await api.deleteToken(t.id)
      load()
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }
  const curl = created
    ? `curl -X POST ${location.origin}/api/ext/lessons \\\n  -H "Authorization: Bearer ${created}" \\\n  -H "Content-Type: application/json" \\\n  -d @lesson.json`
    : ''
  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast('已复制'))
      .catch(() => toast('复制失败，长按手动复制', 'error'))
  return (
    <div className="flex flex-col gap-2.5">
      {created && (
        <div className="animate-rise rounded-2xl border border-accent bg-surface p-4">
          <div className="text-[13px] font-semibold text-ink">令牌已创建，只显示这一次，请现在保存</div>
          <div className="mt-2 flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-chip px-2.5 py-2 text-[12px] text-ink">{created}</code>
            <button onClick={() => copy(created)} className="h-9 shrink-0 rounded-xl border border-line bg-transparent px-3 text-[13px] text-ink">
              复制
            </button>
          </div>
          <div className="mt-3 text-xs text-muted">调用示例（lesson.json 的格式见文档）：</div>
          <pre className="mt-1 overflow-x-auto rounded-lg bg-chip p-2.5 text-[11px] leading-relaxed text-ink">{curl}</pre>
          <div className="mt-2 flex items-center gap-3 text-xs">
            <button onClick={() => copy(curl)} className="border-0 bg-transparent p-0 text-accent">
              复制命令
            </button>
            <a href={LESSON_DOC_URL} target="_blank" rel="noreferrer" className="text-accent">
              格式文档
            </a>
            <span className="flex-1" />
            <button onClick={() => setCreated(null)} className="border-0 bg-transparent p-0 text-muted">
              我已保存
            </button>
          </div>
          <p className="mt-2 mb-0 text-xs leading-relaxed text-muted">从外部调用前，需要在 Cloudflare Access 里给 /api/ext 放行，步骤见部署文档。</p>
        </div>
      )}
      {list && list.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface">
          {list.map((t, i) => (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-2.5 ${i ? 'border-t border-solid border-line-soft' : ''}`}>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[14px] text-ink">{t.name}</span>
                <span className="truncate text-xs text-muted">
                  {t.prefix}… · {t.last_used_at ? `最近使用 ${new Date(t.last_used_at).toLocaleDateString('zh-CN')}` : '还没用过'}
                </span>
              </span>
              <button onClick={() => remove(t)} className="h-8 rounded-lg border border-line bg-transparent px-2.5 text-xs text-muted">
                删除
              </button>
            </div>
          ))}
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          create()
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 40))}
          placeholder="令牌名称，如「快捷指令」"
          aria-label="令牌名称"
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3.5 text-[14px] text-ink outline-none placeholder:text-faint focus:border-muted"
        />
        <button type="submit" disabled={busy} className="h-11 rounded-xl border-0 bg-invert-bg px-4 text-sm text-invert-fg disabled:opacity-40">
          创建令牌
        </button>
      </form>
    </div>
  )
}

/** 每日提醒：这台设备的推送开关 + 提醒钟点（钟点跟着账号走，开关跟着设备走） */
function Reminder({ hour, onHour }: { hour: number; onHour: (h: number) => void }) {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    pushState()
      .then(setState)
      .catch(() => setState('unsupported'))
  }, [])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setBusy(false)
    }
  }
  const toggle = () =>
    run(async () => {
      if (state === 'on') {
        setState(await disablePush())
        toast('这台设备不再提醒')
        return
      }
      const next = await enablePush()
      setState(next)
      if (next === 'on') {
        if (hour < 0) onHour(20)
        toast('已开启，可以点「发一条试试」', 'success')
      } else if (next === 'denied') toast('通知权限被拒绝了，需要到系统设置里允许', 'error')
    })
  const test = () =>
    run(async () => {
      const r = await api.pushTest()
      if (r.note) toast(`发出 ${r.sent} 条，另有 ${r.failed} 台设备失败：${r.note}`, 'error')
      else toast('已发送，几秒内会收到')
    })

  if (!state) return <div className="h-14 animate-shimmer rounded-2xl bg-surface" />
  const hint =
    state === 'needs-install'
      ? 'iPhone / iPad 需要先在 Safari 里「分享 → 添加到主屏幕」，再从主屏幕图标打开拾句，才能开启提醒。'
      : state === 'unsupported'
        ? '这个浏览器不支持推送通知。'
        : state === 'denied'
          ? '通知权限被关掉了：到系统设置（或浏览器的网站设置）里允许拾句发送通知，再回来打开。'
          : null
  const on = state === 'on'
  return (
    <div className="overflow-hidden rounded-2xl border border-line-soft bg-surface">
      <div className="flex min-h-14 items-center gap-3 px-4 py-2.5">
        <span className="flex flex-1 flex-col gap-0.5">
          <span className="text-[15px] font-medium text-ink">在这台设备上提醒我</span>
          <span className="text-xs text-muted">{on ? '通知会带上连续天数和今天还差几张' : hint ?? '只在今天还没打卡时提醒'}</span>
        </span>
        <button
          role="switch"
          aria-checked={on}
          aria-label="每日提醒"
          disabled={busy || !!hint}
          onClick={toggle}
          className={`relative h-7 w-12 shrink-0 rounded-full border-0 transition-colors disabled:opacity-40 ${on ? 'bg-accent' : 'bg-line'}`}
        >
          <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-surface shadow-sm transition-[left] ${on ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      {on && (
        <div className="flex items-center gap-2 border-t border-solid border-line-soft px-4 py-2.5">
          <label className="flex flex-1 items-center gap-2 text-[13px] text-muted-2">
            每天
            <select
              value={hour}
              onChange={(e) => onHour(Number(e.target.value))}
              className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink"
            >
              {REMINDER_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h}:00
                </option>
              ))}
              <option value={-1}>暂停提醒</option>
            </select>
            {hour >= 0 && hour < RESCUE_HOUR && <span className="text-xs text-faint">· 没打卡 22:00 再提醒</span>}
          </label>
          <button onClick={test} disabled={busy} className="h-9 rounded-xl border border-line bg-transparent px-3 text-[13px] text-ink disabled:opacity-40">
            发一条试试
          </button>
        </div>
      )}
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
