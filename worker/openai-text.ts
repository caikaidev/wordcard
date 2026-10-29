import type { Env } from './env'
import type { GeminiPart, UsageKind } from './gemini'
import { aiCallCounts, aiLimits } from './gemini'
import { normalizeSchema } from './cloudflare-text'
import { DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL, normalizeOpenAiBaseUrl } from '../shared/settings'

export class OpenAITextError extends Error {
  readonly switchable: boolean
  constructor(
    message: string,
    readonly status = 502,
    switchable = true,
  ) {
    super(message)
    this.name = 'OpenAITextError'
    this.switchable = switchable
  }
}

const JSON_ERROR = 'OpenAI 返回的不是合法 JSON，请重试'

function baseUrl(env: Env): string {
  const raw = env.OPENAI_BASE_URL || DEFAULT_OPENAI_BASE_URL
  return normalizeOpenAiBaseUrl(raw)
}

function modelOf(env: Env): string {
  return env.OPENAI_TEXT_MODEL || DEFAULT_OPENAI_MODEL
}

/** gpt-6-astra / gpt-6.1-sol 不接受 temperature，推理强度用 low，结构化任务才不会等太久。 */
export function omitsTemperature(model: string): boolean {
  return model === 'gpt-6-astra' || model.startsWith('gpt-6-astra-') || model === 'gpt-6.1-sol' || model.startsWith('gpt-6.1-sol-')
}

function outputCap(kind: UsageKind): number {
  return kind === 'quest' || kind === 'lesson' ? 16_000 : 8_000
}

function clip(message: string): string {
  const clean = message.replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…').replace(/\s+/g, ' ').trim()
  return clean.slice(0, 180) || '未知错误'
}

function schemaRoot(schema: unknown): 'array' | 'object' {
  return normalizeSchema(schema).type === 'array' ? 'array' : 'object'
}

type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

function taskText(parts: GeminiPart[]): string {
  return parts.map((part) => part.text ?? '').filter(Boolean).join('\n')
}

function userContent(parts: GeminiPart[], instruction: string): string | ContentPart[] {
  if (!parts.some((part) => part.inlineData)) return instruction
  const content: ContentPart[] = [{ type: 'text', text: instruction }]
  for (const part of parts) {
    if (!part.inlineData?.data) continue
    const mime = part.inlineData.mimeType || 'image/png'
    content.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${part.inlineData.data}` } })
  }
  return content
}

function instructionFor(prompt: string | GeminiPart[], schema: unknown): { text: string; root: 'array' | 'object'; content: string | ContentPart[] } {
  const parts = typeof prompt === 'string' ? [{ text: prompt }] : prompt
  const root = schemaRoot(schema)
  const text = [
    root === 'array'
      ? '只返回一个 JSON 对象，形如 {"items":[...]}。items 必须符合下面 schema 的数组根，不要 Markdown 或解释。'
      : '只返回一个 JSON 对象。字段必须符合下面的 JSON Schema，不要 Markdown 或解释。',
    'JSON Schema:',
    JSON.stringify(normalizeSchema(schema)),
    '任务:',
    taskText(parts),
  ].join('\n\n')
  return { text, root, content: userContent(parts, text) }
}

type ChatBody = Record<string, unknown>

function buildBody(env: Env, content: string | ContentPart[], kind: UsageKind, temperature: number): ChatBody {
  const model = modelOf(env)
  const body: ChatBody = {
    model,
    messages: [
      { role: 'system', content: '你是英语学习应用里的 JSON 接口。只输出 JSON，不要代码围栏。' },
      { role: 'user', content },
    ],
    response_format: { type: 'json_object' },
  }
  const cap = outputCap(kind)
  if (omitsTemperature(model)) {
    body.reasoning_effort = 'low'
    body.max_completion_tokens = cap
  } else {
    body.temperature = Math.max(0, Math.min(2, temperature))
    body.max_tokens = cap
  }
  return body
}

/** 兼容端点不认推理强度、json_object 或 max_completion_tokens 时，退回更老的 Chat Completions 字段再试一次。 */
function soften(body: ChatBody, temperature: number): ChatBody | null {
  const next: ChatBody = { ...body }
  let changed = false
  if ('reasoning_effort' in next) {
    delete next.reasoning_effort
    next.temperature = Math.max(0, Math.min(2, temperature))
    changed = true
  }
  if ('response_format' in next) {
    delete next.response_format
    changed = true
  }
  if ('max_completion_tokens' in next) {
    next.max_tokens = next.max_completion_tokens
    delete next.max_completion_tokens
    changed = true
  }
  return changed ? next : null
}

function messageText(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const choices = (data as { choices?: unknown }).choices
  const choice = Array.isArray(choices) ? choices[0] : undefined
  if (!choice || typeof choice !== 'object') return ''
  const message = (choice as { message?: unknown }).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function usageOf(data: unknown): { input: number; output: number } {
  const usage = data && typeof data === 'object' ? (data as { usage?: Record<string, unknown> }).usage : undefined
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0) || 0
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0) || 0
  return { input, output }
}

function errorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') return ''
  const error = (data as { error?: unknown }).error
  if (!error || typeof error !== 'object') return ''
  const message = (error as { message?: unknown }).message
  return typeof message === 'string' ? message : ''
}

export function parseOpenAiJson(text: string): unknown {
  let s = text.trim()
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(s) as unknown
  } catch {
    /* 围栏没剥干净时，从第一个括号再试一次 */
  }
  const at = s.search(/[\[{]/)
  if (at >= 0) {
    try {
      return JSON.parse(s.slice(at)) as unknown
    } catch {
      /* fall through */
    }
  }
  throw new OpenAITextError(JSON_ERROR)
}

function unwrap(value: unknown, root: 'array' | 'object'): unknown {
  if (root !== 'array') return value
  if (Array.isArray(value)) return value
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) return (value as { items: unknown }).items
  return value
}

function unsupportedParam(message: string): boolean {
  return /temperature|reasoning_effort|response_format|max_completion_tokens|max_tokens|unsupported parameter|unknown parameter|unrecognized/i.test(message)
}

function classify(status: number, message: string): OpenAITextError {
  const detail = clip(message)
  if (status === 401 || status === 403) return new OpenAITextError('OpenAI API key 无效或没有权限，请到设置里更换', status)
  if (status === 404) return new OpenAITextError(`找不到这个 OpenAI 模型或接口。请检查模型名和 Base URL${detail ? `（${detail}）` : ''}`, 404)
  if (status === 429) return new OpenAITextError('OpenAI 的额度或速率到顶了，稍后再试', 429)
  if (status >= 500) return new OpenAITextError(`OpenAI 暂时不可用（${status}）${detail ? `：${detail}` : ''}`, 502)
  return new OpenAITextError(`OpenAI 拒绝了这次请求（${status}）${detail ? `：${detail}` : ''}`, status || 502)
}

async function guard(env: Env) {
  const limits = aiLimits(env)
  if (limits.disabled) throw new OpenAITextError('AI 功能已暂停（AI_DISABLED）', 503, false)
  const counts = await aiCallCounts(env)
  if (counts.minute >= limits.perMinute) throw new OpenAITextError('调用太频繁了，歇一分钟再试', 429, false)
  if (!env.IS_ADMIN && counts.userText >= limits.userText) {
    throw new OpenAITextError(`你今天的 AI 调用额度（${limits.userText} 次）用完了，明天再来`, 429, false)
  }
  if (counts.text >= limits.text) throw new OpenAITextError(`今天的 AI 调用已达上限（${limits.text} 次），明天再来`, 429, false)
}

async function recordUsage(env: Env, kind: UsageKind, model: string, usage: { input: number; output: number }) {
  await env.DB.prepare('INSERT INTO usage (ts, kind, model, input_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), kind, model, usage.input, usage.output, env.USER_ID ?? '')
    .run()
    .catch((error: unknown) => console.error('OpenAI usage log failed', error))
}

async function postChat(env: Env, body: ChatBody, timeoutMs: number | undefined, kind: UsageKind): Promise<unknown> {
  const key = env.OPENAI_API_KEY
  if (!key) throw new OpenAITextError('还没有配置 OpenAI API key。请到设置里填写，或在部署环境配置 OPENAI_API_KEY', 400)
  let res: Response
  try {
    res = await fetch(`${baseUrl(env)}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs ?? 60_000),
    })
  } catch (error) {
    await recordUsage(env, kind, modelOf(env), { input: 0, output: 0 })
    if (error instanceof Error && error.name === 'TimeoutError') throw new OpenAITextError('OpenAI 响应超时了，请重试', 504)
    throw new OpenAITextError('连不上 OpenAI，请检查网络或 Base URL 后重试', 502)
  }
  const data = (await res.json().catch(() => ({}))) as unknown
  await recordUsage(env, kind, modelOf(env), usageOf(data))
  if (!res.ok) throw classify(res.status, errorMessage(data))
  return data
}

