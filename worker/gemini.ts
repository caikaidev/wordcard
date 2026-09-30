import type { Env } from './env'
import type { CardMeta, EnrichResult, ItemType, RemixSentence } from '../shared/types'
import { pcmToWav } from './wav'
import { SOURCE_LABEL, type DictResult, type DictSense } from './dictionary'

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

/* ------------------------------ 费用闸门 ------------------------------ */

const DAY = 86_400_000
const TZ = 8 * 3600_000

export function aiLimits(env: Env) {
  const n = (v: string | undefined, d: number) => (Number(v) > 0 ? Number(v) : d)
  return {
    disabled: env.AI_DISABLED === 'true',
    text: n(env.DAILY_TEXT_LIMIT, 300),
    tts: n(env.DAILY_TTS_LIMIT, 600),
    perMinute: n(env.PER_MINUTE_LIMIT, 40),
    ttsPerMinute: n(env.TTS_PER_MINUTE_LIMIT, 8),
    // 普通用户的个人每日上限（管理员只受全站上限约束）
    userText: n(env.USER_DAILY_TEXT_LIMIT, 60),
    userTts: n(env.USER_DAILY_TTS_LIMIT, 15),
  }
}

/** 今天（北京时间）和最近一分钟的调用次数（全站 + 当前用户）；失败的调用也计入 */
export async function aiCallCounts(env: Env) {
  const now = Date.now()
  const dayStart = Math.floor((now + TZ) / DAY) * DAY - TZ
  const r = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN ts >= ?1 AND kind != 'tts' THEN 1 ELSE 0 END), 0) AS text,
       COALESCE(SUM(CASE WHEN ts >= ?1 AND kind = 'tts' THEN 1 ELSE 0 END), 0) AS tts,
       COALESCE(SUM(CASE WHEN ts >= ?2 THEN 1 ELSE 0 END), 0) AS minute,
       COALESCE(SUM(CASE WHEN ts >= ?2 AND kind = 'tts' THEN 1 ELSE 0 END), 0) AS minuteTts,
       COALESCE(SUM(CASE WHEN ts >= ?1 AND kind != 'tts' AND user_id = ?3 THEN 1 ELSE 0 END), 0) AS userText,
       COALESCE(SUM(CASE WHEN ts >= ?1 AND kind = 'tts' AND user_id = ?3 THEN 1 ELSE 0 END), 0) AS userTts
     FROM usage WHERE ts >= MIN(?1, ?2)`,
  )
    .bind(dayStart, now - 60_000, env.USER_ID ?? '')
    .first<{ text: number; tts: number; minute: number; minuteTts: number; userText: number; userTts: number }>()
  return {
    text: r?.text ?? 0,
    tts: r?.tts ?? 0,
    minute: r?.minute ?? 0,
    minuteTts: r?.minuteTts ?? 0,
    userText: r?.userText ?? 0,
    userTts: r?.userTts ?? 0,
  }
}

async function guard(env: Env, kind: UsageKind) {
  const limits = aiLimits(env)
  if (limits.disabled) throw new GeminiError('AI 功能已暂停（AI_DISABLED）', 503)
  const c = await aiCallCounts(env)
  if (c.minute >= limits.perMinute) throw new GeminiError('调用太频繁了，歇一分钟再试', 429)
  if (kind === 'tts' && c.minuteTts >= limits.ttsPerMinute) throw new GeminiError('语音生成太频繁了，歇一分钟再试', 429)
  // 普通用户先检查个人额度，保护全站额度不被一个人用完
  if (!env.IS_ADMIN) {
    if (kind === 'tts' && c.userTts >= limits.userTts) {
      throw new GeminiError(`你今天的新语音额度（${limits.userTts} 段）用完了，已缓存的语音照常能播`, 429)
    }
    if (kind !== 'tts' && c.userText >= limits.userText) {
      throw new GeminiError(`你今天的 AI 调用额度（${limits.userText} 次）用完了，明天再来`, 429)
    }
  }
  if (kind === 'tts' ? c.tts >= limits.tts : c.text >= limits.text) {
    throw new GeminiError(
      kind === 'tts'
        ? `今天生成的语音已达上限（${limits.tts} 段），明天再来；已缓存的语音照常能播`
        : `今天的 AI 调用已达上限（${limits.text} 次），明天再来`,
      429,
    )
  }
}

/* ------------------------------ 请求 ------------------------------ */

type UsageMeta = {
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

/** 所有 Gemini 请求的唯一出口：先过闸门，再请求，最后记账（失败也记一次） */
async function post<T>(env: Env, path: string, body: unknown, call: { kind: UsageKind; model: string }): Promise<T> {
  if (!env.GEMINI_API_KEY) throw new GeminiError('服务端未配置 GEMINI_API_KEY', 500)
  await guard(env, call.kind)
  let res: Response
  try {
    res = await fetch(`${baseUrl(env)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    })
  } catch {
    await recordUsage(env, call.kind, call.model, 0, 0)
    throw new GeminiError('连不上 Gemini，请稍后再试')
  }
  const data = (await res.json().catch(() => ({}))) as T & UsageMeta & { error?: { message?: string } }
  const u = data.usageMetadata
  const alt = u ? null : findUsage(data)
  await recordUsage(
    env,
    call.kind,
    call.model,
    u ? (u.promptTokenCount ?? 0) : (alt?.input ?? 0),
    u ? (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) : (alt?.output ?? 0),
  )
  if (res.status === 429) {
    // Google 那边的速率 / 每日额度用完了（每日额度按美国太平洋时间零点重置，约北京时间 15–16 点）
    throw new GeminiError(
      call.kind === 'tts'
        ? 'Google 的语音额度暂时用完了（每分钟 10 次 / 每天 100 次），稍后再试；已缓存的语音照常能播'
        : 'Google 的调用额度暂时用完了，稍后再试',
      429,
      429,
    )
  }
  if (!res.ok) {
    throw new GeminiError(`Gemini 请求失败（${res.status}）：${data.error?.message ?? '未知错误'}`, 502, res.status)
  }
  return data
}

export interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

export type UsageKind = 'enrich' | 'remix' | 'tts' | 'lesson' | 'grade' | 'translate'

/** 记录一次调用的 token 用量（失败不影响主流程） */
async function recordUsage(env: Env, kind: UsageKind, model: string, input: number, output: number) {
  try {
    await env.DB.prepare('INSERT INTO usage (ts, kind, model, input_tokens, output_tokens, user_id) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), kind, model, Math.round(input) || 0, Math.round(output) || 0, env.USER_ID ?? '')
      .run()
  } catch (e) {
    console.error('recordUsage failed', e)
  }
}

async function generate(env: Env, model: string, body: unknown, kind: UsageKind): Promise<GeminiPart[]> {
  const data = await post<{ candidates?: { content?: { parts?: GeminiPart[] } }[] }>(
    env,
    `/models/${model}:generateContent`,
    body,
    { kind, model },
  )
  const parts = data.candidates?.[0]?.content?.parts
  if (!parts?.length) throw new GeminiError('Gemini 没有返回内容，请重试')
  return parts
}

export async function generateJson<T>(
  env: Env,
  prompt: string | GeminiPart[],
  schema: unknown,
  kind: UsageKind,
  temperature = 0.7,
  /** 思考强度：翻译这类不需要推理的任务用 minimal，更快更省 */
  thinkingLevel: 'minimal' | 'low' = 'low',
): Promise<T> {
  const userParts = typeof prompt === 'string' ? [{ text: prompt }] : prompt
  const body = (thinking: boolean) => ({
    contents: [{ role: 'user', parts: userParts }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
      // 3.x 模型用 thinkingLevel；卡片生成不需要深度思考，用 low 更快更省
      ...(thinking ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  })
  let parts: GeminiPart[]
  try {
    parts = await generate(env, env.GEMINI_TEXT_MODEL, body(true), kind)
  } catch (e) {
    // 个别模型不认 thinkingLevel 时，去掉再试一次
    if (e instanceof GeminiError && e.upstream === 400) parts = await generate(env, env.GEMINI_TEXT_MODEL, body(false), kind)
    else throw e
  }
  const text = parts.map((p) => p.text ?? '').join('')
  try {
    return JSON.parse(text) as T
  } catch {
    throw new GeminiError('Gemini 返回的不是合法 JSON，请重试')
  }
}

/* ------------------------------ 读取网页 ------------------------------ */

const NO_ACCESS = 'NO_ACCESS'

/**
 * 直接抓取失败时（很多网站会拦截云服务器的请求），改用 Gemini 官方的 URL context 工具读取网页正文。
 * 只有 Gemini 明确报告“成功读取了这个链接”才采用结果，避免模型读不到时凭空编一篇。
 * 读取到的网页内容按输入 token 计费，记在“生成练习”名下。
 */
export async function readUrl(env: Env, url: string): Promise<{ title: string; text: string }> {
  const prompt = `Read the web page at ${url} and output its main article content as plain text.
Rules:
- First line: the article title. Then an empty line. Then the article body, keeping paragraph breaks.
- Output the COMPLETE article from beginning to end. Do not summarize, shorten or skip sections.
- Keep the author's original wording. Leave out navigation, ads, cookie notices, related links and comments.
- If the page cannot be retrieved or has no readable article, output exactly: ${NO_ACCESS}`
  const body = (thinking: boolean) => ({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ url_context: {} }],
    generationConfig: { temperature: 0, maxOutputTokens: 16384, ...(thinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}) },
  })
  type Resp = {
    candidates?: {
      content?: { parts?: GeminiPart[] }
      urlContextMetadata?: { urlMetadata?: { retrievedUrl?: string; urlRetrievalStatus?: string }[] }
    }[]
  }
  const call = (thinking: boolean) =>
    post<Resp>(env, `/models/${env.GEMINI_TEXT_MODEL}:generateContent`, body(thinking), { kind: 'lesson', model: env.GEMINI_TEXT_MODEL })
  let data: Resp
  try {
    data = await call(true)
  } catch (e) {
    if (e instanceof GeminiError && e.upstream === 400) data = await call(false)
    else throw e
  }
  const cand = data.candidates?.[0]
  const ok = (cand?.urlContextMetadata?.urlMetadata ?? []).some((m) => m.urlRetrievalStatus === 'URL_RETRIEVAL_STATUS_SUCCESS')
  const out = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim()
  if (!ok || !out || out.startsWith(NO_ACCESS)) throw new GeminiError('读不到这个网页', 400)
  const [first, ...rest] = out.split('\n')
  return { title: first.replace(/^#+\s*/, '').trim(), text: rest.join('\n').trim() }
}

/* ------------------------------ 段落翻译 ------------------------------ */

/** 按段翻译成中文（阅读时对照用）；返回与输入等长的数组 */
export async function translateParagraphs(env: Env, paras: string[]): Promise<string[]> {
  const prompt = `把下面的英文段落逐段翻译成自然、准确的简体中文，给中国的英语学习者对照阅读。
要求：意思忠实，不增不减；技术术语保留常见译法，必要时括号里保留英文原词；列表项开头的 "•" 照样保留。
返回 JSON：translations 数组，长度必须是 ${paras.length}，第 i 项对应第 i 段。

${paras.map((p, i) => `[${i + 1}] ${p}`).join('\n\n')}`
  const r = await generateJson<{ translations?: string[] }>(
    env,
    prompt,
    { type: 'OBJECT', properties: { translations: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['translations'] },
    'translate',
    0.2,
    'minimal',
  )
  const out = Array.isArray(r.translations) ? r.translations : []
  return paras.map((_, i) => (typeof out[i] === 'string' ? out[i].trim() : ''))
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
    senseIndex: { type: 'INTEGER' },
    cloze: {
      type: 'OBJECT',
      properties: { scene: { type: 'STRING' }, sentence: { type: 'STRING' }, answer: { type: 'STRING' } },
      required: ['scene', 'sentence', 'answer'],
    },
    phrases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { text: { type: 'STRING' }, meaning: { type: 'STRING' } },
        required: ['text', 'meaning'],
      },
    },
  },
  required: ['type', 'text', 'ipa', 'pos', 'meaning', 'example', 'exampleZh', 'highlight', 'phrases', 'senseIndex', 'cloze'],
}

