import type { Env } from './env'
import type { GeminiPart, UsageKind } from './gemini'
import { aiCallCounts, aiLimits } from './gemini'

export const CF_TEXT_MODEL = '@cf/qwen/qwen3-30b-a3b-fp8'

export class CloudflareTextError extends Error {
  constructor(message: string, readonly status = 502) { super(message) }
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

export function parseCloudflareJson<T>(result: unknown, schema: unknown): T {
  const obj = result && typeof result === 'object' ? result as Record<string, unknown> : {}
  const choices = Array.isArray(obj.choices) ? obj.choices : []
  const message = choices[0] && typeof choices[0] === 'object' ? (choices[0] as { message?: { content?: unknown } }).message : undefined
  const raw = obj.response ?? message?.content ?? result
  let value: unknown = raw
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(/^<think>[\s\S]*?<\/think>\s*/i, '')
    const fence = String.fromCharCode(96).repeat(3)
    const text = trimmed.startsWith(fence) ? trimmed.split('\n').slice(1).join('\n').replace(new RegExp('\\s*' + fence + '\\s*$'), '') : trimmed
    try { value = JSON.parse(text) }
    catch { throw new CloudflareTextError('Qwen 返回的不是合法 JSON。请重试或切换 Gemini') }
  }
  if (!verifyShape(value, normalizeSchema(schema))) {
    throw new CloudflareTextError('Qwen 返回的 JSON 字段不完整或类型不符。请重试或切换 Gemini')
  }
  return value as T
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
  if (!env.AI || env.AI_DISABLED === 'true') throw new CloudflareTextError('Cloudflare AI 暂不可用', 503)
  const limits = aiLimits(env)
  const counts = await aiCallCounts(env)
  if (counts.minute >= limits.perMinute) throw new CloudflareTextError('请求过于频繁，请稍后重试', 429)
  if (counts.text >= limits.text) throw new CloudflareTextError('今日文本 AI 调用达到应用上限', 429)
  if (!env.IS_ADMIN && counts.userText >= limits.userText) throw new CloudflareTextError('今日个人文本 AI 调用达到应用上限', 429)
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
): Promise<T> {
  const parts = typeof prompt === 'string' ? [{ text: prompt }] : prompt
  if (parts.some((part) => part.inlineData)) {
    throw new CloudflareTextError('Cloudflare 免费文本模型暂不支持截图识别，请在设置中切换 Gemini 再试', 400)
  }
  await guard(env)
  const user = parts.map((p) => p.text ?? '').join('\n')
  const instruction = [
    '/no_think',
    '你是英语学习应用中的结构化 JSON 生成器。',
    '严格返回一个完整且合法的 JSON 值，不要 Markdown、说明、思考过程或代码块。',
    '必须符合下列 JSON Schema，包含所有 required 字段，字段类型不可变。',
    '输出可以是对象或数组，以 schema 的根 type 为准。',
    'JSON Schema:',
    JSON.stringify(normalizeSchema(schema)),
    '任务内容:',
    user,
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
  return parseCloudflareJson<T>(result, schema)
}
