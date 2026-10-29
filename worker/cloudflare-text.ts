import type { Env } from './env'
import type { GeminiPart, UsageKind } from './gemini'
import { aiCallCounts, aiLimits } from './gemini'

export const CF_TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'

export class CloudflareTextError extends Error {
  readonly partial?: unknown
  readonly switchable: boolean
  constructor(message: string, readonly status = 502, partial?: unknown, switchable = true) {
    super(message)
    this.partial = partial
    this.switchable = switchable
  }
}
type JsonSchema = {
  type?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
}

export function normalizeSchema(schema: unknown): JsonSchema {
  if (!schema || typeof schema !== 'object') return { type: 'object' }
  const s = schema as JsonSchema
  const result: JsonSchema = {}
  if (s.type) result.type = s.type.toLowerCase()
  if (s.properties) result.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, normalizeSchema(v)]))
  if (s.items) result.items = normalizeSchema(s.items)
  if (s.required) result.required = s.required
  if (s.enum) result.enum = s.enum
  return result
}

const JSON_ERROR = 'Qwen 返回的不是合法 JSON。请重试或切换 Gemini'
const SHAPE_ERROR = 'Qwen 返回的 JSON 字段不完整或类型不符。请重试或切换 Gemini'
const FENCE = String.fromCharCode(96).repeat(3)
/** 放在任务正文之后。闯关提示词要求先自查，模型会把自查写进回复，盖过前面的 JSON 指令。 */
const OUTPUT_RULE = '输出要求：只返回一个 JSON 值。不要 Markdown、代码围栏、前后说明或思考过程。任务里的自查只在内部完成，不要写进回复。字符串数组必须写成 JSON 数组，不要拼成一段用逗号分开的文字。required 里的每个字段都要出现，没有内容的数组用 []。字段名用 schema 里的原名，不要改成 word、meaning、options，也不要改大小写。回复的第一个非空白字符必须是 { 或 [，最后一个必须是 } 或 ]。'

/** Qwen3 默认会思考。闯关回复里常夹着前后文、代码围栏，或在 max_tokens 处被截断。能对上 schema 的值才采用。 */
export function parseCloudflareJson<T>(result: unknown, schema: unknown): T {
  const normalized = normalizeSchema(schema)
  const texts = valuesFromTexts([...contentTexts(result), ...responseTexts(result)])
  const objects = objectPayloads(result)
  const coerced = [...texts.strict, ...texts.repaired, ...objects].map((value) => coerce(value, normalized))
  const passing = coerced.filter((value) => verifyShape(value, normalized))
  if (passing.length) return largest(passing) as T
  if (texts.strict.length || texts.repaired.length || objects.length) {
    throw new CloudflareTextError(SHAPE_ERROR, 502, bestPartial(coerced, normalized))
  }
  throw new CloudflareTextError(JSON_ERROR)
}

function choiceMessage(result: unknown): { content?: unknown } | undefined {
  if (!result || typeof result !== 'object') return undefined
  const choices = (result as { choices?: unknown }).choices
  const choice = Array.isArray(choices) ? choices[0] : undefined
  if (!choice || typeof choice !== 'object') return undefined
  const message = (choice as { message?: unknown }).message
  return message && typeof message === 'object' ? message as { content?: unknown } : undefined
}

function contentTexts(result: unknown): string[] {
  const content = choiceMessage(result)?.content
  if (typeof content === 'string') return content.trim() ? [content] : []
  if (!Array.isArray(content)) return []
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === 'string') { parts.push(part); continue }
    if (!part || typeof part !== 'object') continue
    const block = part as { type?: unknown; text?: unknown; content?: unknown }
    if (block.type === 'thinking' || block.type === 'reasoning') continue
    if (typeof block.text === 'string') parts.push(block.text)
    else if (typeof block.content === 'string') parts.push(block.content)
  }
  const joined = parts.join('')
  return joined.trim() ? [joined] : []
}

function responseTexts(result: unknown): string[] {
  if (typeof result === 'string') return result.trim() ? [result] : []
  if (!result || typeof result !== 'object') return []
  const obj = result as { response?: unknown; result?: unknown }
  const out: string[] = []
  if (typeof obj.response === 'string' && obj.response.trim()) out.push(obj.response)
  if (obj.result && typeof obj.result === 'object') {
    const nested = (obj.result as { response?: unknown }).response
    if (typeof nested === 'string' && nested.trim()) out.push(nested)
  }
  return out
}