const senseList = (senses: DictSense[]) => senses.map((s, i) => `${i + 1}. (${s.pos || '—'}) ${s.def}`).join('\n')

export async function enrich(env: Env, input: string, hint?: ItemType, dict?: DictResult | null, context?: string): Promise<EnrichResult> {
  const prompt = `你是一名给中国英语学习者做记忆卡片的老师。用户输入：
"""${input}"""
${hint ? `用户指定类型：${hint}` : ''}
${
  context
    ? `用户是在阅读时从下面这句话里收藏的，meaning 必须是它在这句话里的意思（不要列无关义项）；example 直接用这句原文（超过 30 个词时截取包含它的一段），exampleZh 翻译这句；highlight 是它在原文里的写法；text 仍给规范化原形：
"""${context}"""`
    : ''
}

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
- phrases: 单词给 2~3 个常见搭配；句子给 1~3 个值得记的重点短语。每项包含英文 text 和中文 meaning
- cloze: 产出练习（看情境说出表达），必须换一个和 example 不同的新情境，贴近职场或日常：
  scene 用中文写情境并点明想表达的意思（如"项目依赖可能拖慢进度，想说它'构成风险'"）；
  sentence 是这个情境下自然的英文句子，把目标词/短语挖成 ____（四个下划线，其余照写）；
  answer 是被挖掉的原文（可以有词形变化）。句子类型也照做，挖掉其中最值得记的表达
- senseIndex: ${
    dict
      ? `下面是词典（${SOURCE_LABEL[dict.source]}）给出的英英义项。选出与你给的 meaning 和 example 最一致的一条，填它的编号（从 1 开始）；都不合适填 0。meaning 和 example 应优先围绕最常用的那个义项：
${senseList(dict.senses)}`
      : '没有词典数据，填 0'
  }`

  const r = await generateJson<EnrichResult['meta'] & { type: ItemType; text: string; senseIndex?: number }>(
    env,
    prompt,
    enrichSchema,
    'enrich',
  )
  const pick = dict && r.senseIndex && r.senseIndex >= 1 ? dict.senses[r.senseIndex - 1] : undefined
  const meta: CardMeta = {
    ipa: r.ipa ?? '',
    pos: r.pos ?? '',
    meaning: r.meaning ?? '',
    example: r.example ?? '',
    exampleZh: r.exampleZh ?? '',
    highlight: r.highlight ?? '',
    phrases: Array.isArray(r.phrases) ? r.phrases.slice(0, 3) : [],
    // 英英释义只用词典原文，AI 只负责“选哪一条”
    definitionEn: pick?.def ?? '',
    definitionSrc: pick && dict ? SOURCE_LABEL[dict.source] : '',
    cloze:
      r.cloze?.answer && r.cloze.sentence?.includes('____')
        ? { scene: r.cloze.scene ?? '', sentence: r.cloze.sentence, answer: r.cloze.answer }
        : undefined,
  }
  return { type: r.type === 'sentence' ? 'sentence' : 'word', text: (r.text || input).trim(), meta }
}

