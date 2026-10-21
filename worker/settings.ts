import type { Env } from './env'
import { COACH_PROFILE_MAX, isSafeId, type Settings } from '../shared/settings'
import { DEFAULT_COACH_PROFILE, isLevel } from '../shared/practice'
import { DEFAULT_SOURCES, DEFAULT_VOCAB_LEVEL, formatSources, isVocabLevel, parseSources } from '../shared/discover'
import { DEFAULT_DAILY_GOAL, DEFAULT_REMINDER_HOUR, REMINDER_HOURS, isDailyGoal } from '../shared/streak'

/** 全站共用、只有管理员能改的设置 */
const GLOBAL_KEYS = ['textModel', 'ttsModel', 'voice'] as const
/** 每个人自己的设置 */
const USER_KEYS = ['practiceLevel', 'coachProfile', 'reviewMode', 'dailyGoal', 'reminderHour', 'discoverSources', 'vocabLevel', 'discoverAuto'] as const

const isReminderHour = (v: unknown): v is number => v === -1 || REMINDER_HOURS.includes(v as number)

const isReviewMode = (v: unknown): v is Settings['reviewMode'] => v === 'mixed' || v === 'recognition' || v === 'production' || v === 'context'

/** 读取设置：全局设置来自 settings 表，个人设置来自 user_settings 表，都缺省时用默认值 */
export async function loadSettings(env: Env, user: string): Promise<Settings> {
  const [g, u] = await env.DB.batch<{ key: string; value: string }>([
    env.DB.prepare('SELECT key, value FROM settings'),
    env.DB.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').bind(user),
  ])
  const gm = Object.fromEntries(g.results.map((r) => [r.key, r.value]))
  const um = Object.fromEntries(u.results.map((r) => [r.key, r.value]))
  const level = Number(um.practiceLevel)
  const goal = Number(um.dailyGoal)
  const hour = um.reminderHour === undefined ? NaN : Number(um.reminderHour)
  const vocab = Number(um.vocabLevel)
  return {
    textModel: isSafeId(gm.textModel) ? gm.textModel : env.GEMINI_TEXT_MODEL,
    ttsModel: isSafeId(gm.ttsModel) ? gm.ttsModel : env.GEMINI_TTS_MODEL,
    voice: isSafeId(gm.voice) ? gm.voice : env.GEMINI_VOICE,
    practiceLevel: isLevel(level) ? level : 1,
    coachProfile: typeof um.coachProfile === 'string' && um.coachProfile.trim() ? um.coachProfile : DEFAULT_COACH_PROFILE,
    reviewMode: isReviewMode(um.reviewMode) ? um.reviewMode : 'mixed',
    dailyGoal: isDailyGoal(goal) ? goal : DEFAULT_DAILY_GOAL,
    reminderHour: isReminderHour(hour) ? hour : DEFAULT_REMINDER_HOUR,
    discoverSources: um.discoverSources && parseSources(um.discoverSources).length ? um.discoverSources : DEFAULT_SOURCES,
    vocabLevel: isVocabLevel(vocab) ? vocab : DEFAULT_VOCAB_LEVEL,
    discoverAuto: um.discoverAuto === '1',
  }
}

export function defaultSettings(env: Env): Settings {
  return {
    textModel: env.GEMINI_TEXT_MODEL,
    ttsModel: env.GEMINI_TTS_MODEL,
    voice: env.GEMINI_VOICE,
    practiceLevel: 1,
    coachProfile: DEFAULT_COACH_PROFILE,
    reviewMode: 'mixed',
    dailyGoal: DEFAULT_DAILY_GOAL,
    reminderHour: DEFAULT_REMINDER_HOUR,
    discoverSources: DEFAULT_SOURCES,
    vocabLevel: DEFAULT_VOCAB_LEVEL,
    discoverAuto: false,
  }
}

/** 把页面上选的模型/音色和当前用户套进 env，供 Gemini 调用、记账和限额使用 */
export async function aiEnv(env: Env, user: string, admin: boolean): Promise<Env> {
  const s = await loadSettings(env, user)
  return {
    ...env,
    GEMINI_TEXT_MODEL: s.textModel,
    GEMINI_TTS_MODEL: s.ttsModel,
    GEMINI_VOICE: s.voice,
    USER_ID: user,
    IS_ADMIN: admin,
  }
}

