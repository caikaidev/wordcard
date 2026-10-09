import type { Env } from './env'
import { COACH_PROFILE_MAX, isSafeId, type Settings } from '../shared/settings'
import { DEFAULT_COACH_PROFILE, isLevel } from '../shared/practice'

/** 全站共用、只有管理员能改的设置 */
const GLOBAL_KEYS = ['textModel', 'ttsModel', 'voice'] as const
/** 每个人自己的设置 */
const USER_KEYS = ['practiceLevel', 'coachProfile', 'reviewMode'] as const

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
  return {
    textModel: isSafeId(gm.textModel) ? gm.textModel : env.GEMINI_TEXT_MODEL,
    ttsModel: isSafeId(gm.ttsModel) ? gm.ttsModel : env.GEMINI_TTS_MODEL,
    voice: isSafeId(gm.voice) ? gm.voice : env.GEMINI_VOICE,
    practiceLevel: isLevel(level) ? level : 1,
    coachProfile: typeof um.coachProfile === 'string' && um.coachProfile.trim() ? um.coachProfile : DEFAULT_COACH_PROFILE,
    reviewMode: isReviewMode(um.reviewMode) ? um.reviewMode : 'mixed',
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
