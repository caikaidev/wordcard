/* 打卡分享卡片：在浏览器里用 Canvas 画成 1080×1440 的 PNG（3:4，适合朋友圈 / 小红书），不走服务器 */
import type { ShareQuote } from '../../shared/practice'

export const CARD_W = 1080
export const CARD_H = 1440

export type CardStyle = 'paper' | 'indigo'

export const CARD_STYLES: { id: CardStyle; name: string }[] = [
  { id: 'paper', name: '纸白' },
  { id: 'indigo', name: '靛蓝' },
]

const PALETTE: Record<CardStyle, Record<'bg' | 'surface' | 'ink' | 'muted' | 'dot' | 'done' | 'mark' | 'iconBg' | 'iconLine', string>> = {
  paper: {
    bg: '#F6F4EF',
    surface: '#FFFFFF',
    ink: '#1C1B19',
    muted: '#6B6860',
    dot: '#E6E2D9',
    done: '#2B4C7E',
    mark: '#F2C66D',
    iconBg: '#2B4C7E',
    iconLine: 'rgba(246,244,239,.55)',
  },
  indigo: {
    bg: '#2B4C7E',
    surface: '#335788',
    ink: '#F6F4EF',
    muted: '#BAC6D8',
    dot: 'rgba(246,244,239,.16)',
    done: '#F2C66D',
    mark: '#F2C66D',
    iconBg: '#F6F4EF',
    iconLine: 'rgba(43,76,126,.45)',
  },
}

export interface CardInput {
  style: CardStyle
  date: Date
  hero: { label: string; value: number; unit: string }
  facts: string[]
  days: number[]
  daysInMonth: number
  today: number
  quote: ShareQuote | null
}

const SANS = `-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", "Segoe UI", sans-serif`
const SERIF = `"Newsreader Variable", Georgia, "Songti SC", serif`
const M = 96
const WEEK = ['日', '一', '二', '三', '四', '五', '六']
const KIND_LABEL: Record<ShareQuote['kind'], string> = { mine: '我写的', remember: '值得记', card: '新收的' }

/** 等字体就绪，否则第一次画出来会是后备字体 */
export async function loadCardFonts() {
  try {
    await Promise.all([document.fonts.load(`500 200px ${SERIF}`), document.fonts.load(`italic 400 48px ${SERIF}`)])
  } catch {
    /* 字体加载失败就用后备字体 */
  }
}

