import { Hono } from 'hono'
import type { AppEnv, Env } from './env'
import { generateJson, GeminiError, type GeminiPart } from './gemini'
import { aiEnv, loadSettings } from './settings'
import {
  LEVEL_RULES,
  TASK_GOALS,
  isLevel,
  type GradeResult,
  type Lesson,
  type LessonContent,
  type LessonSummary,
  type Level,
  type PracticeStats,
  type Submission,
} from '../shared/practice'

export const practice = new Hono<AppEnv>()

const DAY = 86_400_000
const TZ = 8 * 3600_000 // 按北京时间算“哪一天”
const dayOf = (ts: number) => Math.floor((ts + TZ) / DAY)

/* ============================== 读文章 ============================== */

const MAX_ARTICLE_CHARS = 14_000

function decodeEntities(s: string) {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

/** 粗略地把 HTML 变成正文：去掉脚本/导航，优先取 <article>/<main> */
function htmlToText(html: string) {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '')
  let body = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  const main = /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0] ?? /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0]
  if (main && main.length > 1500) body = main
  const text = decodeEntities(
    body
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/pre|\/blockquote|\/tr)\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim()
  return { title, text }
}

async function fetchReddit(url: URL) {
  // Reddit 页面是 JS 渲染的，改用它的 JSON 接口取标题、正文和几条高赞评论
  const res = await fetch(`${url.origin}${url.pathname.replace(/\/$/, '')}.json?limit=5&sort=top`, {
    headers: { 'user-agent': 'wordcard/1.0 (personal English practice)' },
  })
  if (!res.ok) throw new Error(`reddit ${res.status}`)
  const data = (await res.json()) as {
    data: { children: { data: { title?: string; selftext?: string; body?: string } }[] }
  }[]
  const post = data[0]?.data.children[0]?.data
  const comments = (data[1]?.data.children ?? [])
    .map((c) => c.data.body)
    .filter(Boolean)
    .slice(0, 5)
  return {
    title: post?.title ?? '',
    text: [post?.title, post?.selftext, ...comments.map((c, i) => `Comment ${i + 1}: ${c}`)].filter(Boolean).join('\n\n'),
  }
}

async function fetchArticle(raw: string) {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new GeminiError('链接格式不对', 400)
  }
  if (!/^https?:$/.test(url.protocol)) throw new GeminiError('只支持 http(s) 链接', 400)
  const res = await fetch(url.toString(), {
    redirect: 'follow',
    headers: {
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-US,en;q=0.9',
    },
  }).catch(() => null)
  const finalUrl = res?.url ? new URL(res.url) : url
  if (/(^|\.)reddit\.com$/.test(finalUrl.hostname)) {
    try {
      return { ...(await fetchReddit(finalUrl)), url: finalUrl.toString() }
    } catch {
      /* 落到下面的通用处理 */
    }
  }
  if (!res || !res.ok) {
    throw new GeminiError(`这个链接打不开（${res?.status ?? '网络错误'}），可以粘贴正文或上传截图`, 400)
  }
  const { title, text } = htmlToText(await res.text())
  if (text.length < 300) throw new GeminiError('没能从这个链接读到正文（可能需要登录或是动态页面），可以粘贴正文或上传截图', 400)
  return { title, text: text.slice(0, MAX_ARTICLE_CHARS), url: finalUrl.toString() }
}

/* ============================== 生成练习 ============================== */

const lessonSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING' },
    fit: { type: 'STRING', enum: ['ok', 'hard', 'easy'] },
    fitNote: { type: 'STRING' },
    summary: { type: 'STRING' },
    words: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { word: { type: 'STRING' }, ipa: { type: 'STRING' }, meaning: { type: 'STRING' }, quote: { type: 'STRING' } },
        required: ['word', 'ipa', 'meaning', 'quote'],
      },
    },
    expressions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { pattern: { type: 'STRING' }, meaning: { type: 'STRING' }, example: { type: 'STRING' } },
        required: ['pattern', 'meaning', 'example'],
      },
    },
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { goal: { type: 'STRING' }, prompt: { type: 'STRING' }, template: { type: 'STRING' } },
        required: ['goal', 'prompt', 'template'],
      },
    },
    speaking: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { question: { type: 'STRING' }, hint: { type: 'STRING' } },
        required: ['question', 'hint'],
      },
    },
  },
  required: ['title', 'fit', 'fitNote', 'summary', 'words', 'expressions', 'tasks', 'speaking'],
}

