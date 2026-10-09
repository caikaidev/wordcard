import type { CardMeta, ItemType } from './types'

export const IMPORT_FORMAT = 'shiju-import-v1'
/** 单个学习包的卡片上限 */
export const IMPORT_MAX_CARDS = 500

/** 示例文件：导入对话框里可以下载，也是给助手看的参照（docs/examples/mom-test-sample.json 与它保持一致） */
export const IMPORT_EXAMPLE = {
  format: IMPORT_FORMAT,
  package: {
    title: 'The Mom Test (sample)',
    source_url: 'https://www.momtestbook.com/',
    source_type: 'book',
    created_at: '2026-10-09',
    card_count: 3,
    difficulty_order: ['ch1', 'ch2'],
  },
  cards: [
    {
      term: 'compliment',
      phonetic: '/ˈkɑːmplɪmənt/',
      pos: 'n./v.',
      definition_cn: '恭维；赞美',
      example_en: 'You want facts and commitments, not compliments.',
      example_cn: '你想要的是事实和承诺，而不是恭维。',
      phrases: ['take sth as a compliment'],
      memory_tip: "compli- 像'顺从'，顺着别人说好话就是恭维",
      source_ref: 'Ch2',
      difficulty: 2,
    },
    {
      term: 'sail with a fair wind',
      definition_cn: '一帆风顺',
      example_en: 'Few startups sail with a fair wind from day one.',
      example_cn: '很少有创业公司从第一天起就一帆风顺。',
      source_ref: 'Ch1',
      difficulty: 3,
    },
    {
      term: 'commitment',
      phonetic: '/kəˈmɪtmənt/',
      pos: 'n.',
      definition_cn: '承诺；投入',
      example_en: 'A commitment costs the other person something real.',
      example_cn: '承诺会让对方付出真实的代价。',
      source_ref: 'Ch2',
    },
  ],
}

/** 格式规范文档（GitHub）：人看这个链接，AI 助手读 raw 链接（同一份文档里有「给 AI 助手」的步骤和自查清单） */
export const IMPORT_DOC_URL = 'https://github.com/caikaidev/wordcard/blob/main/docs/import-format.md'
export const IMPORT_DOC_RAW_URL = 'https://raw.githubusercontent.com/caikaidev/wordcard/main/docs/import-format.md'

/** 可以整段复制给 AI 助手的格式说明 */
export const IMPORT_SPEC = `完整规范和自查清单见：${IMPORT_DOC_RAW_URL}

请把我提供的英文资料做成「拾句」学习包，输出一个 UTF-8 编码的 JSON 文件（单包最多 ${IMPORT_MAX_CARDS} 张卡片），格式 ${IMPORT_FORMAT}：

{
  "format": "${IMPORT_FORMAT}",
  "package": {
    "title": "包名（书名/文章标题）",        // 必填
    "source_url": "https://...",            // 可选，原文链接（http/https）
    "source_type": "book",                  // 可选：book / article / video 等
    "difficulty_order": ["ch1", "ch2"]      // 可选：建议学习顺序，对应卡片的 source_ref
  },
  "cards": [
    {
      "term": "单词 / 词组 / 短句",          // 必填
      "definition_cn": "中文释义",           // 必填，多义用分号分隔
      "example_en": "原文里的英文例句",       // 必填，必须是原文真实句子，且包含 term（词形变化可以）
      "example_cn": "例句的中文翻译",         // 必填
      "phonetic": "/美式音标/",              // 可选
      "pos": "n.",                          // 可选：词性
      "phrases": ["相关词组"],               // 可选：字符串数组，最多 5 个
      "memory_tip": "记忆钩子",              // 可选：谐音 / 拆词 / 画面
      "source_ref": "Ch2",                  // 可选：来源章节
      "difficulty": 2                       // 可选：1–5
    }
  ]
}

要求：只输出 JSON，不要加注释和多余文字；缺少必填字段的卡片会被忽略。`

export interface ImportPackage {
  title: string
  source_url?: string
  source_type?: string
  created_at?: string
  card_count?: number
  difficulty_order?: string[]
}

/** 校验、清洗之后的一张卡片 */
export interface ImportCard {
  type: ItemType
  text: string
  meta: CardMeta
  sourceRef: string
  difficulty: number | null
  /** 在文件 cards 数组里的原始下标 */
  index: number
}

