import type { CheckinEvent, StreakStatus } from '../../shared/streak'
import { toast } from './ui'
import { IconFlame } from './icons'

/** 今天刚打卡：弹一句，逢里程碑、拿到保护卡说得更热闹一点 */
export function celebrate(c: CheckinEvent | null | undefined) {
  if (!c) return
  if (c.milestone) toast(`🎉 连续 ${c.streak} 天！又一个里程碑`, 'success')
  else if (c.earnedFreeze) toast(`🔥 连续 ${c.streak} 天，送你 1 张连胜保护卡 🧊`, 'success')
  else toast(c.streak > 1 ? `🔥 今日打卡完成，连续 ${c.streak} 天` : '✓ 今日打卡完成，明天继续', 'success')
}

/** 复习页顶部的小火苗：连续天数 + 今天离目标还差几张 */
export function StreakChip({ s }: { s: StreakStatus | null }) {
  if (!s) return null
  const label = s.today
    ? `连续 ${s.streak} 天，今天已打卡`
    : `连续 ${s.streak} 天，今天已复习 ${s.reviewsToday} 张，目标 ${s.goal} 张`
  return (
    <span
      title={label}
      aria-label={label}
      className={`tabular flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs font-semibold ${
        s.today ? 'bg-forgot-bg text-forgot-fg' : 'border border-line bg-surface text-muted-2'
      }`}
    >
      <IconFlame size={14} className={s.today || s.streak ? 'text-forgot-fg' : 'text-faint'} />
      {s.streak}
      {!s.today && (
        <span className="font-normal text-muted">
          · {Math.min(s.reviewsToday, s.goal)}/{s.goal}
        </span>
      )}
    </span>
  )
}

/** 练习页打卡卡片里的一行：今日目标进度、下一个里程碑、保护卡 */
export function StreakDetail({ s }: { s: StreakStatus }) {
  const pct = s.today ? 100 : Math.round((Math.min(s.reviewsToday, s.goal) / s.goal) * 100)
  return (
    <div className="mt-3.5 flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className={s.today ? 'font-medium text-accent' : 'text-muted-2'}>
          {s.today ? '✓ 今日目标已完成' : `今日复习 ${Math.min(s.reviewsToday, s.goal)} / ${s.goal} 张`}
        </span>
        <span className="tabular shrink-0 text-muted">再 {s.next - s.streak} 天到 {s.next} 天</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-1.5 rounded-full bg-accent transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <div className="text-xs text-muted">
        {!s.today && '复习够数或写一句练习就算打卡。'}
        {s.freezes > 0 ? `手里有 ${s.freezes} 张保护卡 🧊，哪天忘了会自动用掉，连续天数不断。` : `每连续 7 天送 1 张保护卡 🧊。`}
      </div>
      {s.frozenAgo !== null && (
        <div className="text-xs text-muted">
          {s.frozenAgo === 1 ? '昨天' : `${s.frozenAgo} 天前`}没打卡，自动用掉了 1 张保护卡，连续天数保住了。
        </div>
      )}
    </div>
  )
}
