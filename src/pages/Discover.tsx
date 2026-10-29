import { useEffect, useState } from 'react'
import { api } from '../api'
import { DEFAULT_SOURCES, VOCAB_LEVELS, discoverArticles, formatSources, parseSources, sourceLabel, type Discovery, type DiscoverArticle, type DiscoverReport } from '../../shared/discover'
import type { Settings } from '../../shared/settings'
import type { LevelStatus } from '../../shared/level'
import { Link } from '../router'
import { refreshStats } from '../store'
import { GlossSpan } from '../components/GlossText'
import { WaitProgress, confirmDialog, errMsg, toast } from '../components/ui'
import { IconBack, IconSparkle } from '../components/icons'

/** 发现新词：从 HN / Reddit 最近的讨论里，挑出你还没学、又经常出现的词 */
export default function Discover() {
  const [items, setItems] = useState<Discovery[] | null>(null)
  const [redditAuth, setRedditAuth] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<DiscoverReport | null>(null)
  const [busy, setBusy] = useState<Set<number>>(new Set())
  const [level, setLevel] = useState<LevelStatus | null>(null)

  const load = () =>
    api
      .discoveries()
      .then((r) => {
        setItems(r.items)
        setRedditAuth(r.redditAuth)
      })
      .catch((e) => toast(errMsg(e), 'error'))

  useEffect(() => {
    load()
    api
      .settings()
      .then((r) => setSettings(r.current))
      .catch(() => {})
    api
      .level()
      .then(setLevel)
      .catch(() => {})
  }, [])

  const save = async (patch: Partial<Record<keyof Settings, string | number | null>>, label: string) => {
    try {
      const r = await api.saveSettings(patch)
      setSettings(r.current)
      toast(label)
    } catch (e) {
      toast(errMsg(e), 'error')
    }
  }

  const run = async () => {
    setRunning(true)
    setReport(null)
    try {
      const r = await api.runDiscover()
      setReport(r.report)
      await load()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setRunning(false)
    }
  }

  /** 学 / 认识：先从列表里拿掉，失败再放回来 */
  const act = async (ids: number[], kind: 'learn' | 'know') => {
    if (!items || !ids.length) return
    const prev = items
    setBusy((s) => new Set([...s, ...ids]))
    setItems(items.filter((d) => !ids.includes(d.id)))
    try {
      if (kind === 'learn') {
        const { added } = await api.learnDiscoveries(ids)
        toast(ids.length > 1 ? `已加入复习 ${added} 个` : '已加入复习', 'success')
        refreshStats()
      } else {
        await api.knowDiscoveries(ids)
        toast(ids.length > 1 ? `已跳过 ${ids.length} 个，以后不再推荐` : '好，以后不再推荐这个词')
      }
    } catch (e) {
      setItems(prev)
      toast(errMsg(e), 'error')
    } finally {
      setBusy((s) => new Set([...s].filter((x) => !ids.includes(x))))
    }
  }

  const sources = settings ? parseSources(settings.discoverSources) : []

  return (
    <div className="pt-safe flex flex-1 flex-col pb-10 md:pt-8">
      <div className="flex items-center px-2 md:px-6">
        <Link to="/add" aria-label="返回添加" className="-ml-1 flex h-11 w-11 items-center justify-center text-ink md:-ml-3">
          <IconBack size={22} />
        </Link>
      </div>
      <div className="px-4 pt-1 md:px-6">
        <div className="text-[13px] tracking-wide text-muted">HN · Reddit 上反复出现、你还没学的词</div>
        <h1 className="m-0 mt-1 text-2xl font-semibold tracking-tight">发现新词</h1>
        <p className="mt-1 mb-0 text-xs leading-relaxed text-muted">结果是含这些词的短文。先读，点词再决定要不要加入复习。</p>
      </div>

      <section className="mx-4 mt-5 flex flex-col gap-3.5 rounded-2xl border border-line-soft bg-surface p-4 md:mx-6">
        {!settings ? (
          <div className="h-28 animate-shimmer rounded-xl bg-line-soft" />
        ) : (
          <>
            <SourcesField value={settings.discoverSources} onSave={(v) => save({ discoverSources: v || null }, '来源已保存')} />
            {!redditAuth && !report && sources.some((s) => s.kind === 'reddit') && (
              <p className="m-0 -mt-2 text-xs leading-relaxed text-muted">
                Reddit 经常拒绝来自云服务器的请求；读不到的话，让管理员按部署文档配置 Reddit 应用。
              </p>
            )}
            <div>
              <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs text-muted">
                <span>我大概认识多少词（比这更常见的词不推荐）</span>
                <Link to="/level" className="shrink-0 text-accent no-underline">
                  {level?.level ? `评级 ${level.level.id} · 约 ${level.vocab!.toLocaleString('zh-CN')} 词` : '测一测 ›'}
                </Link>
              </div>
              <div className="grid grid-cols-5 gap-1 rounded-[14px] bg-line-soft p-1" role="radiogroup" aria-label="词汇量">
                {VOCAB_LEVELS.map((l) => (
                  <button
                    key={l.id}
                    role="radio"
                    aria-checked={settings.vocabLevel === l.id}
                    title={l.desc}
                    onClick={() => settings.vocabLevel !== l.id && save({ vocabLevel: l.id }, `词汇量：约 ${l.name}（${l.desc}）`)}
                    className={`h-9 rounded-[10px] border-0 text-sm ${
                      settings.vocabLevel === l.id ? 'bg-surface font-semibold text-ink shadow-sm' : 'bg-transparent text-muted-2'
                    }`}
                  >
                    {l.name}
                  </button>
                ))}
              </div>
            </div>
            <label className="flex items-center gap-3">
                <span className="flex flex-1 flex-col gap-0.5">
                <span className="text-[14px] text-ink">自动加入复习（可选）</span>
                <span className="text-xs text-muted">默认先读短文再决定。打开后，早上找到的词会直接进词库</span>
              </span>
              <input
                type="checkbox"
                role="switch"
                checked={settings.discoverAuto}
                onChange={(e) => save({ discoverAuto: e.target.checked ? 1 : null }, e.target.checked ? '已开启：每天早上自动加入新词' : '已关闭自动加入')}
                className="h-5 w-5 accent-[var(--accent)]"
              />
            </label>
          </>
        )}
        {running ? (
          <WaitProgress
            timeout={120}
            slowAfter={45}
            stages={[
              [0, `正在读 ${sources.map(sourceLabel).join('、') || '讨论'}…`],
              [6, '统计哪些词出现得最多…'],
              [10, 'AI 正在按你的教练设定挑词…'],
            ]}
          />
        ) : (
          <button
            onClick={run}
            disabled={!settings}
            className="flex h-12 items-center justify-center gap-2 rounded-[14px] border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-50"
          >
            <IconSparkle size={18} /> 找一批新词
          </button>
        )}
        {report && <ReportLine report={report} />}
      </section>

      {!items ? (
        <div className="mx-4 mt-5 h-40 animate-shimmer rounded-2xl bg-surface md:mx-6" />
      ) : items.length === 0 ? (
        <p className="mx-4 mt-6 text-sm leading-relaxed text-muted md:mx-6">
          {report ? '' : '还没有待看的短文。点上面的按钮，从最近的讨论里找一批。'}
        </p>
      ) : (
        <>
          <div className="mx-4 mt-6 mb-2 flex items-baseline justify-between md:mx-6">
            <h2 className="m-0 text-[13px] font-semibold">含这些词的短文 {discoverArticles(items).length} 篇</h2>
            <span className="text-xs text-muted">先读，再决定学不学</span>
          </div>
          <div className="mx-4 flex flex-col gap-2.5 md:mx-6">
            {discoverArticles(items).map((article) => (
              <ArticleCard
                key={article.key}
                article={article}
                busy={busy}
                onLearn={(id) => act([id], 'learn')}
                onKnow={(id) => act([id], 'know')}
                onLearnAll={() => act(article.words.map((d) => d.id), 'learn')}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function SourcesField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const parsed = parseSources(text)
  const dirty = formatSources(parsed) !== formatSources(parseSources(value))
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (parsed.length && dirty) onSave(formatSources(parsed))
      }}
    >
      <label htmlFor="sources" className="mb-1.5 block text-xs text-muted">
        来源：hn 是 Hacker News，r/版块名 是 Reddit，最多 5 个
      </label>
      <div className="flex gap-2">
        <input
          id="sources"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={DEFAULT_SOURCES}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3.5 text-[14px] text-ink outline-none focus:border-muted"
        />
        <button
          type="submit"
          disabled={!parsed.length || !dirty}
          className="h-11 rounded-xl border-0 bg-invert-bg px-4 text-sm text-invert-fg disabled:opacity-40"
        >
          保存
        </button>
      </div>
    </form>
  )
}

function ReportLine({ report }: { report: DiscoverReport }) {
  const read = report.sources.filter((s) => !s.error)
  const failed = report.sources.filter((s) => s.error)
  return (
    <div className="flex flex-col gap-1 text-xs leading-relaxed text-muted">
      {read.length > 0 && (
        <span>
          读了 {read.map((s) => `${s.label} ${s.docs} 条`).join('、')}，
          {report.added
            ? report.passage
              ? `挑出 ${report.added} 个词，写成 1 篇短文。`
              : `挑出 ${report.added} 个词。这批没写成连贯短文，先把原句收成卡片。`
            : report.candidates
              ? 'AI 觉得这批里没有特别值得学的，过一阵再来。'
              : '没找到你没学过的高频词，过一阵再来。'}
        </span>
      )}
      {failed.map((s) => (
        <span key={s.label} className="text-forgot-fg">
          {s.label}：{s.error}
        </span>
      ))}
    </div>
  )
}

function glossForms(article: DiscoverArticle) {
  const forms: { form: string; word: Discovery }[] = []
  const lower = article.en.toLowerCase()
  for (const word of article.words) {
    const candidates = [word.meta.highlight, word.text].map((s) => s.trim()).filter(Boolean)
    const form = candidates.find((c) => lower.includes(c.toLowerCase()))
    if (form) forms.push({ form, word })
  }
  return forms
}

function ArticleCard({
  article,
  busy,
  onLearn,
  onKnow,
  onLearnAll,
}: {
  article: DiscoverArticle
  busy: Set<number>
  onLearn: (id: number) => void
  onKnow: (id: number) => void
  onLearnAll: () => void
}) {
  const [showZh, setShowZh] = useState(false)
  const [pickedId, setPickedId] = useState<number | null>(null)
  const forms = glossForms(article)
  const hit = article.words.find((word) => word.id === pickedId) ?? null
  const inText = new Set(forms.map((f) => f.word.id))
  const missing = article.words.filter((word) => !inText.has(word.id))
  const sources = [...new Set(article.words.map((w) => w.source))].join(' · ')
  return (
    <article className="rounded-2xl border border-line-soft bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted">{article.composed ? '连贯短文' : '原帖句子'}{sources ? ` · ${sources}` : ''}</div>
          <h3 className="m-0 mt-0.5 font-serif text-[18px] leading-snug">{article.title}</h3>
        </div>
        <button
          type="button"
          onClick={() => setShowZh((v) => !v)}
          className="h-8 shrink-0 rounded-full border border-line bg-transparent px-3 text-[12px] text-ink"
        >
          {showZh ? '隐藏中文' : '显示中文'}
        </button>
      </div>
      {article.en ? (
        <p className="mt-3 mb-0 font-serif text-[16px] leading-relaxed text-ink">
          <GlossSpan
            text={article.en}
            forms={forms.map((f) => f.form)}
            active={hit ? forms.find((f) => f.word.id === hit.id)?.form ?? null : null}
            onPick={(form) => {
              const word = forms.find((f) => f.form.toLowerCase() === form.toLowerCase())?.word
              if (word) setPickedId(word.id)
            }}
          />
        </p>
      ) : (
        <p className="mt-3 mb-0 text-sm text-muted">这批还没有能读的正文。</p>
      )}
      {!article.composed && <p className="mt-2 mb-0 text-xs leading-relaxed text-faint">再找一批时，会写成一篇连贯短文。现在先读这些原句。</p>}
      {showZh && article.zh && <p className="mt-2 mb-0 text-[13px] leading-relaxed text-muted">{article.zh}</p>}
      {missing.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {missing.map((word) => (
            <button
              key={word.id}
              type="button"
              onClick={() => setPickedId(word.id)}
              className="rounded-lg border border-line bg-transparent px-2.5 py-1 font-serif text-[14px] text-ink"
            >
              {word.text}
            </button>
          ))}
        </div>
      )}
      {hit && (
        <div className="mt-3 rounded-xl bg-bg px-3 py-2.5">
          <div className="text-[15px]">
            <span className="font-serif">{hit.text}</span>
            {hit.meta.pos && <span className="ml-1.5 text-xs text-muted">{hit.meta.pos}</span>}
          </div>
          <p className="mt-0.5 mb-0 text-[14px] leading-relaxed">{hit.meta.meaning}</p>
          {hit.why && <p className="mt-1 mb-0 text-xs leading-relaxed text-muted">{hit.why}</p>}
          <div className="mt-2 flex gap-2">
            <button
              onClick={() => onKnow(hit.id)}
              disabled={busy.has(hit.id)}
              className="h-9 rounded-xl border border-line bg-transparent px-3.5 text-[13px] text-muted-2 disabled:opacity-40"
            >
              认识
            </button>
            <button
              onClick={() => onLearn(hit.id)}
              disabled={busy.has(hit.id)}
              className="h-9 rounded-xl border-0 bg-accent px-3.5 text-[13px] font-medium text-on-accent disabled:opacity-40"
            >
              学这个
            </button>
          </div>
        </div>
      )}
      {article.words.length > 1 && (
        <button
          type="button"
          onClick={async () => {
            const ok = await confirmDialog(`要把这篇里的 ${article.words.length} 个词都加入复习吗？可以先点词，只学想记的。`, { ok: '全部加入' })
            if (ok) onLearnAll()
          }}
          className="mt-3 h-10 w-full rounded-xl border border-line bg-transparent text-[13px] text-muted-2"
        >
          全部加入复习…
        </button>
      )}
    </article>
  )
}
