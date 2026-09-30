/** 页面上可切换的模型与音色（选项以 Google AI Studio 当前可用为准） */
export const TEXT_MODELS = [
  { id: 'gemini-3.8-flash', note: '最新，效果最好' },
  { id: 'gemini-3.7-flash', note: '' },
  { id: 'gemini-3.5-flash', note: '' },
  { id: 'gemini-3.5-flash-lite', note: '更快更省' },
  { id: 'gemini-3.1-flash-lite', note: '' },
]

export const TTS_MODELS = [
  { id: 'gemini-3.8-flash-tts', note: '音质最好' },
  { id: 'gemini-3.8-flash-lite-tts', note: '更快更省' },
]

export const VOICES = [
  { id: 'Kore', note: '女声 · 沉稳' },
  { id: 'Aoede', note: '女声 · 轻快' },
  { id: 'Leda', note: '女声 · 年轻' },
  { id: 'Zephyr', note: '女声 · 明亮' },
  { id: 'Puck', note: '男声 · 活泼' },
  { id: 'Charon', note: '男声 · 平稳' },
  { id: 'Fenrir', note: '男声 · 有力' },
  { id: 'Orus', note: '男声 · 坚定' },
]

export interface Settings {
  textModel: string
  ttsModel: string
  voice: string
  /** 练习默认档位 1/2/3 */
  practiceLevel: 1 | 2 | 3
  /** 教练设定：学习者背景、目标与原则，出题和批改都会带上 */
  coachProfile: string
}

export const COACH_PROFILE_MAX = 3000

/** 模型名/音色只允许字母数字和 . - _，防止拼进 URL 时出问题 */
export const isSafeId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9._-]{1,64}$/.test(v)