function objectPayloads(result: unknown): unknown[] {
  if (!result || typeof result !== 'object') return []
  const obj = result as Record<string, unknown>
  const out: unknown[] = []
  if (isJsonPayload(obj.response)) out.push(obj.response)
  const content = choiceMessage(result)?.content
  if (isJsonPayload(content)) out.push(content)
  const envelope = 'response' in obj || 'choices' in obj || 'usage' in obj || 'result' in obj
  if (!envelope && isJsonPayload(obj)) out.push(obj)
  return out
}

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return !!value && typeof value === 'object'
}

function isMessagePart(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const part = value as Record<string, unknown>
  if (part.type !== 'text' && part.type !== 'thinking' && part.type !== 'reasoning') return false
  return Object.keys(part).every((key) => key === 'type' || key === 'text' || key === 'content')
}

function isJsonPayload(value: unknown): value is Record<string, unknown> | unknown[] {
  if (!isContainer(value)) return false
  return !Array.isArray(value) || value.length === 0 || !value.every(isMessagePart)
}

function valuesFromTexts(texts: string[]): { strict: unknown[]; repaired: unknown[] } {
  const strict: unknown[] = []
  const repaired: unknown[] = []
  for (const text of texts) {
    strict.push(...strictValues(text))
    for (const fixed of repairedValues(stripWrappers(text))) {
      try { repaired.push(JSON.parse(fixed) as unknown) } catch { /* ignore */ }
    }
  }
  return { strict, repaired }
}

function strictValues(text: string): unknown[] {
  const stripped = stripWrappers(text)
  const chunks = [stripped, ...fencedBodies(stripped), ...outermost(stripped)]
  const values: unknown[] = []
  for (const chunk of chunks) {
    for (const candidate of [chunk.trim(), stripTrailingCommas(chunk).trim()]) {
      if (!candidate) continue
      try { values.push(JSON.parse(candidate) as unknown) } catch { /* ignore */ }
    }
  }
  return values
}

function stripWrappers(text: string): string {
  let s = text.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '')
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<redacted_thinking>[\s\S]*?<\/redacted_thinking>/gi, '')
  const open = s.search(/<think>|<redacted_thinking>/i)
  const jsonAt = s.search(/[\[{]/)
  // 思考没写完就截断时，后面没有正式答案，不要把思考草稿当成 JSON。
  if (open >= 0 && (jsonAt < 0 || open < jsonAt)) s = s.slice(0, open)
  return s.trim()
}

function fencedBodies(text: string): string[] {
  const bodies: string[] = []
  for (const match of text.matchAll(new RegExp(FENCE + '(?:json)?\\s*([\\s\\S]*?)' + FENCE, 'gi'))) {
    const body = match[1]?.trim()
    if (body) bodies.push(body)
  }
  return bodies
}

function outermost(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      const end = stringEnd(text, i)
      i = end < 0 ? text.length : end - 1
      continue
    }
    if (text[i] !== '{' && text[i] !== '[') continue
    const end = valueEnd(text, i)
    if (end > i) { out.push(text.slice(i, end)); i = end - 1 }
  }
  return out
}

function repairedValues(text: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (c === '"') {
      const end = stringEnd(text, i)
      i = end < 0 ? text.length : end - 1
      continue
    }
    if (c !== '{' && c !== '[') continue
    const end = valueEnd(text, i)
    if (end > i) { i = end - 1; continue }
    const fixed = closeTruncated(text.slice(i))
    if (fixed) out.push(fixed)
  }
  return out
}

function stripTrailingCommas(text: string): string {
  let out = ''
  let inString = false
  let escape = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inString) {
      out += c
      if (escape) escape = false
      else if (c === '\\') escape = true
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') { inString = true; out += c; continue }
    if (c === ',') {
      let k = i + 1
      while (k < text.length && /\s/.test(text[k])) k++
      if (text[k] === '}' || text[k] === ']') continue
    }
    out += c
  }
  return out
}

function skipSpace(s: string, i: number): number {
  while (i < s.length && /\s/.test(s[i])) i++
  return i
}

function stringEnd(s: string, i: number): number {
  if (s[i] !== '"') return -1
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') { j++; continue }
    if (s[j] === '"') return j + 1
  }
  return -1
}

