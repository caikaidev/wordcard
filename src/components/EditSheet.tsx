import { useState, type ReactNode } from 'react'
import { api } from '../api'
import type { CardMeta, Item } from '../../shared/types'
import { errMsg, toast } from './ui'

type Form = { text: string } & Pick<CardMeta, 'ipa' | 'pos' | 'meaning' | 'example' | 'exampleZh' | 'memoryTip'>

/** 词库里编辑一张卡片：原文、音标、词性、释义、例句及翻译、记忆钩子 */
export default function EditSheet({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: (item: Item) => void }) {
  const m = item.meta
  const [f, setF] = useState<Form>({
    text: item.text,
    ipa: m.ipa,
    pos: m.pos,
    meaning: m.meaning,
    example: m.example,
    exampleZh: m.exampleZh,
    memoryTip: m.memoryTip ?? '',
  })
  const [saving, setSaving] = useState(false)
  const isWord = item.type === 'word'
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }))

  const save = async () => {
    const text = f.text.trim()
    if (!text) return toast('原文不能为空', 'error')
    setSaving(true)
    try {
      const example = f.example.trim()
      // 例句改了，原来的高亮片段 / 语境挖空可能已经对不上，对不上就去掉
      const at = example.toLowerCase().indexOf(text.toLowerCase())
      const highlight = m.highlight && example.includes(m.highlight) ? m.highlight : at >= 0 ? example.slice(at, at + text.length) : ''
      const meta: CardMeta = {
        ...m,
        ipa: f.ipa.trim(),
        pos: f.pos.trim(),
        meaning: f.meaning.trim(),
        example,
        exampleZh: f.exampleZh.trim(),
        highlight,
        memoryTip: f.memoryTip?.trim() || undefined,
        // 原文变了，AI 生成的产出题就不再适用
        cloze: text === item.text ? m.cloze : undefined,
      }
      const r = await api.update(item.id, { ...(text !== item.text ? { text } : {}), meta })
      toast(`已保存修改「${r.item.text}」`, 'success')
      onSaved(r.item)
    } catch (e) {
      toast(errMsg(e), 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 md:items-center" onClick={() => !saving && onClose()}>
      <form
        role="dialog"
        aria-label="编辑卡片"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
        className="pb-safe flex max-h-[90dvh] w-full max-w-lg flex-col gap-3 overflow-y-auto rounded-t-3xl bg-bg p-5 md:rounded-3xl"
      >
        <h2 className="m-0 text-lg font-semibold">编辑卡片</h2>
        <Field label={isWord ? '单词' : '句子'}>
          <Input value={f.text} onChange={set('text')} className="font-serif text-lg" autoFocus />
        </Field>
        {isWord && (
          <div className="grid grid-cols-[1fr_7rem] gap-2.5">
            <Field label="音标">
              <Input value={f.ipa} onChange={set('ipa')} className="font-serif" placeholder="/ˈeksəmpl/" />
            </Field>
            <Field label="词性">
              <Input value={f.pos} onChange={set('pos')} placeholder="n." />
            </Field>
          </div>
        )}
        <Field label={isWord ? '中文释义' : '中文翻译'}>
          <Input value={f.meaning} onChange={set('meaning')} multiline />
        </Field>
        <Field label="英文例句">
          <Input value={f.example} onChange={set('example')} className="font-serif" multiline />
        </Field>
        <Field label="例句翻译">
          <Input value={f.exampleZh} onChange={set('exampleZh')} multiline />
        </Field>
        <Field label="记忆提示（可选）">
          <Input value={f.memoryTip ?? ''} onChange={set('memoryTip')} multiline placeholder="谐音、拆词、画面…" />
        </Field>
        <div className="mt-1 grid grid-cols-2 gap-2.5">
          <button type="button" onClick={onClose} disabled={saving} className="h-11 rounded-2xl border border-line bg-transparent text-[15px] text-ink">
            取消
          </button>
          <button type="submit" disabled={saving} className="h-11 rounded-2xl border-0 bg-invert-bg text-[15px] font-medium text-invert-fg disabled:opacity-60">
            {saving ? '保存中…' : '保存修改'}
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs tracking-wider text-muted">{label}</span>
      {children}
    </label>
  )
}

function Input({
  value,
  onChange,
  multiline = false,
  className = '',
  placeholder,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  className?: string
  placeholder?: string
  autoFocus?: boolean
}) {
  const cls = `w-full rounded-xl border border-line bg-surface px-3 py-2 text-[15px] text-ink outline-none placeholder:text-faint focus:border-muted ${className}`
  return multiline ? (
    <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder} className={`resize-y leading-relaxed ${cls}`} />
  ) : (
    <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} className={`h-11 ${cls}`} />
  )
}
