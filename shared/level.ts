/* ---------------------------- 词汇评级：估算词汇量，对应到 CEFR 等级 ---------------------------- */

/**
 * 按词频排名分段（对应 shared/wordfreq-en.txt 的行号）。测试时每段抽几个词，
 * 某段认识的比例 × 这段的词数，加起来就是估算的词汇量
 */
export const BANDS = [
  { from: 1, to: 1000 },
  { from: 1001, to: 2000 },
  { from: 2001, to: 4000 },
  { from: 4001, to: 7000 },
  { from: 7001, to: 12000 },
  { from: 12001, to: 20000 },
  { from: 20001, to: 40000 },
] as const
export const WORDS_PER_BAND = 6
export const FAKES_PER_TEST = 8

/**
 * 词汇量 → 等级。统计的是词形（go / went / going 各算一个），所以数字比按词族统计的研究大；
 * 只是粗略参考，用来看自己在往上走、给「发现新词」定一个起点
 */
export const CEFR_LEVELS = [
  { id: 'A1', min: 0, name: '入门', desc: '认识最基础的日常词' },
  { id: 'A2', min: 1000, name: '基础', desc: '能看懂简单的日常句子' },
  { id: 'B1', min: 2000, name: '进阶', desc: '能读懂熟悉话题的短文' },
  { id: 'B2', min: 4000, name: '中高级', desc: '能读懂大部分帖子和新闻' },
  { id: 'C1', min: 7000, name: '高级', desc: '读技术文章、长讨论基本不查词' },
  { id: 'C2', min: 12000, name: '精通', desc: '接近母语者的阅读词汇量' },
] as const
export type LevelId = (typeof CEFR_LEVELS)[number]['id']

export function levelOf(vocab: number) {
  let i = 0
  while (i + 1 < CEFR_LEVELS.length && vocab >= CEFR_LEVELS[i + 1].min) i++
  const cur = CEFR_LEVELS[i]
  const next = CEFR_LEVELS[i + 1] ?? null
  return {
    id: cur.id,
    name: cur.name,
    desc: cur.desc,
    next: next ? { id: next.id, need: next.min - vocab } : null,
    /** 在当前等级里走了多少（0–1），给进度条用 */
    progress: next ? (vocab - cur.min) / (next.min - cur.min) : 1,
  }
}

export interface LevelStatus {
  /** 还没做过测试就是 null */
  vocab: number | null
  level: ReturnType<typeof levelOf> | null
  /** 测试那一刻的估算 */
  tested: { vocab: number; at: number } | null
  /** 测试之后新掌握、计入估算的词数 */
  gained: number
  /** 已掌握的词：标过认识 + DONE + 间隔 21 天以上的卡片 */
  mastered: number
  /** 最近 30 天新掌握的词 */
  recent: number
}

export interface TestWord {
  word: string
  /** 真词才有释义（测完显示，用来挑不认识的词加入复习） */
  meaning?: string
}

export interface TestResult {
  vocab: number
  level: ReturnType<typeof levelOf>
  /** 假词点了「认识」几个：多了说明点得有点松，估算已经按比例扣掉 */
  fakesClaimed: number
  fakesShown: number
  /** 假词点了一半以上：这次不计入评级 */
  unreliable: boolean
  /** 每段认识的比例（扣掉乱点之后） */
  bands: { from: number; to: number; ratio: number }[]
  /** 测试里不认识的真词，附释义 */
  unknown: TestWord[]
}