function literalEnd(s: string, i: number): number {
  const start = skipSpace(s, i)
  if (start >= s.length) return -1
  const c = s[start]
  if (c === '-' || (c >= '0' && c <= '9')) {
    const m = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(s.slice(start))
    return m ? start + m[0].length : -1
  }
  for (const word of ['true', 'false', 'null']) {
    if (!s.startsWith(word, start)) continue
    const next = s[start + word.length]
    if (next && /[0-9A-Za-z_]/.test(next)) return -1
    return start + word.length
  }
  return -1
}

function valueEnd(s: string, i: number): number {
  const start = skipSpace(s, i)
  if (start >= s.length) return -1
  const c = s[start]
  if (c === '"') return stringEnd(s, start)
  if (c === '{' || c === '[') return containerEnd(s, start)
  return literalEnd(s, start)
}

function containerEnd(s: string, i: number): number {
  const open = s[i]
  const close = open === '{' ? '}' : ']'
  let j = skipSpace(s, i + 1)
  if (s[j] === close) return j + 1
  while (j < s.length) {
    if (open === '{') {
      j = skipSpace(s, j)
      if (s[j] !== '"') return -1
      const keyEnd = stringEnd(s, j)
      if (keyEnd < 0) return -1
      j = skipSpace(s, keyEnd)
      if (s[j] !== ':') return -1
      j++
    }
    const valueAt = valueEnd(s, j)
    if (valueAt < 0) return -1
    j = skipSpace(s, valueAt)
    if (s[j] === close) return j + 1
    if (s[j] !== ',') return -1
    j = skipSpace(s, j + 1)
    if (s[j] === close) return j + 1
  }
  return -1
}

/** 只补上未闭合的括号，并丢掉最后一个没写完的字符串。字符串写到一半时不擅自收尾。 */
function closeTruncated(slice: string): string | undefined {
  const stack: ('{' | '[')[] = []
  let i = 0
  let safe = -1
  let safeStack: ('{' | '[')[] = []
  const mark = () => { safe = i; safeStack = stack.slice() }
  const parseString = (): boolean => {
    const end = stringEnd(slice, i)
    if (end < 0) return false
    i = end
    return true
  }
  const parseValue = (): boolean => {
    i = skipSpace(slice, i)
    if (i >= slice.length) return false
    const c = slice[i]
    if (c === '{' || c === '[') {
      const close = c === '{' ? '}' : ']'
      stack.push(c)
      i++
      i = skipSpace(slice, i)
      if (slice[i] === close) { i++; stack.pop(); mark(); return true }
      while (i < slice.length) {
        if (c === '{') {
          i = skipSpace(slice, i)
          if (slice[i] !== '"') return false
          if (!parseString()) return false
          i = skipSpace(slice, i)
          if (slice[i] !== ':') return false
          i++
        }
        if (!parseValue()) return false
        i = skipSpace(slice, i)
        if (slice[i] === ',') {
          i++
          i = skipSpace(slice, i)
          if (slice[i] === close) { i++; stack.pop(); mark(); return true }
          continue
        }
        if (slice[i] === close) { i++; stack.pop(); mark(); return true }
        return false
      }
      return false
    }
    if (c === '"') {
      if (!parseString()) return false
      mark()
      return true
    }
    const end = literalEnd(slice, i)
    if (end < 0) return false
    i = end
    mark()
    return true
  }
  if (parseValue() && stack.length === 0) return undefined
  if (!safeStack.length) return undefined
  const body = slice.slice(0, safe).replace(/\s+$/, '').replace(/,\s*$/, '')
  const closers = [...safeStack].reverse().map((kind) => (kind === '{' ? '}' : ']')).join('')
  return body + closers
}

function largest(values: unknown[]): unknown {
  let best = values[0]
  let size = JSON.stringify(best).length
  for (let i = 1; i < values.length; i++) {
    const next = JSON.stringify(values[i]).length
    if (next >= size) { best = values[i]; size = next }
  }
  return best
}

/** 整份对不上 schema 时，留下 required 字段更齐的那份，供闯关只补缺的那一侧。 */
function bestPartial(values: unknown[], schema: JsonSchema): unknown | undefined {
  const objects = values.filter((value) => value && typeof value === 'object' && !Array.isArray(value))
  if (!objects.length) return undefined
  const score = (value: unknown) => {
    const record = value as Record<string, unknown>
    return (schema.required ?? []).reduce((n, key) => {
      const child = schema.properties?.[key]
      if (record[key] === undefined) return n
      return n + (child && verifyShape(record[key], child) ? 2 : 1)
    }, 0)
  }
  return objects.reduce((best, value) => (score(value) > score(best) ? value : best))
}