/** 校验并保存；null 或空字符串表示恢复默认。返回错误信息或 null */
export async function saveSettings(env: Env, user: string, admin: boolean, body: Record<string, unknown>): Promise<string | null> {
  const stmts: D1PreparedStatement[] = []
  const upsertGlobal = (k: string, v: string) =>
    env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, v)
  const resetGlobal = (k: string) => env.DB.prepare('DELETE FROM settings WHERE key = ?').bind(k)
  const upsertUser = (k: string, v: string) =>
    env.DB.prepare(
      'INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value',
    ).bind(user, k, v)
  const resetUser = (k: string) => env.DB.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').bind(user, k)

  for (const k of GLOBAL_KEYS) {
    const v = body[k]
    if (v === undefined) continue
    if (!admin) return '模型和音色是全站共用的，只有管理员可以修改'
    if (v === null || v === '') stmts.push(resetGlobal(k))
    else if (isSafeId(v)) stmts.push(upsertGlobal(k, v))
    else return `${k} 格式不对：只能包含字母、数字、点、横线`
  }
  if (body.practiceLevel !== undefined) {
    const lv = Number(body.practiceLevel)
    if (!isLevel(lv)) return 'practiceLevel 只能是 1、2、3'
    stmts.push(upsertUser('practiceLevel', String(lv)))
  }
  if (body.reviewMode !== undefined) {
    // 选回默认值（混合）时前端传 null，表示恢复默认
    if (body.reviewMode === null || body.reviewMode === '') stmts.push(resetUser('reviewMode'))
    else if (isReviewMode(body.reviewMode)) stmts.push(upsertUser('reviewMode', body.reviewMode))
    else return 'reviewMode 只能是 mixed / recognition / production / context'
  }
  if (body.dailyGoal !== undefined) {
    if (body.dailyGoal === null || body.dailyGoal === '') stmts.push(resetUser('dailyGoal'))
    else if (isDailyGoal(Number(body.dailyGoal))) stmts.push(upsertUser('dailyGoal', String(Number(body.dailyGoal))))
    else return 'dailyGoal 不在可选范围内'
  }
  if (body.reminderHour !== undefined) {
    if (body.reminderHour === null || body.reminderHour === '') stmts.push(resetUser('reminderHour'))
    else if (isReminderHour(Number(body.reminderHour))) stmts.push(upsertUser('reminderHour', String(Number(body.reminderHour))))
    else return 'reminderHour 不在可选范围内'
  }
  if (body.discoverSources !== undefined) {
    if (body.discoverSources === null || body.discoverSources === '') stmts.push(resetUser('discoverSources'))
    else if (typeof body.discoverSources === 'string' && parseSources(body.discoverSources).length)
      stmts.push(upsertUser('discoverSources', formatSources(parseSources(body.discoverSources))))
    else return '来源写法：hn 或 r/子版块名，用逗号隔开'
  }
  if (body.vocabLevel !== undefined) {
    if (body.vocabLevel === null || body.vocabLevel === '') stmts.push(resetUser('vocabLevel'))
    else if (isVocabLevel(Number(body.vocabLevel))) stmts.push(upsertUser('vocabLevel', String(Number(body.vocabLevel))))
    else return 'vocabLevel 不在可选范围内'
  }
  if (body.discoverAuto !== undefined) {
    if (body.discoverAuto === true || body.discoverAuto === 1 || body.discoverAuto === '1') stmts.push(upsertUser('discoverAuto', '1'))
    else stmts.push(resetUser('discoverAuto'))
  }
  if (body.coachProfile !== undefined) {
    const v = body.coachProfile
    if (v === null || (typeof v === 'string' && !v.trim())) stmts.push(resetUser('coachProfile'))
    else if (typeof v === 'string') stmts.push(upsertUser('coachProfile', v.trim().slice(0, COACH_PROFILE_MAX)))
    else return 'coachProfile 必须是文本'
  }
  if (stmts.length) await env.DB.batch(stmts)
  return null
}

export { USER_KEYS }