export type ImportParse =
  | { ok: true; pkg: ImportPackage; cards: ImportCard[]; invalid: string[] }
  | { ok: false; error: string }

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/**
 * 例句里和 term 对应的片段（忽略大小写），用于高亮和语境挖空；找不到就为空。
 * 词形变化（compliment → compliments / complimented）向后多取最多 4 个字母，避免挖空后剩下半个词
 */
function highlightOf(term: string, example: string) {
  const i = example.toLowerCase().indexOf(term.toLowerCase())
  if (i < 0) return ''
  let end = i + term.length
  if (/[A-Za-z]$/.test(term)) {
    const tail = /^[A-Za-z]{1,4}(?![A-Za-z])/.exec(example.slice(end))
    if (tail) end += tail[0].length
  }
  return example.slice(i, end)
}

/** 解析并校验《导入格式规范 v1》。前端预览和后端入库共用同一份逻辑 */
export function parseImport(raw: unknown): ImportParse {
  const o = raw as { format?: unknown; package?: Record<string, unknown>; cards?: unknown } | null
  if (!o || typeof o !== 'object') return { ok: false, error: '文件内容不是有效的 JSON 对象' }
  if (o.format !== IMPORT_FORMAT) return { ok: false, error: '不支持的导入格式版本' }
  if (!Array.isArray(o.cards)) return { ok: false, error: 'cards 必须是数组' }
  if (o.cards.length > IMPORT_MAX_CARDS) return { ok: false, error: `单个学习包最多 ${IMPORT_MAX_CARDS} 张卡片，请拆分后再导入` }
  const p = o.package
  const title = str(p?.title, 120)
  if (!title) return { ok: false, error: 'package.title 不能为空' }

  const order = Array.isArray(p?.difficulty_order) ? p.difficulty_order.map((x) => str(x, 40)).filter(Boolean).slice(0, 200) : []
  const pkg: ImportPackage = {
    title,
    // 只接受 http(s) 链接：它会在练习页渲染成可点击的外链
    source_url: /^https?:\/\//i.test(str(p?.source_url, 500)) ? str(p?.source_url, 500) : undefined,
    source_type: str(p?.source_type, 30) || undefined,
    created_at: str(p?.created_at, 20) || undefined,
    card_count: typeof p?.card_count === 'number' ? p.card_count : undefined,
    difficulty_order: order.length ? order : undefined,
  }

  const cards: ImportCard[] = []
  const invalid: string[] = []
  o.cards.forEach((c: Record<string, unknown> | null, i) => {
    const term = str(c?.term, 500).replace(/\s+/g, ' ')
    const meaning = str(c?.definition_cn, 1000)
    const example = str(c?.example_en, 1000)
    const exampleZh = str(c?.example_cn, 1000)
    const missing = [!term && 'term', !meaning && 'definition_cn', !example && 'example_en', !exampleZh && 'example_cn'].filter(Boolean)
    if (missing.length) {
      invalid.push(`第 ${i + 1} 张${term ? `「${term}」` : ''}缺少 ${missing.join('、')}`)
      return
    }
    const phrases = (Array.isArray(c?.phrases) ? c.phrases : [])
      .map((x) => str(x, 200))
      .filter(Boolean)
      .slice(0, 5)
      .map((text) => ({ text, meaning: '' }))
    const d = Number(c?.difficulty)
    cards.push({
      type: term.includes(' ') && /[.!?]$/.test(term) ? 'sentence' : 'word',
      text: term,
      meta: {
        ipa: str(c?.phonetic, 100),
        pos: str(c?.pos, 30),
        meaning,
        example,
        exampleZh,
        highlight: highlightOf(term, example),
        phrases,
        memoryTip: str(c?.memory_tip, 500) || undefined,
      },
      sourceRef: str(c?.source_ref, 40),
      difficulty: Number.isInteger(d) && d >= 1 && d <= 5 ? d : null,
      index: i,
    })
  })

  // 有 difficulty_order 时，按章节顺序（再按文件里的原顺序）排好，复习时就是这个先后
  if (pkg.difficulty_order) {
    const rank = (c: ImportCard) => {
      const r = pkg.difficulty_order!.findIndex((k) => k.toLowerCase() === c.sourceRef.toLowerCase())
      return r < 0 ? pkg.difficulty_order!.length : r
    }
    cards.sort((a, b) => rank(a) - rank(b) || a.index - b.index)
  }
  return { ok: true, pkg, cards, invalid }
}
