import type { Env } from './env'
import type { CardMeta, EnrichResult, ItemType, RemixSentence } from '../shared/types'
import { pcmToWav } from './wav'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status = 502,
    /** Google 返回的 HTTP 状态码，用于判断是否要换一种调用方式重试 */
    readonly upstream = 0,
  ) {
    super(message)
  }
}

const baseUrl = (env: Env) =>
  (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '')

async function post<T>(env: Env, path: string, body: unknown): Promise<T> {
  if (!env.GEMINI_API_KEY) throw new GeminiError('服务端未配置 GEMINI_API_KEY', 500)
  const res = await fetch(`${baseUrl(env)}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } }
  if (!res.ok) {
    throw new GeminiError(`Gemini 请求失败（${res.status}）：${data.error?.message ?? '未知错误'}`, 502, res.status)
  }
  return data
}

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

async function generate(env: Env, model: string, body: unknown): Promise<GeminiPart[]> {
  const data = await post<{ candidates?: { content?: { parts?: GeminiPart[] } }[] }>(
    env,
    `/models/${model}:generateContent`,
    body,
  )
  const parts = data.candidates?.[0]?.content?.parts
  if (!parts?.length) throw new GeminiError('Gemini 没有返回内容，请重试')
  return parts
}

async function generateJson<T>(env: Env, prompt: string, schema: unknown): Promise<T> {
  const body = (thinking: boolean) => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: 'application/json',
      responseSchema: schema,
      // 3.x 模型用 thinkingLevel；卡片生成不需要深度思考，用 low 更快更省
      ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
    },
  })
  let parts: GeminiPart[]
  try {
    parts = await generate(env, env.GEMINI_TEXT_MODEL, body(true))
  } catch (e) {
    // 个别模型不认 thinkingLevel 时，去掉再试一次
    if (e instanceof GeminiError && e.upstream === 400) parts = await generate(env, env.GEMINI_TEXT_MODEL, body(false))
    else throw e
  }
  const text = parts.map((p) => p.text ?? '').join('')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new GeminiError('Gemini 返回的不是合法 JSON，请重试')
  }
}

/* ------------------------------ 补全卡片 ------------------------------ */

const enrichSchema = {
  type: 'OBJECT',
  properties: {
    type: { type: 'STRING', enum: ['word', 'sentence'] },
    text: { type: 'STRING' },
    ipa: { type: 'STRING' },
    pos: { type: 'STRING' },
    meaning: { type: 'STRING' },
    example: { type: 'STRING' },
    exampleZh: { type: 'STRING' },
    highlight: { type: 'STRING' },
    phrases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' }, meaning: { type: 'STRING' } },
        required: ['text', 'meaning'],
      },
    },
  },
  required: ['type', 'text', 'ipa', 'pos', 'meaning', 'example', 'exampleZh', 'highlight', 'phrases'],
}

export async function enrich(env: Env, input: string, hint?: ItemType): Promise<EnrichResult> {
  const prompt = `你是一名给中国英语学习者做记忆卡片的老师。用户输入：
"""${input}"""
${hint ? `用户指定类型：${hint}` : ''}

判断它是 word（单词或短语/习语，比如 "rain check"、"break a leg"）还是 sentence（完整句子）。

按以下要求返回 JSON：
- type: "word" 或 "sentence"
- text: 规范化后的原文（修正明显拼写错误；单词用小写原形，专有名词除外；句子保留原样并补全标点）
- ipa: 单词给美式音标，形如 "/ˌserənˈdɪpəti/"；句子给空字符串
- pos: 单词给最常用词性缩写（n. / v. / adj. / adv. / phr. 等）；句子给空字符串
- meaning: 单词给简洁的中文释义，多个义项用"；"分隔，最多 3 个；句子给自然流畅的中文翻译
- example: 单词给一个地道、日常、不超过 20 个单词的英文例句；句子给一个用到其中重点表达的新例句
- exampleZh: 例句的中文翻译
- highlight: example 中要高亮的那个词或短语，必须与 example 中的写法一字不差（包括大小写和词形变化）
- phrases: 单词给 2~3 个常见搭配；句子给 1~3 个值得记的重点短语。每项包含英文 text 和中文 meaning`

  const r = await generateJson<EnrichResult['meta'] & { type: ItemType; text: string }>(env, prompt, enrichSchema)
  const meta: CardMeta = {
    ipa: r.ipa ?? '',
    pos: r.pos ?? '',
    meaning: r.meaning ?? '',
    example: r.example ?? '',
    exampleZh: r.exampleZh ?? '',
    highlight: r.highlight ?? '',
    phrases: Array.isArray(r.phrases) ? r.phrases.slice(0, 3) : [],
  }
  return { type: r.type === 'sentence' ? 'sentence' : 'word', text: (r.text || input).trim(), meta }
}

/* ------------------------------ AI 重组 ------------------------------ */

const remixSchema = {
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      en: { type: 'STRING' },
      zh: { type: 'STRING' },
      highlights: { type: 'ARRAY', items: { type: 'STRING' } },
    },
    required: ['en', 'zh', 'highlights'],
  },
}

export async function remix(env: Env, words: { text: string; meaning: string }[]): Promise<RemixSentence[]> {
  const list = words.map((w, i) => `${i + 1}. ${w.text}（${w.meaning}）`).join('\n')
  const prompt = `你在帮一个中国英语学习者复习。下面是今天要复习的词/句：
${list}

请写 3 个全新的英文句子来练习它们：
- 每句至少用到其中 2 个（如果只有 1 个就用 1 个），合起来要覆盖全部词；如果是整句，就借用其中的关键表达
- 句子自然、地道、贴近日常生活或工作场景，每句不超过 25 个单词，难度适中（大约 CEFR B1~B2）
- 可以对单词做合理的词形变化
- zh：自然的中文翻译
- highlights：该句中用到的目标词/表达，写法必须与 en 中完全一致，便于程序高亮`

  const r = await generateJson<RemixSentence[]>(env, prompt, remixSchema)
  return (Array.isArray(r) ? r : []).slice(0, 5).map((s) => ({
    en: s.en ?? '',
    zh: s.zh ?? '',
    highlights: Array.isArray(s.highlights) ? s.highlights.filter((h) => h && s.en?.includes(h)) : [],
  }))
}

/* ------------------------------ 语音 ------------------------------ */

export async function tts(env: Env, text: string, slow: boolean): Promise<Uint8Array> {
  let audio: { data: string; mimeType: string }
  try {
    audio = await ttsGenerateContent(env, text, slow)
  } catch (e) {
    // 新版 TTS 模型可能只支持 Interactions API：原接口报 400/404 时改走新接口
    if (e instanceof GeminiError && (e.upstream === 400 || e.upstream === 404)) audio = await ttsInteractions(env, text, slow)
    else throw e
  }
  const bin = atob(audio.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  // 已经是 WAV（带 RIFF 头）就直接用；裸 PCM 才补 WAV 头
  const isWav = bytes.length > 12 && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
  if (isWav) return bytes
  const rate = Number(/rate=(\d+)/.exec(audio.mimeType)?.[1] ?? 24000)
  return pcmToWav(bytes, rate)
}

const voice = (env: Env) => env.GEMINI_VOICE || 'Kore'
const style = (slow: boolean) =>
  slow ? 'Read slowly and clearly, pausing slightly between words' : 'Read naturally in a clear American accent'

async function ttsGenerateContent(env: Env, text: string, slow: boolean) {
  const parts = await generate(env, env.GEMINI_TTS_MODEL, {
    // 只发原文：TTS 模型会把前面的风格说明也一起读出来
    contents: [{ role: 'user', parts: [{ text: slow ? `${style(true)}: ${text}` : text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice(env) } } },
    },
  })
  const audio = parts.find((p) => p.inlineData?.data)?.inlineData
  if (!audio) throw new GeminiError('Gemini 没有返回音频，请重试', 502, 404)
  return audio
}

async function ttsInteractions(env: Env, text: string, slow: boolean) {
  const data = await post<unknown>(env, '/interactions', {
    model: env.GEMINI_TTS_MODEL,
    input: [
      {
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: style(slow) }] }],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: voice(env) }] },
  })
  const audio = findAudio(data)
  if (!audio) throw new GeminiError('Gemini 没有返回音频，请重试')
  return audio
}

/** 在响应里找到第一段 base64 音频（兼容 steps[].content[].data 等不同结构） */
function findAudio(node: unknown): { data: string; mimeType: string } | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const n of node) {
      const r = findAudio(n)
      if (r) return r
    }
    return null
  }
  const o = node as Record<string, unknown>
  const mime = (o.mime_type ?? o.mimeType ?? '') as string
  if (typeof o.data === 'string' && o.data.length > 100 && (o.type === 'audio' || mime.startsWith('audio'))) {
    return { data: o.data, mimeType: mime || 'audio/wav' }
  }
  for (const v of Object.values(o)) {
    const r = findAudio(v)
    if (r) return r
  }
  return null
}