function splitStringList(value: string): string[] {
  return value.split(/[,，、;；|\n]+/).map((part) => part.trim()).filter(Boolean)
}

/** 只在目标字段缺失时借用。不把 text / items 当成通用别名，避免把别的任务里的正文偷走。 */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  en: ['word', 'english', 'term', 'expr', 'expression', 'sentence'],
  zh: ['meaning', 'chinese', 'translation', 'cn', 'gloss'],
  distractors: ['options', 'choices', 'wrongs', 'distractor'],
  extra: ['extras', 'decoys', 'noise'],
  words: ['vocab', 'vocabulary', 'wordList', 'word_list'],
  listening: ['listen', 'audios', 'audioItems', 'audio', 'listenings'],
  cloze: ['blanks', 'fillBlank', 'fill_blank'],
  reading: ['readings', 'passages'],
  speaking: ['speak', 'oral'],
  passage: ['article', 'paragraph'],
  questions: ['question', 'qs'],
  question: ['q', 'prompt'],
  explain: ['explanation', 'why', 'reason'],
  answer: ['ans', 'correct', 'correctAnswer'],
  sentence: ['line', 'blankSentence'],
}

const STRING_ITEM_KEYS = ['text', 'value', 'option', 'label', 'zh', 'en', 'word', 'content', 'meaning']

function lookupAlias(src: Record<string, unknown>, key: string): { found: boolean; value: unknown } {
  const names = [key, ...(FIELD_ALIASES[key] ?? [])]
  for (const name of names) {
    for (const [candidate, value] of Object.entries(src)) {
      if (candidate.toLowerCase() !== name.toLowerCase()) continue
      if (value === null || value === undefined) continue
      return { found: true, value }
    }
  }
  return { found: false, value: undefined }
}

function parseJsonArray(value: string): unknown[] | undefined {
  const trimmed = value.trim()
  if (!trimmed.startsWith('[')) return undefined
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringFromItem(item: unknown): string[] {
  if (typeof item === 'string') return [item]
  if (typeof item === 'number' && Number.isFinite(item)) return [String(item)]
  if (typeof item === 'boolean') return [String(item)]
  if (!item || typeof item !== 'object' || Array.isArray(item)) return []
  for (const [key, value] of Object.entries(item as Record<string, unknown>)) {
    if (!STRING_ITEM_KEYS.includes(key.toLowerCase())) continue
    if (typeof value === 'string' && value.trim()) return [value.trim()]
    if (typeof value === 'number' && Number.isFinite(value)) return [String(value)]
  }
  return []
}

function objectMapToItems(record: Record<string, unknown>, itemSchema: JsonSchema): unknown[] {
  const entries = Object.entries(record)
  if (!entries.length) return []
  if (!entries.every(([, value]) => value && typeof value === 'object' && !Array.isArray(value))) return []
  const wantsEn = Boolean(itemSchema.properties?.en)
  const kept = entries.map(([key, value]) => {
    const src: Record<string, unknown> = { ...(value as Record<string, unknown>) }
    if (wantsEn && !lookupAlias(src, 'en').found && !/^\d+$/.test(key)) src.en = key
    return coerce(src, itemSchema, true)
  }).filter((item) => verifyShape(item, itemSchema))
  return kept
}

/**
 * 模型常把字符串数组写成一整段文字、把 distractors 写成对象、或用 word/meaning 代替 en/zh。
 * 只做不发明内容的修正：嵌套对象里缺的必填数组补 []，坏掉的数组元素丢掉。
 * 根上缺字段不补，全部元素都不合格时也不改成空数组，留给重试。
 */
function coerce(value: unknown, schema: JsonSchema, nested = false): unknown {
  switch (schema.type) {
    case 'string':
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
      if (typeof value === 'boolean') return String(value)
      return value
    case 'integer':
      if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value.trim())
      return value
    case 'number':
      if (typeof value === 'string' && /^-?(?:\d+\.\d+|\d+)$/.test(value.trim())) return Number(value.trim())
      return value
    case 'boolean':
      if (value === 'true') return true
      if (value === 'false') return false
      return value
    case 'array':
      return coerceArray(value, schema)
    case 'object':
      return coerceObject(value, schema, nested)
    default:
      return value
  }
}

