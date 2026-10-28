import type { Env } from './env'
import { aiCallCounts, aiLimits } from './gemini'
import { aiEnv } from './settings'
import { generateQuestBank } from './quest'

export type GenerationMessage = { jobId: number }
export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed'
export type PrepareResult = { status: GenerationJobStatus | 'cached' | 'budget' | 'unavailable'; jobId?: number }

type JobRow = { id: number; lesson_id: number; user_id: string; status: GenerationJobStatus; lease_until: number }
const DAY = 86_400_000
const JOB_LEASE_MS = 180_000
const MAX_BACKGROUND_PER_USER = 3
const MAX_BACKGROUND_GLOBAL = 12

/** Background requests never use Gemini or eat the interactive quota reserve.
 * Neurons are metered account-wide upstream, so these call-count limits are
 * intentionally conservative guards, NOT a guarantee of zero extra billing. */
export async function backgroundBudgetAvailable(env: Env, user: string): Promise<boolean> {
  const ai = await aiEnv(env, user, false)
  if (!env.GENERATION_QUEUE || env.AI_DISABLED === 'true' || ai.TEXT_PROVIDER !== 'cloudflare') return false
  const limits = aiLimits(ai)
  const usage = await aiCallCounts(ai)
  if (usage.text >= Math.floor(limits.text * 0.7) || usage.userText >= Math.floor(limits.userText * 0.7)) return false
  if (usage.minute >= Math.floor(limits.perMinute * 0.7)) return false
  // Cloudflare's free Neuron allocation resets at 00:00 UTC, unlike the
  // application's older per-call metrics which are in Beijing time.
  const todayUTC = Math.floor(Date.now() / DAY) * DAY
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS all_jobs, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_jobs ' +
    'FROM generation_jobs WHERE created_at >= ?',
  ).bind(user, todayUTC).first<{ all_jobs: number; user_jobs: number | null }>()
  return (totals?.all_jobs ?? 0) < MAX_BACKGROUND_GLOBAL && (totals?.user_jobs ?? 0) < MAX_BACKGROUND_PER_USER
}

export async function prepareQuest(env: Env, user: string, lessonId: number): Promise<PrepareResult> {
  if (!Number.isSafeInteger(lessonId) || lessonId <= 0) return { status: 'unavailable' }
  const lesson = await env.DB.prepare('SELECT id FROM lessons WHERE id = ? AND user_id = ?')
    .bind(lessonId, user).first<{ id: number }>()
  if (!lesson) return { status: 'unavailable' }
  const cached = await env.DB.prepare('SELECT lesson_id FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(lessonId, user).first()
  if (cached) return { status: 'cached' }
  const existing = await env.DB.prepare(
    "SELECT id, status FROM generation_jobs WHERE user_id = ? AND lesson_id = ? AND kind = 'quest'",
  ).bind(user, lessonId).first<{ id: number; status: GenerationJobStatus }>()
  if (existing) return { jobId: existing.id, status: existing.status }
  if (!(await backgroundBudgetAvailable(env, user))) return { status: 'budget' }

  const now = Date.now()
  const row = await env.DB.prepare(
    "INSERT INTO generation_jobs (user_id, lesson_id, kind, status, created_at, updated_at) " +
    "VALUES (?, ?, 'quest', 'queued', ?, ?) ON CONFLICT(user_id, lesson_id, kind) DO NOTHING RETURNING id",
  ).bind(user, lessonId, now, now).first<{ id: number }>()
  if (!row) {
    const duplicate = await env.DB.prepare(
      "SELECT id, status FROM generation_jobs WHERE user_id = ? AND lesson_id = ? AND kind = 'quest'",
    ).bind(user, lessonId).first<{ id: number; status: GenerationJobStatus }>()
    return duplicate ? { jobId: duplicate.id, status: duplicate.status } : { status: 'unavailable' }
  }

  try {
    await env.GENERATION_QUEUE!.send({ jobId: row.id })
    return { jobId: row.id, status: 'queued' }
  } catch (error) {
    console.error('Unable to enqueue background generation', error)
    await env.DB.prepare("UPDATE generation_jobs SET status = 'failed', error = 'queue_unavailable', updated_at = ? WHERE id = ?")
      .bind(Date.now(), row.id).run()
    return { status: 'unavailable' }
  }
}

/** Queue messages are at-least-once; D1 conditional lease ensures idempotence.
 * Each message carries only the DB job id, not user data, API credentials, or prompts. */
export async function processGenerationBatch(batch: MessageBatch<GenerationMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const id = message.body?.jobId
    if (!Number.isSafeInteger(id) || id <= 0) { message.ack(); continue }
    const now = Date.now()
    const job = await env.DB.prepare(
      "UPDATE generation_jobs SET status = 'running', attempt = attempt + 1, " +
      "started_at = COALESCE(started_at, ?), lease_until = ?, updated_at = ? " +
      "WHERE id = ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) " +
      "RETURNING id, user_id, lesson_id, status, lease_until",
    ).bind(now, now + JOB_LEASE_MS, now, id, now).first<JobRow>()

    if (!job) {
      const other = await env.DB.prepare('SELECT status, lease_until FROM generation_jobs WHERE id = ?')
        .bind(id).first<{ status: GenerationJobStatus; lease_until: number }>()
      if (other?.status === 'running' && other.lease_until >= now) message.retry({ delaySeconds: 30 })
      else message.ack()
      continue
    }

    try {
      if (!(await backgroundBudgetAvailable(env, job.user_id))) {
        // Already counted this job in the quota. Reject new inference if the
        // shared free allocation is near the application guard.
        await env.DB.prepare("UPDATE generation_jobs SET status = 'failed', error = 'budget', lease_until = 0, updated_at = ? WHERE id = ?")
          .bind(Date.now(), id).run()
        message.ack()
        continue
      }
      await generateQuestBank(env, job.user_id, false, job.lesson_id)
      await env.DB.prepare("UPDATE generation_jobs SET status = 'done', lease_until = 0, error = NULL, updated_at = ? WHERE id = ?")
        .bind(Date.now(), id).run()
      message.ack()
    } catch (error) {
      console.warn('Background generation job failed', { id, message: error instanceof Error ? error.message : String(error) })
      const final = message.attempts >= 3 || /429|额度|quota|disabled|not found|找不到|不完整/.test(String(error))
      await env.DB.prepare(
        "UPDATE generation_jobs SET status = ?, lease_until = 0, updated_at = ?, error = ? WHERE id = ?",
      ).bind(final ? 'failed' : 'queued', Date.now(), final ? 'generation_failed' : 'retry', id).run()
      if (final) message.ack()
      else message.retry({ delaySeconds: 30 })
    }
  }
}
