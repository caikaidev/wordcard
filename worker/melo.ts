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
  const data = new TextEncoder().encode(`melo-v1|${MELO_MODEL}|en|${text}`)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `tts/melo-v1/${hash}.mp3`
}

/** Cloudflare's Workers binding returns a JSON object containing base64 MP3 audio. */
export function decodeMeloResult(result: unknown): Uint8Array {
  const raw = result && typeof result === 'object' ? (result as { audio?: unknown }).audio : undefined
  if (typeof raw !== 'string' || !raw) throw new MeloTtsError('MeloTTS 没有返回音频')
  const payload = raw.replace(/^data:audio\/mpeg;base64,/, '')
  let binary: string
  try {
    binary = atob(payload)
  } catch {
    throw new MeloTtsError('MeloTTS 返回的音频格式不正确')
  }
  if (binary.length < 16 || binary.length > MAX_AUDIO_BYTES) throw new MeloTtsError('MeloTTS 返回的音频大小不正确')
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  // MP3 may start with an ID3 tag or with a MPEG frame sync.
  const mp3 = (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
  if (!mp3) throw new MeloTtsError('MeloTTS 返回的不是 MP3 音频')
  return bytes
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

function toMeloError(error: unknown): MeloTtsError {
  if (error instanceof MeloTtsError) return error
  const detail = error instanceof Error ? error.message : String(error)
  const limited = /429|quota|neuron|rate.limit|capacity|exceeded|3036/i.test(detail)
  console.error('MeloTTS inference failed', error)
  return new MeloTtsError(
    limited ? 'Cloudflare Workers AI 免费额度或速率限制已触发，改用系统朗读' : 'MeloTTS 暂时不可用，改用系统朗读',
    limited ? 429 : 503,
  )
}

/** Only count actual new generations, not cache hits. Failed logging must not break audio. */
async function recordGeneration(env: Env) {
  await env.DB.prepare('INSERT INTO usage (ts, kind, model, input_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(Date.now(), 'tts', MELO_MODEL, 0, 0, env.USER_ID ?? '')
    .run()
    .catch((error) => console.error('record MeloTTS usage failed', error))
}

export async function generateMeloTts(env: Env, text: string): Promise<Uint8Array> {
  if (!env.AI) throw new MeloTtsError('未配置 Workers AI 绑定，请检查 wrangler.jsonc')
  await checkQuota(env)
  let bytes: Uint8Array
  try {
    const result = await env.AI.run(MELO_MODEL, { prompt: text, lang: 'en' })
    bytes = decodeMeloResult(result)
  } catch (error) {
    throw toMeloError(error)
  }
  await recordGeneration(env)
  return bytes
}

/** Prewarm only when the exact Melo MP3 is absent; never invoke Gemini TTS. */
export async function warmMeloTts(env: Env, texts: string[]) {
  for (const text of new Set(texts.filter(Boolean))) {
    try {
      const key = await meloTtsKey(text)
      if (await env.AUDIO.head(key)) continue
      const mp3 = await generateMeloTts(env, text)
      await env.AUDIO.put(key, mp3, { httpMetadata: { contentType: MELO_MIME } })
    } catch (error) {
      console.warn('MeloTTS prewarming stopped', error)
      return
    }
  }
}
