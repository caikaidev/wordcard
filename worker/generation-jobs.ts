import type { Env } from './env'
import { aiCallCounts, aiLimits } from './gemini'
import { aiEnv } from './settings'
import { generateQuestBank, QuestBusyError } from './quest'

export type GenerationMessage = { jobId: number }
export type GenerationJobStatus = 'queued' | 'running' | 'done' | 'failed'
export type PrepareResult = { status: GenerationJobStatus | 'cached' | 'budget' | 'unavailable'; jobId?: number }
type Kind = 'quest' | 'quest_tail'
type JobRow = { id: number; lesson_id: number; user_id: string; kind: Kind; attempt: number }
const DAY = 86_400_000
const JOB_LEASE_MS = 5 * 60_000
const MAX_BACKGROUND_PER_USER = 3
const MAX_BACKGROUND_GLOBAL = 12
const MAX_ATTEMPTS = 3

/** Application guards, not a Neuron meter or zero-billing guarantee.
 * Admission reserves a batch; execution checks provider/usage, not its own reservation. */
export async function backgroundBudgetAvailable(env: Env, user: string, admission = true): Promise<boolean> {
  if (!env.GENERATION_QUEUE || env.AI_DISABLED === 'true') return false
  const ai = await aiEnv(env, user, false)
  if (ai.TEXT_PROVIDER !== 'cloudflare') return false
  const limits = aiLimits(ai)
  const usage = await aiCallCounts(ai)
  if (usage.text >= Math.floor(limits.text * 0.7) || usage.userText >= Math.floor(limits.userText * 0.7)) return false
  if (usage.minute >= Math.floor(limits.perMinute * 0.7)) return false
  if (!admission) return true
  const todayUTC = Math.floor(Date.now() / DAY) * DAY
  const totals = await env.DB.prepare(
    'SELECT COUNT(*) AS all_jobs, SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS user_jobs ' +
    'FROM generation_jobs WHERE created_at >= ?',
  ).bind(user, todayUTC).first<{ all_jobs: number; user_jobs: number | null }>()
  return (totals?.all_jobs ?? 0) < MAX_BACKGROUND_GLOBAL && (totals?.user_jobs ?? 0) < MAX_BACKGROUND_PER_USER
}

/** Initial warmup never schedules a tail. Only active low-water demand asks for it. */
export async function prepareQuest(env: Env, user: string, lessonId: number, refill = false): Promise<PrepareResult> {
  if (!Number.isSafeInteger(lessonId) || lessonId <= 0) return { status: 'unavailable' }
  const lesson = await env.DB.prepare('SELECT id FROM lessons WHERE id = ? AND user_id = ?')
    .bind(lessonId, user).first<{ id: number }>()
  if (!lesson) return { status: 'unavailable' }
  const cached = await env.DB.prepare('SELECT ready_phase FROM quests WHERE lesson_id = ? AND user_id = ?')
    .bind(lessonId, user).first<{ ready_phase: string }>()
  if (cached && (cached.ready_phase === 'complete' || !refill)) return { status: 'cached' }
  if (refill && !cached) return { status: 'unavailable' }
  const kind: Kind = refill ? 'quest_tail' : 'quest'
  const findJob = () => env.DB.prepare('SELECT id, status FROM generation_jobs WHERE user_id = ? AND lesson_id = ? AND kind = ?')
    .bind(user, lessonId, kind).first<{ id: number; status: GenerationJobStatus }>()
  const existing = await findJob()
  if (existing) return { jobId: existing.id, status: existing.status }
  if (!(await backgroundBudgetAvailable(env, user))) return { status: 'budget' }

  const now = Date.now(), todayUTC = Math.floor(now / DAY) * DAY
  // Atomic reservation: concurrent tabs/users cannot exceed either batch cap.
  // Failed jobs also consume a reservation, avoiding an automatic retry spending loop.
  const row = await env.DB.prepare(
    'INSERT INTO generation_jobs (user_id, lesson_id, kind, status, created_at, updated_at) ' +
    "SELECT ?, ?, ?, 'queued', ?, ? " +
    'WHERE (SELECT COUNT(*) FROM generation_jobs WHERE created_at >= ?) < ? ' +
    'AND (SELECT COUNT(*) FROM generation_jobs WHERE user_id = ? AND created_at >= ?) < ? ' +
    'ON CONFLICT(user_id, lesson_id, kind) DO NOTHING RETURNING id',
  ).bind(user, lessonId, kind, now, now, todayUTC, MAX_BACKGROUND_GLOBAL, user, todayUTC, MAX_BACKGROUND_PER_USER)
    .first<{ id: number }>()
  if (!row) {
    const duplicate = await findJob()
    return duplicate ? { jobId: duplicate.id, status: duplicate.status } : { status: 'budget' }
  }
  try {
    await env.GENERATION_QUEUE!.send({ jobId: row.id })
    return { jobId: row.id, status: 'queued' }
  } catch (error) {
    console.error('Unable to enqueue background generation', error)
    await env.DB.prepare("UPDATE generation_jobs SET status = 'failed', error = 'queue_unavailable', updated_at = ? WHERE id = ? AND status = 'queued'")
      .bind(Date.now(), row.id).run()
    return { status: 'unavailable' }
  }
}

