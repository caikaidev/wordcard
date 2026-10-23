import type { StageId } from './quest'

export const DIFFICULTIES = ['easy', 'right', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]
export const isDifficulty = (v: unknown): v is Difficulty => DIFFICULTIES.some((d) => d === v)
export type DifficultySample = { stage: StageId; difficulty: Difficulty; accuracy: number | null }

/** Input newest first, one sample per lesson/stage. Never change the user's base level. */
export function difficultyAdjustments(samples: DifficultySample[]): Record<string, number> {
  return Object.fromEntries(['words', 'listen', 'read', 'speak'].map((stage) => {
    const recent = samples.filter((s) => s.stage === stage).slice(0, 8)
    if (recent.length < 3) return [stage, 0]
    const sum = recent.reduce((n, s) => n + (s.difficulty === 'hard' ? -1 : s.difficulty === 'easy' && (s.accuracy === null || s.accuracy >= 0.85) ? 1 : 0), 0)
    return [stage, sum / recent.length >= 0.5 ? 1 : sum / recent.length <= -0.5 ? -1 : 0]
  }))
}

export function difficultyPrompt(samples: DifficultySample[]): string {
  const adjustments = difficultyAdjustments(samples)
  const labels = { words: '认词', listen: '听力', read: '阅读', speak: '口语跟读' }
  const lines = Object.entries(labels).map(([stage, label]) => {
    const change = adjustments[stage]
    return `${label}：${change < 0 ? '在当前档位内稍降低难度，优先常用表达、短句和清晰线索' : change > 0 ? '在当前档位内稍增加挑战，适度增加句式变化和辨析要求' : '保持当前档位的常规难度'}`
  })
  return `根据近期分项反馈微调（不改变用户选择的档位，不提高到下一档；只调整对应题型）：\n${lines.join('\n')}\n口语难度只调整 speaking，不要因为口语反馈改变听力题。`
}