/** 已有释义和例句的卡片：从词典义项里选出语境对应的那条（只有一条时不调用 AI） */
export async function pickSense(env: Env, word: string, dict: DictResult, meaning: string, example: string) {
  if (dict.senses.length === 1) return dict.senses[0]
  const r = await generateJson<{ senseIndex?: number }>(
    env,
    `单词/短语：${word}
中文释义：${meaning || '（无）'}
例句：${example || '（无）'}

下面是词典（${SOURCE_LABEL[dict.source]}）的英英义项，选出与上面的中文释义和例句最一致的一条，返回它的编号（从 1 开始）；都不合适返回 0：
${senseList(dict.senses)}`,
    { type: 'OBJECT', properties: { senseIndex: { type: 'INTEGER' } }, required: ['senseIndex'] },
    'enrich',
    0,
  )
  const i = Number(r.senseIndex)
  return i >= 1 && i <= dict.senses.length ? dict.senses[i - 1] : null
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

  const r = await generateJson<RemixSentence[]>(env, prompt, remixSchema, 'remix')
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
  const parts = await generate(
    env,
    env.GEMINI_TTS_MODEL,
    {
    // 只发原文：TTS 模型会把前面的风格说明也一起读出来
    contents: [{ role: 'user', parts: [{ text: slow ? `${style(true)}: ${text}` : text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice(env) } } },
    },
    },
    'tts',
  )
  const audio = parts.find((p) => p.inlineData?.data)?.inlineData
  if (!audio) throw new GeminiError('Gemini 没有返回音频，请重试', 502, 404)
  return audio
}

async function ttsInteractions(env: Env, text: string, slow: boolean) {
  const data = await post<unknown>(
    env,
    '/interactions',
    {
    model: env.GEMINI_TTS_MODEL,
    input: [
      {
        type: 'user_input',
        content: [{ type: 'text', text, annotations: [{ type: 'speech_metadata', style: style(slow) }] }],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice: voice(env) }] },
    },
    { kind: 'tts', model: env.GEMINI_TTS_MODEL },
  )
  const audio = findAudio(data)
  if (!audio) throw new GeminiError('Gemini 没有返回音频，请重试')
  return audio
}

/** Interactions API 的用量字段名不固定，按 input/output 关键字找 */
function findUsage(data: unknown): { input: number; output: number } | null {
  const u = (data as { usage?: Record<string, unknown> } | null)?.usage
  if (!u || typeof u !== 'object') return null
  let input = 0
  let output = 0
  for (const [k, v] of Object.entries(u)) {
    if (typeof v !== 'number') continue
    if (/input|prompt/i.test(k) && /total/i.test(k)) input = v
    else if (/output|thought|candidate/i.test(k) && /total/i.test(k)) output += v
  }
  return input || output ? { input, output } : null
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