/** At-least-once delivery: job ids deduplicate each phase, shared generation locks
 * also coordinate direct requests. Owner fencing prevents stale job state updates. */
export async function processGenerationBatch(batch: MessageBatch<GenerationMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const id = message.body?.jobId
    if (!Number.isSafeInteger(id) || id <= 0) { message.ack(); continue }
    const now = Date.now(), owner = crypto.randomUUID()
    const job = await env.DB.prepare(
      "UPDATE generation_jobs SET status = 'running', attempt = attempt + 1, lease_owner = ?, " +
      'started_at = COALESCE(started_at, ?), lease_until = ?, updated_at = ? ' +
      "WHERE id = ? AND attempt < ? AND (status = 'queued' OR (status = 'running' AND lease_until < ?)) " +
      'RETURNING id, user_id, lesson_id, kind, attempt',
    ).bind(owner, now, now + JOB_LEASE_MS, now, id, MAX_ATTEMPTS, now).first<JobRow>()
    if (!job) {
      const other = await env.DB.prepare('SELECT status, lease_until, attempt FROM generation_jobs WHERE id = ?')
        .bind(id).first<{ status: GenerationJobStatus; lease_until: number; attempt: number }>()
      if (other?.status === 'running' && other.lease_until >= now) {
        message.retry({ delaySeconds: 30 })
      } else {
        if (other && other.attempt >= MAX_ATTEMPTS) {
          await env.DB.prepare("UPDATE generation_jobs SET status = 'failed', error = 'attempt_limit', lease_until = 0, updated_at = ? WHERE id = ? AND lease_until < ? AND status IN ('queued','running')")
            .bind(now, id, now).run()
        }
        message.ack()
      }
      continue
    }
    const finish = (status: GenerationJobStatus, error: string | null) => env.DB.prepare(
      'UPDATE generation_jobs SET status = ?, lease_until = 0, updated_at = ?, error = ? WHERE id = ? AND lease_owner = ?',
    ).bind(status, Date.now(), error, id, owner).run()
    try {
      const cached = await env.DB.prepare('SELECT ready_phase FROM quests WHERE lesson_id = ? AND user_id = ?')
        .bind(job.lesson_id, job.user_id).first<{ ready_phase: string }>()
      const satisfied = cached && (job.kind === 'quest' || cached.ready_phase === 'complete')
      if (!satisfied) {
        if (!(await backgroundBudgetAvailable(env, job.user_id, false))) {
          await finish('failed', 'budget')
          message.ack()
          continue
        }
        await generateQuestBank(env, job.user_id, false, job.lesson_id, job.kind === 'quest' ? 'starter' : 'tail', true)
      }
      await finish('done', null)
      message.ack()
    } catch (error) {
      const status = error && typeof error === 'object' && 'status' in error ? Number(error.status) : 0
      const busy = error instanceof QuestBusyError
      const final = job.attempt >= MAX_ATTEMPTS || status === 429 || /额度|quota|disabled|not found|找不到|不完整|Cloudflare-only/.test(String(error))
      // Never include learner text or prompts in diagnostic logs.
      console.warn('Background generation job failed', { id, busy, status, final })
      await finish(final ? 'failed' : 'queued', busy ? 'generation_busy' : final ? 'generation_failed' : 'retry')
      if (final) message.ack()
      else message.retry({ delaySeconds: 30 })
    }
  }
}