export async function openaiGenerateJson<T>(
  env: Env,
  prompt: string | GeminiPart[],
  schema: unknown,
  kind: UsageKind,
  temperature: number,
  timeoutMs?: number,
): Promise<T> {
  if (!env.OPENAI_API_KEY) throw new OpenAITextError('还没有配置 OpenAI API key。请到设置里填写，或在部署环境配置 OPENAI_API_KEY', 400)
  await guard(env)
  const shaped = instructionFor(prompt, schema)
  let body = buildBody(env, shaped.content, kind, temperature)
  let data: unknown
  try {
    data = await postChat(env, body, timeoutMs, kind)
  } catch (error) {
    const fallback = error instanceof OpenAITextError && error.status === 400 && unsupportedParam(error.message) ? soften(body, temperature) : null
    if (!fallback) throw error
    body = fallback
    data = await postChat(env, body, timeoutMs, kind)
  }
  const read = (payload: unknown): T => unwrap(parseOpenAiJson(messageText(payload)), shaped.root) as T
  const parseFailure = (error: unknown) =>
    error instanceof OpenAITextError && (error.message.includes('不是合法 JSON') || error.message.includes('没有返回内容'))
  try {
    const text = messageText(data)
    if (!text.trim()) throw new OpenAITextError('OpenAI 没有返回内容，请重试')
    return read(data)
  } catch (error) {
    if (!parseFailure(error)) throw error
    const retryContent = typeof shaped.content === 'string'
      ? `${shaped.content}\n\n上一次没有返回合法 JSON。这次不要解释，只输出 JSON 值本身。`
      : shaped.content.map((part, index) => (index === 0 && part.type === 'text' ? { ...part, text: `${part.text}\n\n上一次没有返回合法 JSON。这次不要解释，只输出 JSON 值本身。` } : part))
    const again = await postChat(env, { ...body, messages: [
      { role: 'system', content: '你是英语学习应用里的 JSON 接口。只输出 JSON，不要代码围栏。' },
      { role: 'user', content: retryContent },
    ] }, timeoutMs, kind)
    const text = messageText(again)
    if (!text.trim()) throw new OpenAITextError('OpenAI 没有返回内容，请重试')
    return read(again)
  }
}
