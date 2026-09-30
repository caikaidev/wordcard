/* 按链接读取文章：尽量读到完整正文
 *
 * 1. 直接抓取 HTML → Defuddle 提取正文（去掉导航、侧栏、页脚，保留标题、段落、列表）
 * 2. 抓不到或正文太短（需要执行 JS 的页面）→ Cloudflare Browser Run 用真实浏览器渲染后再提取（可选，配置了 BROWSER 绑定才用）
 * 3. 还不行（多半是网站拦截云服务器）→ Gemini URL context 读取
 * 4. 都失败 → 提示用户粘贴正文或截图
 */
import { parseHTML } from 'linkedom'
import Defuddle from 'defuddle'
import puppeteer from '@cloudflare/puppeteer'
import type { Env } from './env'
import { GeminiError, readUrl } from './gemini'

/** 保存的原文上限（阅读用）；生成练习时只取前面一部分给 AI */
export const MAX_SOURCE_CHARS = 100_000
const MIN_ARTICLE_CHARS = 300
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

export interface Article {
  title: string
  text: string
  url: string
  /** 读取方式，便于排查 */
  via: 'direct' | 'reddit' | 'browser' | 'gemini'
}

export function decodeEntities(s: string) {
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

/** 干净的正文 HTML → 纯文本：块级元素各占一行，列表项前加 •，保留段落结构 */
function blocksToText(html: string) {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|iframe|button|figure)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<li\b[^>]*>/gi, '\n• ')
      .replace(/<(br|\/p|\/h[1-6]|\/li|\/div|\/pre|\/blockquote|\/tr|\/ul|\/ol|\/section|\/article)\s*\/?>/gi, '\n')
      .replace(/<(p|h[1-6]|div|pre|blockquote|tr|ul|ol|section)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/^• *\n/gm, '')
    .trim()
}

/** 旧的粗略提取：Defuddle 出错时兜底 */
function roughText(html: string) {
  let body = html.replace(/<(script|style|noscript|svg|nav|footer|header|aside|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
  const main = /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0] ?? /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0]
  if (main && main.length > 1500) body = main
  return blocksToText(body)
}

/** 用 Defuddle 提取正文，返回标题和纯文本 */
export function extract(html: string, url: string): { title: string; text: string } {
  const fallbackTitle = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? '')
  try {
    const { document } = parseHTML(html)
    const r = new Defuddle(document as unknown as ConstructorParameters<typeof Defuddle>[0], { url, useAsync: false, removeImages: true }).parse()
    const text = blocksToText(r.content ?? '')
    const rough = roughText(html)
    // 极少数页面 Defuddle 会过度删减：比粗略提取短得多时，用粗略结果保证完整
    if (text.length < MIN_ARTICLE_CHARS && rough.length > text.length * 3) return { title: r.title || fallbackTitle, text: rough }
    return { title: r.title || fallbackTitle, text }
  } catch (e) {
    console.error('defuddle failed', e)
    return { title: fallbackTitle, text: roughText(html) }
  }
}

async function fetchReddit(url: URL): Promise<{ title: string; text: string }> {
  // Reddit 页面是 JS 渲染的，改用它的 JSON 接口取标题、正文和几条高赞评论
  const res = await fetch(`${url.origin}${url.pathname.replace(/\/$/, '')}.json?limit=8&sort=top`, {
    headers: { 'user-agent': 'shiju/0.1 (+https://github.com/caikaidev/wordcard)' },
  })
  if (!res.ok) throw new Error(`reddit ${res.status}`)
  const data = (await res.json()) as {
    data: { children: { data: { title?: string; selftext?: string; body?: string } }[] }
  }[]
  const post = data[0]?.data.children[0]?.data
  const comments = (data[1]?.data.children ?? [])
    .map((c) => c.data.body)
    .filter(Boolean)
    .slice(0, 8)
  return {
    title: post?.title ?? '',
    text: [post?.selftext, ...comments.map((c, i) => `Comment ${i + 1}: ${c}`)].filter(Boolean).join('\n'),
  }
}

/** 用 Cloudflare Browser Run 渲染页面（需要 wrangler.jsonc 里的 browser 绑定） */
async function viaBrowser(env: Env, url: string): Promise<{ title: string; text: string } | null> {
  if (!env.BROWSER) return null
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
  try {
    browser = await puppeteer.launch(env.BROWSER)
    const page = await browser.newPage()
    await page.setUserAgent(UA)
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 20_000 })
    const html = await page.content()
    return extract(html, page.url())
  } catch (e) {
    // 免费额度用完、超时等：交给下一步
    console.error('browser render failed', e)
    return null
  } finally {
    await browser?.close().catch(() => {})
  }
}

const done = (a: { title: string; text: string }, url: string, via: Article['via']): Article => ({
  title: a.title,
  text: a.text.slice(0, MAX_SOURCE_CHARS),
  url,
  via,
})

export async function fetchArticle(env: Env, raw: string): Promise<Article> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new GeminiError('链接格式不对', 400)
  }
  if (!/^https?:$/.test(url.protocol)) throw new GeminiError('只支持 http(s) 链接', 400)

  const res = await fetch(url.toString(), {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml', 'accept-language': 'en-US,en;q=0.9' },
  }).catch(() => null)
  const finalUrl = res?.url ? new URL(res.url) : url

  if (/(^|\.)reddit\.com$/.test(finalUrl.hostname)) {
    try {
      const r = await fetchReddit(finalUrl)
      if (r.text.length >= 50) return done(r, finalUrl.toString(), 'reddit')
    } catch {
      /* 落到下面的通用处理 */
    }
  }

  // 1. 直接抓取
  const type = res?.headers.get('content-type') ?? ''
  let direct: { title: string; text: string } | null = null
  if (res?.ok && /html|xml|text\/plain/.test(type)) {
    const body = await res.text()
    direct = /text\/plain/.test(type) ? { title: '', text: body.trim() } : extract(body, finalUrl.toString())
    if (direct.text.length >= MIN_ARTICLE_CHARS) return done(direct, finalUrl.toString(), 'direct')
  }

  // 2. 浏览器渲染（JS 页面、简单的反爬）
  const rendered = await viaBrowser(env, finalUrl.toString())
  if (rendered && rendered.text.length >= MIN_ARTICLE_CHARS) return done(rendered, finalUrl.toString(), 'browser')

  // 3. Gemini 读取
  try {
    const viaAi = await readUrl(env, url.toString())
    if (viaAi.text.length >= MIN_ARTICLE_CHARS) return done(viaAi, url.toString(), 'gemini')
  } catch (e) {
    // 额度用完之类的错误原样告诉用户；“读不到”则落到下面的统一提示
    if (e instanceof GeminiError && e.status === 429) throw e
  }

  const why = !res ? '网络错误' : !res.ok ? `网站拒绝了访问（${res.status}）` : '页面里没有可读的正文'
  throw new GeminiError(`这个链接读不到：${why}。可以在浏览器里打开原文，全选复制后用「正文」粘贴，或者用「截图」`, 400)
}
