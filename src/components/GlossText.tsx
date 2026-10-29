function escapeReg(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 按词或短语切开，长的优先，避免短词吃掉长词。 */
export function splitByGloss(text: string, forms: string[]): { text: string; form: string | null }[] {
  const cleaned = [...new Set(forms.map((f) => f.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!cleaned.length || !text) return [{ text, form: null }]
  const pattern = cleaned
    .map((f) => {
      const body = escapeReg(f)
      return /\s/.test(f) ? body : `\\b${body}\\b`
    })
    .join('|')
  const re = new RegExp(`(${pattern})`, 'gi')
  const byLower = new Map(cleaned.map((f) => [f.toLowerCase(), f]))
  return text
    .split(re)
    .filter((p) => p !== '')
    .map((p) => ({ text: p, form: byLower.get(p.toLowerCase()) ?? null }))
}

/** 先读正文，再点亮的词看意思。意思本身由外面决定要不要显示。 */
export function GlossSpan({
  text,
  forms,
  active,
  onPick,
}: {
  text: string
  forms: string[]
  active: string | null
  onPick: (form: string) => void
}) {
  const parts = splitByGloss(text, forms)
  return (
    <>
      {parts.map((p, i) =>
        p.form ? (
          <button
            key={`${i}-${p.form}`}
            type="button"
            onClick={() => onPick(p.form as string)}
            aria-pressed={active?.toLowerCase() === p.form.toLowerCase()}
            aria-label={`看「${p.text}」的意思`}
            className={`inline cursor-pointer rounded-sm border-0 bg-transparent p-0 font-medium text-accent underline decoration-dotted underline-offset-4 ${
              active?.toLowerCase() === p.form.toLowerCase() ? 'bg-accent-soft' : ''
            }`}
            style={{ font: 'inherit' }}
          >
            {p.text}
          </button>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