function coerceArray(value: unknown, schema: JsonSchema): unknown {
  const itemSchema = schema.items
  if (typeof value === 'string') {
    const parsed = parseJsonArray(value)
    if (parsed) return coerceArray(parsed, schema)
    if (itemSchema?.type === 'string') return coerceArray(splitStringList(value), schema)
  }
  if (itemSchema?.type === 'string' && value && typeof value === 'object' && !Array.isArray(value)) {
    const strings = Object.values(value as Record<string, unknown>).flatMap(stringFromItem)
    if (strings.length) return strings
    return value
  }
  if (itemSchema?.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const one = coerce(record, itemSchema, true)
    if (verifyShape(one, itemSchema)) return [one]
    const fromMap = objectMapToItems(record, itemSchema)
    if (fromMap.length) return fromMap
    return value
  }
  if (!Array.isArray(value)) return value
  if (!itemSchema) return value
  const kept = itemSchema.type === 'string'
    ? value.flatMap(stringFromItem)
    : value.map((item) => coerce(item, itemSchema, true)).filter((item) => verifyShape(item, itemSchema))
  // 模型给了元素但每一条都不合格：留着原值，让整段校验失败并重试，而不是悄悄变成 []。
  if (value.length > 0 && kept.length === 0) return value
  return kept
}

function coerceObject(value: unknown, schema: JsonSchema, nested: boolean): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const src = value as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    const required = (schema.required ?? []).includes(key)
    const direct = Object.hasOwn(src, key) ? src[key] : undefined
    const looked = direct === null || direct === undefined ? lookupAlias(src, key) : { found: true, value: direct }
    if (!looked.found) {
      if (nested && required && sub.type === 'array') out[key] = []
      continue
    }
    out[key] = coerce(looked.value, sub, true)
    if (sub.enum && typeof out[key] === 'string') {
      const hit = sub.enum.find((item) => typeof item === 'string' && item.toLowerCase() === (out[key] as string).toLowerCase())
      if (hit !== undefined) out[key] = hit
    }
  }
  return out
}

function verifyShape(value: unknown, schema: JsonSchema): boolean {
  if (schema.enum && !schema.enum.includes(value)) return false
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false
      const o = value as Record<string, unknown>
      if ((schema.required ?? []).some((k) => !Object.hasOwn(o, k))) return false
      return Object.entries(schema.properties ?? {}).every(([k, sub]) => o[k] === undefined || verifyShape(o[k], sub))
    }
    case 'array': return Array.isArray(value) && value.every((v) => !schema.items || verifyShape(v, schema.items))
    case 'string': return typeof value === 'string'
    case 'boolean': return typeof value === 'boolean'
    case 'integer': return typeof value === 'number' && Number.isInteger(value)
    case 'number': return typeof value === 'number' && Number.isFinite(value)
    default: return true
  }
}

function classifyError(error: unknown): CloudflareTextError {
  if (error instanceof CloudflareTextError) return error
  const msg = error instanceof Error ? error.message : String(error)
  console.error('Cloudflare text inference failed', error)
  if (/\b3036\b|free allocation|daily.*neurons/i.test(msg)) return new CloudflareTextError('Cloudflare 今天的免费 Neurons 已用完，请切换 Gemini 或明天重试', 429)
  if (/\b3040\b|out of capacity/i.test(msg)) return new CloudflareTextError('Cloudflare Qwen 暂时容量不足，请稍后重试或切换 Gemini', 503)
  if (/429|rate.?limit/i.test(msg)) return new CloudflareTextError('Cloudflare 文本模型被限流，请稍后重试', 429)
  if (/403|5035|access denied|not allowed/i.test(msg)) return new CloudflareTextError('当前 Cloudflare 账户无法调用 Qwen，请检查 Workers AI 权限', 403)
  return new CloudflareTextError('Cloudflare Qwen 调用失败，请稍后重试或切换 Gemini')
}