export function drawCard(canvas: HTMLCanvasElement, input: CardInput) {
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')!
  const c = PALETTE[input.style]
  ctx.textBaseline = 'alphabetic'

  ctx.fillStyle = c.bg
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // 顶部：图标 + 名字 + 日期
  drawIcon(ctx, M, 96, 72, c)
  ctx.fillStyle = c.ink
  ctx.font = `600 44px ${SANS}`
  ctx.fillText('拾句', M + 96, 148)
  const d = input.date
  ctx.fillStyle = c.muted
  ctx.font = `400 32px ${SANS}`
  ctx.textAlign = 'right'
  ctx.fillText(`${d.getMonth() + 1}月${d.getDate()}日 · 周${WEEK[d.getDay()]}`, CARD_W - M, 144)
  ctx.textAlign = 'left'

  // 大数字
  ctx.fillStyle = c.muted
  ctx.font = `400 36px ${SANS}`
  ctx.fillText(input.hero.label, M, 296)
  ctx.fillStyle = c.ink
  ctx.font = `500 240px ${SERIF}`
  const num = String(input.hero.value)
  ctx.fillText(num, M - 8, 520)
  const nw = ctx.measureText(num).width
  ctx.font = `500 60px ${SANS}`
  ctx.fillText(input.hero.unit, M - 8 + nw + 20, 516)

  // 小统计
  ctx.fillStyle = c.muted
  ctx.font = `400 32px ${SANS}`
  ctx.fillText(input.facts.join('   ·   '), M, 600)

  // 本月打卡格子：两行
  const perRow = Math.ceil(input.daysInMonth / 2)
  const gap = 12
  const size = Math.min(44, (CARD_W - 2 * M - gap * (perRow - 1)) / perRow)
  const checked = new Set(input.days)
  for (let day = 1; day <= input.daysInMonth; day++) {
    const i = day - 1
    const x = M + (i % perRow) * (size + gap)
    const y = 650 + Math.floor(i / perRow) * (size + gap)
    roundRect(ctx, x, y, size, size, 10)
    if (checked.has(day)) {
      ctx.fillStyle = c.done
      ctx.fill()
    } else if (day === input.today) {
      ctx.strokeStyle = c.done
      ctx.lineWidth = 4
      roundRect(ctx, x + 2, y + 2, size - 4, size - 4, 8)
      ctx.stroke()
    } else {
      ctx.globalAlpha = day < input.today ? 1 : 0.5
      ctx.fillStyle = c.dot
      ctx.fill()
      ctx.globalAlpha = 1
    }
  }

  // 今日一句
  const top = 810
  const footer = 1372
  const pad = 56
  const inner = CARD_W - 2 * M - 2 * pad
  const q = input.quote ?? { text: 'Read one piece, write three lines, keep the good ones.', kind: 'mine' as const, note: '读一篇，写三句，把好句子拾起来' }
  ctx.font = `400 50px ${SERIF}`
  const noteLines = q.note ? wrap(ctx, q.note, inner, `400 30px ${SANS}`, 2) : []
  const maxBody = Math.floor((footer - 80 - top - pad * 2 - 64 - noteLines.length * 44 - (noteLines.length ? 16 : 0)) / 68)
  const lines = wrap(ctx, q.text, inner, `400 50px ${SERIF}`, Math.min(5, maxBody))
  const h = pad + 44 + 24 + lines.length * 68 + (noteLines.length ? 16 + noteLines.length * 44 : 0) + pad - 16
  roundRect(ctx, M, top, CARD_W - 2 * M, h, 36)
  ctx.fillStyle = c.surface
  ctx.fill()

  // 标题行：一小段“拾起来”的高亮条 + 今日拾句 + 来源
  ctx.save()
  ctx.translate(M + pad, top + pad + 18)
  ctx.rotate((-7 * Math.PI) / 180)
  roundRect(ctx, 0, -9, 56, 18, 9)
  ctx.fillStyle = c.mark
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = c.ink
  ctx.font = `600 30px ${SANS}`
  ctx.fillText(input.quote ? '今日拾句' : '拾句', M + pad + 76, top + pad + 30)
  if (input.quote) {
    ctx.fillStyle = c.muted
    ctx.font = `400 26px ${SANS}`
    ctx.textAlign = 'right'
    ctx.fillText(KIND_LABEL[q.kind], CARD_W - M - pad, top + pad + 30)
    ctx.textAlign = 'left'
  }

  ctx.fillStyle = c.ink
  ctx.font = `400 50px ${SERIF}`
  let y = top + pad + 44 + 24 + 50
  for (const line of lines) {
    ctx.fillText(line, M + pad, y)
    y += 68
  }
  if (noteLines.length) {
    ctx.fillStyle = c.muted
    ctx.font = `400 30px ${SANS}`
    y += 4
    for (const line of noteLines) {
      ctx.fillText(line, M + pad, y)
      y += 44
    }
  }

  // 底部
  ctx.font = `600 28px ${SANS}`
  ctx.fillStyle = c.ink
  const brand = '拾句 · Shiju'
  ctx.fillText(brand, M, footer)
  const bw = ctx.measureText(brand).width
  ctx.font = `400 28px ${SANS}`
  ctx.fillStyle = c.muted
  ctx.fillText('读到的好句子，写出的好句子，都拾起来', M + bw + 28, footer)
}

/** 和 App 图标同一个造型：一段文字里被拾起来的那一句 */
function drawIcon(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, c: (typeof PALETTE)['paper']) {
  const k = s / 512
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(k, k)
  roundRect(ctx, 0, 0, 512, 512, 112)
  ctx.fillStyle = c.iconBg
  ctx.fill()
  ctx.fillStyle = c.iconLine
  roundRect(ctx, 112, 150, 288, 40, 20)
  ctx.fill()
  roundRect(ctx, 112, 330, 200, 40, 20)
  ctx.fill()
  ctx.translate(256, 250)
  ctx.rotate((-7 * Math.PI) / 180)
  ctx.translate(-256, -250)
  roundRect(ctx, 128, 228, 300, 56, 28)
  ctx.fillStyle = '#F2C66D'
  ctx.fill()
  ctx.restore()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** 按宽度折行：英文按词、中文按字；超出行数时末尾加省略号 */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, font: string, maxLines: number) {
  ctx.font = font
  const tokens = text.match(/[　-〿㐀-鿿＀-￯]|[^\s　-〿㐀-鿿＀-￯]+|\s+/g) ?? []
  const lines: string[] = []
  let cur = ''
  for (const t of tokens) {
    const next = cur + t
    if (ctx.measureText(next.trimEnd()).width <= width || !cur.trim()) {
      cur = next
      continue
    }
    lines.push(cur.trimEnd())
    cur = /^\s+$/.test(t) ? '' : t
  }
  if (cur.trim()) lines.push(cur.trimEnd())
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, Math.max(1, maxLines))
  let last = kept[kept.length - 1]
  while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1)
  kept[kept.length - 1] = `${last.trimEnd()}…`
  return kept
}