function lessonPrompt(profile: string, level: Level, source: string) {
  return `你是一名英语教练。根据下面提供的文章，为学习者设计一次 15–30 分钟的练习。

# 学习者设定
${profile}

# 当前档位
${LEVEL_RULES[level].task}

# 要求（讲解用中文，示例用英文）
- title：文章标题（英文原标题；没有就起一个简短的）
- fit：这篇文章对学习者现阶段是否合适（ok / hard / easy）；fitNote：一两句中文说明，太难就直接说并建议换什么材料
- summary：一句简单英文概括文章主旨
- words：最多 5 个值得学的生词或短语，只选文章里出现过的；ipa 美式音标（短语可留空）；meaning 中文释义；quote 文章原句（可截取片段）
- expressions：2–3 个能直接用在工作面试或职场沟通里的英文句式（pattern，用 ... 表示可替换部分），meaning 中文说明，example 贴近学习者工作的英文例句
- tasks：固定 3 个，依次是
  1. 讲清楚：文章讲了什么
  2. 有观点：同意或不同意什么，为什么
  3. 连到自己：和学习者的工作或经历有什么关系
  goal 分别填 "${TASK_GOALS.join('" "')}"；prompt 用中文说明这一句要写什么（可给思路提示）；template 按当前档位给出（挑战档留空字符串）
- speaking：1–2 个英文口语题，模拟面试官提问方式，可在散步时用 1 分钟回答；hint 中文提示回答思路
- 回复简洁，适合手机阅读

# 文章
${source}`
}

