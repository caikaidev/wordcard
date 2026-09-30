import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from '../api'
import { prefetch } from '../audio'
import type { CardMeta, EnrichResult } from '../../shared/types'
import { refreshStats } from '../store'
import { Card, Chip, Highlighted, PageTitle, SpeakButton, errMsg, toast } from '../components/ui'
import { IconArrowRight, IconClose, IconRefresh, IconSparkle } from '../components/icons'

const emptyMeta = (): CardMeta => ({ ipa: '', pos: '', meaning: '', example: '', exampleZh: '', highlight: '', phrases: [] })

export default function Add() {
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState<EnrichResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqId = useRef(0)

  useEffect(() => {
    // 电脑端进入页面直接可以输入；手机端不自动弹键盘
    if (window.matchMedia('(min-width: 768px)').matches) inputRef.current?.focus()
  }, [])

  const runEnrich = async (text = input) => {
    const t = text.trim()
    if (!t || loading) return
    const id = ++reqId.current
    setLoading(true)
    try {
      const r = await api.enrich(t, draft?.text === t ? draft.type : undefined)
      if (id === reqId.current) {
        setDraft(r)
        // 大概率会保存，先把发音准备好（复习时也直接命中缓存）
        prefetch([r.text])
      }
    } catch (e) {
      if (id === reqId.current) toast(errMsg(e), 'error')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  const save = async () => {
    if (!draft || saving) return
    if (!draft.text.trim()) return toast('内容不能为空', 'error')
    setSaving(true)
    try {
      await api.create(draft.type, draft.text, draft.meta)
      toast(`已保存「${draft.text}」`)
      setDraft(null)
      setInput('')
      refreshStats()
      inputRef.current?.focus()
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  const clear = () => {
    reqId.current++
    setLoading(false)
    setInput('')
    setDraft(null)
    inputRef.current?.focus()
  }

  const setMeta = (patch: Partial<CardMeta>) => setDraft((d) => (d ? { ...d, meta: { ...d.meta, ...patch } } : d))

  return (
    <div className="pt-safe flex flex-1 flex-col px-6 md:pt-10">
      <div className="md:hidden">
        <PageTitle eyebrow="新条目" title="添加" />
      </div>

      <div className="flex flex-1 flex-col gap-4 pt-5 pb-4 md:pt-0">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (draft && draft.text === input.trim()) save()
            else runEnrich()
          }}
        >
          <label htmlFor="entry" className="text-xs tracking-wider text-muted">
            单词或句子
          </label>
          <div className="relative">
            <input
              id="entry"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="比如 serendipity，或者一整句话"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              className="h-[60px] w-full rounded-[18px] border-[1.5px] border-line bg-surface pr-14 pl-5 font-serif text-[22px] text-ink outline-none placeholder:font-sans placeholder:text-base placeholder:text-faint focus:border-ink"
            />
            {input && (
              <button
                type="button"
                aria-label="清空"
                onClick={clear}
                className="absolute top-2 right-2 flex h-11 w-11 items-center justify-center border-0 bg-transparent text-muted"
              >
                <IconClose size={18} />
              </button>
            )}
          </div>
        </form>

        {(draft || loading) && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-[13px] text-muted">
              <IconSparkle size={16} className="text-accent" />
              {loading ? 'AI 正在补全…' : 'AI 补全预览 · 点击文字可直接修改'}
            </div>
            <button
              type="button"
              aria-label="重新生成"
              disabled={loading}
              onClick={() => runEnrich(draft?.text || input)}
              className="-mr-2.5 flex h-11 w-11 items-center justify-center border-0 bg-transparent text-muted disabled:opacity-40"
            >
              <IconRefresh size={18} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        )}

        {loading && !draft && <SkeletonCard />}

        {draft && (
          <Card className={`flex animate-rise flex-col gap-[18px] p-6 transition-opacity ${loading ? 'opacity-50' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <Editable
                  value={draft.text}
                  onChange={(v) => setDraft({ ...draft, text: v })}
                  className={`font-serif font-medium tracking-tight ${
                    draft.type === 'word' ? 'text-[32px] leading-[1.1]' : 'text-[22px] leading-snug'
                  }`}
                  label="原文"
                />
                {draft.type === 'word' && (
                  <Editable
                    value={draft.meta.ipa}
                    onChange={(v) => setMeta({ ipa: v })}
                    className="font-serif text-base text-muted italic"
                    placeholder="音标"
                    label="音标"
                  />
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Chip onClick={() => setDraft({ ...draft, type: draft.type === 'word' ? 'sentence' : 'word' })}>
                  {draft.type === 'word' ? '单词' : '句子'}
                </Chip>
                <SpeakButton text={draft.text} />
              </div>
            </div>

            <div className="h-px bg-divider" />

            <Field label={draft.type === 'word' ? '释义' : '翻译'}>
              <div className="flex items-baseline gap-2.5">
                {draft.type === 'word' && (
                  <Editable
                    value={draft.meta.pos}
                    onChange={(v) => setMeta({ pos: v })}
                    className="shrink-0 font-serif text-[15px] text-muted italic"
                    placeholder="词性"
                    label="词性"
                  />
                )}
                <Editable
                  value={draft.meta.meaning}
                  onChange={(v) => setMeta({ meaning: v })}
                  className="flex-1 text-[17px] leading-relaxed font-medium"
                  placeholder="中文释义"
                  label="释义"
                />
              </div>
            </Field>

            <Field label="例句">
              <Editable
                value={draft.meta.example}
                onChange={(v) => setMeta({ example: v })}
                className="font-serif text-[19px] leading-normal"
                placeholder="英文例句"
                label="例句"
                render={(v) => <Highlighted text={v} marks={[draft.meta.highlight]} />}
              />
              <Editable
                value={draft.meta.exampleZh}
                onChange={(v) => setMeta({ exampleZh: v })}
                className="text-sm leading-relaxed text-muted"
                placeholder="例句翻译"
                label="例句翻译"
              />
            </Field>

            {draft.meta.phrases.length > 0 && (
              <Field label={draft.type === 'word' ? '搭配' : '重点短语'}>
                {draft.meta.phrases.map((p, i) => (
                  <div key={i} className="flex items-baseline gap-2 text-sm">
                    <span className="font-serif text-base">{p.text}</span>
                    <span className="flex-1 text-muted">{p.meaning}</span>
                    <button
                      type="button"
                      aria-label={`删除 ${p.text}`}
                      onClick={() => setMeta({ phrases: draft.meta.phrases.filter((_, j) => j !== i) })}
                      className="-my-2 flex h-8 w-8 items-center justify-center border-0 bg-transparent text-faint hover:text-muted"
                    >
                      <IconClose size={14} />
                    </button>
                  </div>
                ))}
              </Field>
            )}
          </Card>
        )}

        {!draft && !loading && input.trim() && (
          <button
            type="button"
            onClick={() => {
              const t = input.trim()
              setDraft({ type: /\s/.test(t) && /[.!?]$/.test(t) ? 'sentence' : 'word', text: t, meta: emptyMeta() })
            }}
            className="self-center border-0 bg-transparent py-2 text-[13px] text-muted underline decoration-line underline-offset-4"
          >
            跳过 AI，手动填写
          </button>
        )}

        <div className="flex-1" />

        {draft ? (
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="flex h-[60px] w-full items-center justify-center gap-2 rounded-[18px] border-0 bg-invert-bg text-base font-medium tracking-wide text-invert-fg disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存到词库'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => runEnrich()}
            disabled={!input.trim() || loading}
            className="flex h-[60px] w-full items-center justify-center gap-2 rounded-[18px] border-0 bg-invert-bg text-base font-medium tracking-wide text-invert-fg disabled:opacity-40"
          >
            {loading ? '补全中…' : 'AI 补全'}
            {!loading && <IconArrowRight size={18} />}
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-xs tracking-wider text-muted">{label}</div>
      {children}
    </div>
  )
}

/** 平时显示为文字，点击后原地变成输入框 */
function Editable({
  value,
  onChange,
  className = '',
  placeholder = '',
  label,
  render,
}: {
  value: string
  onChange: (v: string) => void
  className?: string
  placeholder?: string
  label: string
  render?: (v: string) => ReactNode
}) {
  const [editing, setEditing] = useState(false)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!editing || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  useEffect(() => {
    const el = ref.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value, editing])

  if (editing) {
    return (
      <textarea
        ref={ref}
        aria-label={label}
        value={value}
        rows={1}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\n/g, ' '))}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault()
            setEditing(false)
          }
        }}
        className={`-mx-1.5 -my-0.5 resize-none overflow-hidden rounded-lg border-0 bg-chip px-1.5 py-0.5 text-ink outline-none ${className}`}
      />
    )
  }
  return (
    <button
      type="button"
      aria-label={`修改${label}`}
      onClick={() => setEditing(true)}
      className={`-mx-1.5 -my-0.5 cursor-text rounded-lg border-0 bg-transparent px-1.5 py-0.5 text-left text-ink hover:bg-chip ${className}`}
    >
      {value ? (render ? render(value) : value) : <span className="text-faint not-italic">{placeholder}</span>}
    </button>
  )
}

function SkeletonCard() {
  return (
    <Card className="flex animate-shimmer flex-col gap-4 p-6">
      <div className="h-8 w-2/3 rounded-lg bg-chip" />
      <div className="h-4 w-1/3 rounded bg-chip" />
      <div className="h-px bg-divider" />
      <div className="h-5 w-4/5 rounded bg-chip" />
      <div className="h-5 w-full rounded bg-chip" />
      <div className="h-4 w-3/5 rounded bg-chip" />
    </Card>
  )
}
