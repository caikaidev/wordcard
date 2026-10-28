import type { Env } from './env'
import { aiCallCounts, aiLimits } from './gemini'

/** All new audio uses Cloudflare Workers AI. No fallback to Gemini TTS. */
export const MELO_MODEL = '@cf/myshell-ai/melotts'
export const MELO_MIME = 'audio/mpeg'
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

export class MeloTtsError extends Error {
  constructor(message: string, readonly status = 503) {
    super(message)
  }
}

/** Separate provider/version/format namespace: never reinterpret old Gemini WAV as MP3. */
export async function meloTtsKey(text: string) {
  const data = new TextEncoder().encode(`melo-v2|${MELO_MODEL}|en|${text}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `tts/melo-v2/${hash}.audio`
}

/** Inspect decoded bytes rather than assuming Cloudflare's base64 is MP3.
 * Some model responses may contain WAV: preserve the actual format. */
export type MeloAudio = { bytes: Uint8Array; mimeType: 'audio/mpeg' | 'audio/wav' }

export function decodeMeloResult(result: unknown): MeloAudio {
  const raw = result && typeof result === 'object' && !(result instanceof ArrayBuffer) && !(result instanceof Uint8Array)
    ? (result as { audio?: unknown }).audio : result
  let bytes: Uint8Array
  if (typeof raw === 'string') {
    const base64 = raw.replace(/^data:audio\/[\w.+-]+;base64,/, '').replace(/\s+/g, '')
    if (!base64) throw new MeloTtsError('MeloTTS 没有返回音频')
    let binary: string
    try { binary = atob(base64) }
    catch { throw new MeloTtsError('MeloTTS 返回的音频编码无效') }
    bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  } else if (raw instanceof ArrayBuffer) {
    bytes = new Uint8Array(raw)
  } else if (raw instanceof Uint8Array) {
    bytes = raw
  } else {
    throw new MeloTtsError('MeloTTS 没有返回音频')
  }
  if (bytes.length < 16 || bytes.length > MAX_AUDIO_BYTES) throw new MeloTtsError('MeloTTS 返回的音频大小不正确')
  const mp3 = (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51)
    || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (mp3) return { bytes, mimeType: 'audio/mpeg' }
  const wav = bytes[0] === 82 && bytes[1] === 73 && bytes[2] === 70 && bytes[3] === 70
    && bytes[8] === 87 && bytes[9] === 65 && bytes[10] === 86 && bytes[11] === 69
  if (wav) return { bytes, mimeType: 'audio/wav' }
  // Log only twelve header bytes, never the full audio content.
  const sig = [...bytes.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join(' ')
  console.warn('MeloTTS unknown audio signature', { sig, size: bytes.length })
  throw new MeloTtsError('MeloTTS 返回未知音频格式（文件头：' + sig + '），请反馈此错误信息')
}

/**
 * Conservative application guard for new syntheses, including prewarming.
 * These are request limits, NOT an exact Neuron meter: Cloudflare's daily
 * 10,000-Neuron allocation is account-wide and shared with any other AI usage.
 * On Workers Paid the app caps do not mathematically guarantee zero billing.
 */
async function checkQuota(env: Env) {
  if (env.AI_DISABLED === 'true') throw new MeloTtsError('AI 已暂停，已缓存语音仍可播放', 429)
  const limits = aiLimits(env)
  const count = await aiCallCounts(env)
  if (count.minute >= limits.perMinute || count.minuteTts >= limits.ttsPerMinute)
    throw new MeloTtsError('语音调用过于频繁，请稍后重试', 429)
  if (count.tts >= limits.tts) throw new MeloTtsError('今日新语音数量已达应用上限，缓存语音仍可播放', 429)
  if (!env.IS_ADMIN && count.userTts >= limits.userTts)
    throw new MeloTtsError('今日个人新语音数量已达上限，缓存语音仍可播放', 429)
}

/**
 * Use Cloudflare's *specific* error codes instead of telling every 429 user
 * they exhausted the free allocation. Never forward raw upstream exceptions,
 * which may contain request/account metadata.
 */
export function classifyMeloError(error: unknown): MeloTtsError {
  if (error instanceof MeloTtsError) return error
  const object = error && typeof error === 'object' ? error as Record<string, unknown> : {}
  const nested = object.cause && typeof object.cause === 'object' ? object.cause as Record<string, unknown> : {}
  const detail = [error instanceof Error ? error.message : typeof error === 'string' ? error : '',
    object.code, object.errorCode, object.status, nested.code, nested.errorCode, nested.message]
    .filter((v) => v !== undefined && v !== null)
    .join(' ')
  // 3036: truly out of daily free Neurons, 3040: capacity only.
  if (/\b3036\b|daily free allocation|free allocation.*exceed/i.test(detail))
    return new MeloTtsError('Cloudflare 账号今天的 Workers AI 免费 Neurons 已耗尽（错误 3036）', 429)
  if (/\b3040\b|out of capacity|capacity temporarily exceeded/i.test(detail))
    return new MeloTtsError('MeloTTS 当前容量不足（错误 3040），不是免费额度用完', 503)
  if (/\b5035\b|requires Workers Paid plan/i.test(detail))
    return new MeloTtsError('当前模型需要 Workers Paid 计划（错误 5035）', 403)
  if (/\b5007\b|\b3042\b|no such model|invalid model id/i.test(detail))
    return new MeloTtsError('Cloudflare 找不到 MeloTTS 模型（5007/3042）', 502)
  if (/\b429\b|rate.?limit|too many requests/i.test(detail))
    return new MeloTtsError('Cloudflare 请求被限流（429），不能据此认定免费额度已耗尽', 429)
  if (/\b403\b|\b401\b|not allowed|not authorized|permission/i.test(detail))
    return new MeloTtsError('Cloudflare 账户暂无此模型的访问权限（401/403）', 403)
  if (/\b3007\b|timeout|timed out/i.test(detail))
    return new MeloTtsError('MeloTTS 推理超时，请重试', 504)
  return new MeloTtsError('MeloTTS 推理失败（不是已确认的额度不足），请检查 Workers Logs', 503)
}

function toMeloError(error: unknown): MeloTtsError {
  console.error('MeloTTS inference failed', error)
  return classifyMeloError(error)
}

/** Only count actual new generations, not cache hits. Failed logging must not break audio. */
async function recordGeneration(env: Env) {
  await env.DB.prepare('INSERT INTO usage (ts, kind, model, input_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), 'tts', MELO_MODEL, 0, 0, env.USER_ID ?? '')
    .run()
    .catch((error) => console.error('record MeloTTS usage failed', error))
}

export async function generateMeloTts(env: Env, text: string): Promise<MeloAudio> {
  if (!env.AI) throw new MeloTtsError('未配置 Workers AI 绑定，请检查 wrangler.jsonc')
  await checkQuota(env)
  let audio: MeloAudio
  try {
    const result = await env.AI.run(MELO_MODEL, { prompt: text, lang: 'en' })
    audio = decodeMeloResult(result)
  } catch (error) {
    throw toMeloError(error)
  }
  await recordGeneration(env)
  return audio
}

/** Prewarm only when the exact Melo MP3 is absent; never invoke Gemini TTS. */
export async function warmMeloTts(env: Env, texts: string[]) {
  for (const text of new Set(texts.filter(Boolean))) {
    try {
      const key = await meloTtsKey(text)
      if (await env.AUDIO.head(key)) continue
      const audio = await generateMeloTts(env, text)
      await env.AUDIO.put(key, audio.bytes, { httpMetadata: { contentType: audio.mimeType } })
    } catch (error) {
      console.warn('MeloTTS prewarming stopped', error)
      return
    }
  }
}
