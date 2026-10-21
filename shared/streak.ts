/** 每日目标：今天复习满这么多张就算打卡（做一次练习也算）。到期的卡不够时，清空到期卡片也算 */
export const DAILY_GOALS = [
  { id: 5, name: '轻松', desc: '每天 5 张，两三分钟' },
  { id: 10, name: '常规', desc: '每天 10 张，五分钟左右' },
  { id: 20, name: '认真', desc: '每天 20 张' },
  { id: 40, name: '冲刺', desc: '每天 40 张' },
] as const
export type DailyGoal = (typeof DAILY_GOALS)[number]['id']
export const DEFAULT_DAILY_GOAL: DailyGoal = 5
export const isDailyGoal = (v: unknown): v is DailyGoal => DAILY_GOALS.some((g) => g.id === v)

/** 连续天数的里程碑：越往后间隔越大，总有一个“快到了”的下一站 */
export const MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365, 500, 730, 1000]
export const nextMilestone = (streak: number) => MILESTONES.find((m) => m > streak) ?? Math.ceil((streak + 1) / 365) * 365

/** 连胜保护：每连续打卡 7 天送一张，最多攒 2 张；某天没打卡时自动用掉一张，连续天数不断 */
export const FREEZE_EVERY = 7
export const FREEZE_MAX = 2

/** 每日提醒：北京时间几点推送；-1 表示不提醒 */
export const REMINDER_HOURS = [7, 8, 9, 12, 18, 19, 20, 21, 22]
export const DEFAULT_REMINDER_HOUR = 20
/** 当天还没打卡、手里有连续天数时，这个钟点再补一条“快断了”的提醒 */
export const RESCUE_HOUR = 22

export interface StreakStatus {
  streak: number
  best: number
  /** 今天已经打卡 */
  today: boolean
  /** 今天复习了几张 */
  reviewsToday: number
  goal: DailyGoal
  freezes: number
  next: number
  /** 最近一次断签时自动用掉保护卡的那天（距今天数，1 = 昨天）；没有就是 null */
  frozenAgo: number | null
}

/** 复习评分后，如果这一下让今天达成了目标，接口会附带这个 */
export interface CheckinEvent {
  streak: number
  /** 刚好达到一个里程碑 */
  milestone: boolean
  /** 这次打卡送了一张保护卡 */
  earnedFreeze: boolean
}