function cleanLesson(r: Partial<LessonContent>, level: Level): LessonContent {
  const str = (v: unknown, max = 1000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const arr = <T,>(v: unknown, n: number) => (Array.isArray(v) ? (v.slice(0, n) as T[]) : [])
  const tasks = arr<LessonContent['tasks'][number]>(r.tasks, 3).map((t, i) => ({
    goal: str(t?.goal, 20) || TASK_GOALS[i],
    prompt: str(t?.prompt),
    template: level === 3 ? '' : str(t?.template, 300),
  }))
  while (tasks.length < 3) tasks.push({ goal: TASK_GOALS[tasks.length], prompt: '', template: '' })
  return {
    title: str(r.title, 200) || 'Untitled',
    fit: r.fit === 'hard' || r.fit === 'easy' ? r.fit : 'ok',
    fitNote: str(r.fitNote, 400),
    summary: str(r.summary, 500),
    words: arr<LessonContent['words'][number]>(r.words, 5).map((w) => ({
      word: str(w?.word, 80),
      ipa: str(w?.ipa, 80),
      meaning: str(w?.meaning, 200),
      quote: str(w?.quote, 400),
    })),
    expressions: arr<LessonContent['expressions'][number]>(r.expressions, 3).map((e) => ({
      pattern: str(e?.pattern, 200),
      meaning: str(e?.meaning, 200),
      example: str(e?.example, 400),
    })),
    tasks,
    speaking: arr<LessonContent['speaking'][number]>(r.speaking, 2).map((q) => ({
      question: str(q?.question, 300),
      hint: str(q?.hint, 300),
    })),
  }
}

practice.post('/lessons', async (c) => {
  const body = await c.req.json<{ url?: unknown; text?: unknown; images?: unknown; level?: unknown }>()
  const user = c.get('user')
  const settings = await loadSettings(c.env, user)
  const level: Level = isLevel(Number(body.level)) ? (Number(body.level) as Level) : settings.practiceLevel

  const images = Array.isArray(body.images)
    ? (body.images as { mime?: unknown; data?: unknown }[])
        .filter((i) => typeof i?.data === 'string' && typeof i?.mime === 'string' && /^image\/(jpeg|png|webp)$/.test(i.mime as string))
        .slice(0, 6)
    : []
  const url = typeof body.url === 'string' ? body.url.trim() : ''
  const pasted = typeof body.text === 'string' ? body.text.trim().slice(0, MAX_ARTICLE_CHARS) : ''

  let source = ''
  let sourceUrl: string | null = null
  let fetchedTitle = ''
  if (pasted) source = pasted
  else if (url) {
    const a = await fetchArticle(url)
    source = a.text
    sourceUrl = a.url
    fetchedTitle = a.title
  }
  if (!source && !images.length) return c.json({ error: '请提供链接、正文或截图' }, 400)
  if (url && !sourceUrl) sourceUrl = url

  const prompt = lessonPrompt(
    settings.coachProfile,
    level,
    images.length ? `${source ? source + '\n\n' : ''}（文章内容见附上的 ${images.length} 张截图，请先读出其中的英文正文）` : source,
  )
  const parts: GeminiPart[] = [
    { text: prompt },
    ...images.map((i) => ({ inlineData: { mimeType: i.mime as string, data: i.data as string } })),
  ]
  const raw = await generateJson<Partial<LessonContent>>(await aiEnv(c.env, user, c.get('admin')), parts, lessonSchema, 'lesson')
  const content = cleanLesson(raw, level)
  if (fetchedTitle && (!content.title || content.title === 'Untitled')) content.title = fetchedTitle

  const row = await c.env.DB.prepare(
    'INSERT INTO lessons (created_at, level, source_url, title, content, user_id) VALUES (?, ?, ?, ?, ?, ?) RETURNING id',
  )
    .bind(Date.now(), level, sourceUrl, content.title, JSON.stringify(content), user)
    .first<{ id: number }>()
  return c.json({ id: row!.id }, 201)
})

/* ============================== 列表 / 详情 ============================== */

practice.get('/lessons', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT l.id, l.created_at, l.level, l.title,
            COUNT(DISTINCT CASE WHEN s.passed = 1 THEN s.idx END) AS passed,
            COUNT(DISTINCT s.idx) AS submitted
     FROM lessons l LEFT JOIN submissions s ON s.lesson_id = l.id
     WHERE l.user_id = ?
     GROUP BY l.id ORDER BY l.created_at DESC LIMIT 100`,
  )
    .bind(c.get('user'))
    .all<LessonSummary>()
  return c.json({ lessons: results })
})

/** 参考版本：这句通过了或已经改过两次，才给前端 */
function visibleSubmissions(rows: (Omit<Submission, 'passed' | 'result'> & { passed: number; result: string })[]) {
  const unlocked = new Set<number>()
  const attempts = new Map<number, number>()
  for (const r of rows) {
    attempts.set(r.idx, Math.max(attempts.get(r.idx) ?? 0, r.attempt))
    if (r.passed) unlocked.add(r.idx)
  }
  for (const [idx, n] of attempts) if (n >= 2) unlocked.add(idx)
  return rows.map((r): Submission => {
    const result = JSON.parse(r.result) as GradeResult
    if (!unlocked.has(r.idx)) result.reference = ''
    return { ...r, passed: !!r.passed, result }
  })
}

async function loadLesson(env: Env, id: number, user: string): Promise<Lesson | null> {
  const l = await env.DB.prepare('SELECT * FROM lessons WHERE id = ? AND user_id = ?')
    .bind(id, user)
    .first<{ id: number; created_at: number; level: number; source_url: string | null; title: string; content: string }>()
  if (!l) return null
  const { results } = await env.DB.prepare(
    'SELECT id, idx, attempt, text, passed, result, created_at FROM submissions WHERE lesson_id = ? ORDER BY created_at',
  )
    .bind(id)
    .all<Omit<Submission, 'passed' | 'result'> & { passed: number; result: string }>()
  return {
    id: l.id,
    created_at: l.created_at,
    level: (isLevel(l.level) ? l.level : 1) as Level,
    source_url: l.source_url,
    title: l.title,
    content: JSON.parse(l.content) as LessonContent,
    submissions: visibleSubmissions(results),
  }
}

practice.get('/lessons/:id', async (c) => {
  const lesson = await loadLesson(c.env, Number(c.req.param('id')), c.get('user'))
  if (!lesson) return c.json({ error: '找不到这份练习' }, 404)
  return c.json({ lesson })
})

practice.delete('/lessons/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const user = c.get('user')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM submissions WHERE lesson_id = ? AND user_id = ?').bind(id, user),
    c.env.DB.prepare('DELETE FROM lessons WHERE id = ? AND user_id = ?').bind(id, user),
  ])
  return c.body(null, 204)
})

/* ============================== 批改 ============================== */

const gradeSchema = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING', enum: ['pass', 'revise'] },
    praise: { type: 'STRING' },
    corrections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { original: { type: 'STRING' }, fixed: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['original', 'fixed', 'reason'],
      },
    },
    keyPoint: { type: 'STRING' },
    hint: { type: 'STRING' },
    reference: { type: 'STRING' },
    translations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { zh: { type: 'STRING' }, en: { type: 'STRING' } },
        required: ['zh', 'en'],
      },
    },
    scores: {
      type: 'OBJECT',
      properties: {
        content: { type: 'INTEGER' },
        grammar: { type: 'INTEGER' },
        naturalness: { type: 'INTEGER' },
        expression: { type: 'INTEGER' },
      },
      required: ['content', 'grammar', 'naturalness', 'expression'],
    },
    remember: {
      type: 'OBJECT',
      properties: { text: { type: 'STRING' }, meaning: { type: 'STRING' }, example: { type: 'STRING' } },
      required: ['text', 'meaning', 'example'],
    },
  },
  required: ['verdict', 'praise', 'corrections', 'keyPoint', 'hint', 'reference', 'translations', 'scores', 'remember'],
}

function gradePrompt(profile: string, lesson: Lesson, idx: number, text: string, history: Submission[]) {
  const c = lesson.content
  const task = c.tasks[idx]
  const prev = history.length
    ? history.map((h) => `- 第 ${h.attempt} 次：${h.text}\n  当时的改进点：${h.result.keyPoint}`).join('\n')
    : '（这是第一次提交）'
  return `你是一名严格但鼓励的英语教练，正在批改学习者的一句英文输出。

# 学习者设定
${profile}

# 档位与批改标准
${LEVEL_RULES[lesson.level].grade}

# 今天的练习
- 文章：${c.title}
- 文章概要：${c.summary}
- 今天的句式：${c.expressions.map((e) => `${e.pattern}（${e.meaning}）`).join('；')}
- 本句任务（第 ${idx + 1} 句 · ${task.goal}）：${task.prompt}
${task.template ? `- 模板 / 开头：${task.template}` : ''}

# 这句之前的提交
${prev}

# 本次提交（第 ${history.length + 1} 次）
${text}

# 批改要求（讲解用中文，示例和改写用英文）
- verdict：pass 通过 / revise 需修改
- praise：一句具体的肯定（做对了什么），不说空泛的夸奖
- corrections：只改真正的错误和明显不自然的地方；original 原文片段，fixed 修改后，reason 中文简短原因。没有就给空数组
- keyPoint：这次最值得改进的一个点（中文，可附一个英文小例子），每次只说一个；和之前重复的错误要点明"又出现了"
- hint：如果是 revise，给出让学习者自己改的提示，不要直接给出完整答案；pass 时留空
- reference：更地道的参考版本，贴近学习者原意和水平，不要改得面目全非
- translations：学习者用中文括号写的部分，给出英文说法；没有就空数组
- scores：1–5 分，content 内容完整度、grammar 语法准确度、naturalness 表达自然度、expression 是否用上了今天的句式
- remember：从这次批改里挑一个最值得记的英文表达（text、中文 meaning、一个贴近学习者工作的 example）；没有合适的就三个字段都留空
- 回复简洁，适合手机阅读`
}

function cleanGrade(r: Partial<GradeResult>): GradeResult {
  const str = (v: unknown, max = 1200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const score = (v: unknown) => Math.min(5, Math.max(1, Math.round(Number(v) || 1)))
  const s = (r.scores ?? {}) as Partial<GradeResult['scores']>
  return {
    verdict: r.verdict === 'pass' ? 'pass' : 'revise',
    praise: str(r.praise, 300),
    corrections: (Array.isArray(r.corrections) ? r.corrections : []).slice(0, 8).map((x) => ({
      original: str(x?.original, 300),
      fixed: str(x?.fixed, 300),
      reason: str(x?.reason, 300),
    })),
    keyPoint: str(r.keyPoint, 600),
    hint: r.verdict === 'pass' ? '' : str(r.hint, 600),
    reference: str(r.reference, 600),
    translations: (Array.isArray(r.translations) ? r.translations : []).slice(0, 6).map((x) => ({
      zh: str(x?.zh, 100),
      en: str(x?.en, 200),
    })),
    scores: { content: score(s.content), grammar: score(s.grammar), naturalness: score(s.naturalness), expression: score(s.expression) },
    remember: { text: str(r.remember?.text, 200), meaning: str(r.remember?.meaning, 200), example: str(r.remember?.example, 400) },
  }
}

practice.post('/lessons/:id/submit', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ idx?: unknown; text?: unknown }>()
  const idx = Number(body.idx)
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 1500) : ''
  if (![0, 1, 2].includes(idx)) return c.json({ error: 'idx 只能是 0、1、2' }, 400)
  if (!text) return c.json({ error: '先写点什么再提交' }, 400)

  const user = c.get('user')
  const lesson = await loadLesson(c.env, id, user)
  if (!lesson) return c.json({ error: '找不到这份练习' }, 404)
  // 批改时需要看到完整的历史（包括参考版本），所以从库里重新读原始结果
  const { results } = await c.env.DB.prepare(
    'SELECT id, idx, attempt, text, passed, result, created_at FROM submissions WHERE lesson_id = ? AND idx = ? ORDER BY attempt',
  )
    .bind(id, idx)
    .all<Omit<Submission, 'passed' | 'result'> & { passed: number; result: string }>()
  const history: Submission[] = results.map((r) => ({ ...r, passed: !!r.passed, result: JSON.parse(r.result) }))

  const settings = await loadSettings(c.env, user)
  const raw = await generateJson<Partial<GradeResult>>(
    await aiEnv(c.env, user, c.get('admin')),
    gradePrompt(settings.coachProfile, lesson, idx, text, history),
    gradeSchema,
    'grade',
    0.3,
  )
  const result = cleanGrade(raw)
  const attempt = history.length + 1
  await c.env.DB.prepare(
    'INSERT INTO submissions (lesson_id, idx, attempt, text, passed, result, created_at, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(id, idx, attempt, text, result.verdict === 'pass' ? 1 : 0, JSON.stringify(result), Date.now(), user)
    .run()

  const fresh = await loadLesson(c.env, id, user)
  return c.json({ lesson: fresh })
})

/* ============================== 打卡统计 ============================== */

practice.get('/stats', async (c) => {
  const now = Date.now()
  const today = dayOf(now)
  const d = new Date(now + TZ)
  const monthStartDay = dayOf(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) - TZ)
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()

  // 近 400 天有提交的日期（用来算连续天数）
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT CAST((created_at + ?) / ? AS INTEGER) AS day FROM submissions
     WHERE user_id = ? AND created_at >= ? ORDER BY day DESC`,
  )
    .bind(TZ, DAY, c.get('user'), now - 400 * DAY)
    .all<{ day: number }>()
  const days = new Set(results.map((r) => r.day))

  let streak = 0
  for (let dd = days.has(today) ? today : today - 1; days.has(dd); dd--) streak++

  const monthDays = [...days].filter((x) => x >= monthStartDay).map((x) => x - monthStartDay + 1).sort((a, b) => a - b)

  const monthStartTs = monthStartDay * DAY - TZ
  const counts = await c.env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM submissions WHERE user_id = ?2 AND created_at >= ?1) AS submissions,
       (SELECT COUNT(*) FROM (
          SELECT lesson_id FROM submissions WHERE user_id = ?2 GROUP BY lesson_id
          HAVING COUNT(DISTINCT idx) = 3 AND MAX(created_at) >= ?1
       )) AS completed`,
  )
    .bind(monthStartTs, c.get('user'))
    .first<{ submissions: number; completed: number }>()

  const stats: PracticeStats = {
    days: monthDays,
    checkinDays: monthDays.length,
    completed: counts?.completed ?? 0,
    submissions: counts?.submissions ?? 0,
    streak,
    missedYesterday: !days.has(today) && !days.has(today - 1) && days.size > 0,
    today: today - monthStartDay + 1,
    daysInMonth,
    targets: { days: 20, completed: 20 },
  }
  return c.json(stats)
})