async function guard(env: Env) {
  if (!env.AI || env.AI_DISABLED === 'true') throw new CloudflareTextError('Cloudflare AI 暂不可用', 503, undefined, false)
  const limits = aiLimits(env)
  const counts = await aiCallCounts(env)
  if (counts.minute >= limits.perMinute) throw new CloudflareTextError('请求过于频繁，请稍后重试', 429, undefined, false)
  if (counts.text >= limits.text) throw new CloudflareTextError('今日文本 AI 调用达到应用上限', 429, undefined, false)
  if (!env.IS_ADMIN && counts.userText >= limits.userText) throw new CloudflareTextError('今日个人文本 AI 调用达到应用上限', 429, undefined, false)
}

function getUsage(response: unknown): { input: number; output: number } {
  const d = response && typeof response === 'object' ? response as { usage?: Record<string, unknown> } : {}
  const u = d.usage ?? {}
  return {
    input: Number(u.prompt_tokens ?? u.input_tokens ?? 0) || 0,
    output: Number(u.completion_tokens ?? u.output_tokens ?? 0) || 0,
  }
}

async function recordUsage(env: Env, kind: UsageKind, usage: { input: number; output: number }) {
  await env.DB.prepare('INSERT INTO usage (ts, kind, model, input_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), kind, CF_TEXT_MODEL, usage.input, usage.output, env.USER_ID ?? '')
    .run()
    .catch((error) => console.error('Cloudflare text usage log failed', error))
}

export async function cloudflareGenerateJson<T>(
  env: Env,
  prompt: string | GeminiPart[],
  schema: unknown,
  kind: UsageKind,
  temperature: number,
  retry = true,
): Promise<T> {
  const parts = typeof prompt === 'string' ? [{ text: prompt }] : prompt
  if (parts.some((part) => part.inlineData)) {
    throw new CloudflareTextError('Cloudflare 免费文本模型暂不支持截图识别，请在设置中切换 Gemini 再试', 400)
  }
  await guard(env)
  const user = parts.map((p) => p.text ?? '').join('\n')
  const schemaText = JSON.stringify(normalizeSchema(schema))
  const once = async (extra: string): Promise<unknown> => {
    const instruction = [
      '/no_think',
      '你是英语学习应用中的结构化 JSON 生成器。',
      '严格返回一个完整且合法的 JSON 值，不要 Markdown、说明、思考过程或代码块。',
      '必须符合下列 JSON Schema，包含所有 required 字段，字段类型不可变。',
      '输出可以是对象或数组，以 schema 的根 type 为准。',
      'JSON Schema:',
      schemaText,
      '任务内容:',
      user,
      extra ? `${extra}\n${OUTPUT_RULE}` : OUTPUT_RULE,
    ].join('\n\n')
    let result: unknown
    try {
      result = await env.AI.run(CF_TEXT_MODEL, {
        messages: [{ role: 'user', content: instruction }],
        temperature: Math.max(0, Math.min(1, temperature)),
        max_tokens: kind === 'quest' || kind === 'lesson' ? 6500 : 4000,
        stream: false,
      })
    } catch (e) { throw classifyError(e) }
    await recordUsage(env, kind, getUsage(result))
    return result
  }
  const first = await once('')
  try {
    return parseCloudflareJson<T>(first, schema)
  } catch (error) {
    // 非法 JSON 和字段/类型对不上都再问 Qwen 一次。两次都失败就抛原来的文案，不转 Gemini。
    // 闯关首批会关掉这次整段重试，避免同一篇长提示连跑两遍。
    const note = error instanceof CloudflareTextError ? retryNote(error.message) : undefined
    if (!retry || !note) throw error
    try {
      return parseCloudflareJson<T>(await once(note), schema)
    } catch (second) {
      throw keepPartial(second, error)
    }
  }
}

function keepPartial(second: unknown, first: unknown): unknown {
  if (!(second instanceof CloudflareTextError) || !(first instanceof CloudflareTextError)) return second
  if (second.partial !== undefined || first.partial === undefined) return second
  return new CloudflareTextError(second.message, second.status, first.partial)
}

function retryNote(message: string): string | undefined {
  if (message.includes('不是合法 JSON')) return '上一次没有返回合法 JSON。这次不要解释，只输出 JSON 值本身。'
  if (message.includes('字段不完整')) return '上一次的 JSON 对不上 schema：缺 required 字段，或字段类型不对。请补全每一个 required 字段；字符串数组写成 JSON 数组，数字不要加引号。字段名必须用 schema 里的 en、zh、distractors、words、listening，不要用 word、meaning、options，也不要改大小写。不要解释。'
  return undefined
}
