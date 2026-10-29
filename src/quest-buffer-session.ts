import type { Quest, StageId } from '../shared/quest'
import { BUFFER_LOW_WATER, remainingReady } from '../shared/quest-buffer'

export type QuestSnapshot = Quest | { pending: true; status: string }
export type RefillState = { busy: boolean; message: string }
type Ports = {
  start: () => Promise<QuestSnapshot>
  read: () => Promise<QuestSnapshot>
  refill: () => Promise<{ status: string }>
  complete: () => Promise<QuestSnapshot>
  onQuest: (quest: Quest) => void
  onError: (message: string) => void
  /** 原始错误。页面用来决定要不要弹出换提供方的对话框；没有时只走 onError 文案。 */
  onFail?: (error: unknown, source: 'start' | 'complete' | 'poll' | 'refill') => void
  onRefill: (state: RefillState) => void
  visible?: () => boolean
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  cancel?: (id: ReturnType<typeof setTimeout>) => void
}

/** Polls never call an inference endpoint. One automatic refill per mounted session;
 * quota/failure needs an explicit click, and late replies cannot revive a closed page. */
export function createQuestBufferSession(ports: Ports) {
  const visible = ports.visible ?? (() => true)
  const schedule = ports.schedule ?? setTimeout
  const cancel = ports.cancel ?? clearTimeout
  let closed = false, epoch = 0, polls = 0, tailRequested = false, polling = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let current: Quest | null = null
  let demand: { quest: Quest; stage: StageId; consumed: number } | null = null
  const clear = () => { if (timer !== null) cancel(timer); timer = null }
  const valid = (token: number) => !closed && token === epoch
  const errorText = (error: unknown) => error instanceof Error ? error.message : '准备题目失败，请重试'
  const state = (busy: boolean, message = '') => { if (!closed) ports.onRefill({ busy, message }) }

  const queuePoll = (token: number) => {
    clear()
    if (!valid(token) || !polling || !visible()) return
    timer = schedule(() => { timer = null; void poll(token) }, 1500)
  }
  const fail = (message: string) => {
    polling = false
    clear()
    if (current) state(false, message)
    else ports.onError(message)
  }
  const accept = (result: QuestSnapshot, token: number) => {
    if (!valid(token)) return
    if ('pending' in result) {
      if (!['queued', 'running'].includes(result.status)) return fail('后台准备未完成，请点击重试')
      polling = true
      if (current) state(true, '后续题目准备中，当前题目可以继续')
    } else {
      current = result
      ports.onQuest(result)
      polling = result.buffer?.phase === 'starter' && ['queued', 'running'].includes(result.buffer.status)
      if (result.buffer?.phase === 'complete' || !result.buffer) state(false)
      else if (polling) state(true, '后续题目准备中，当前题目可以继续')
      else if (tailRequested) state(false, '后续题目尚未就绪，已备题目可继续；可手动重试')
    }
    queuePoll(token)
  }
  const poll = async (token: number) => {
    if (!valid(token) || !polling || !visible()) return
    if (++polls > 80) return fail('准备时间较长，已停止自动检查；可手动重试')
    try { accept(await ports.read(), token) }
    catch (error) { if (valid(token)) { ports.onFail?.(error, 'poll'); fail(errorText(error)) } }
  }
  const run = async (tail: boolean) => {
    if (closed) return
    const token = ++epoch
    clear(); polling = false; polls = 0
    ports.onError('')
    if (tail) { tailRequested = true; state(true, '正在准备后续题目…') }
    try { accept(await (tail ? ports.complete() : ports.start()), token) }
    catch (error) { if (valid(token)) { ports.onFail?.(error, tail ? 'complete' : 'start'); fail(errorText(error)) } }
  }
  const tryRefill = async () => {
    if (closed || !visible() || tailRequested || !demand || current?.buffer?.phase !== 'starter') return
    const { quest, stage, consumed } = demand
    if (remainingReady(quest, stage, consumed) > BUFFER_LOW_WATER) return
    tailRequested = true
    const token = epoch
    state(true, '正在补充后续题目…')
    try {
      const r = await ports.refill()
      if (!valid(token)) return
      if (!['queued', 'running', 'done', 'cached'].includes(r.status)) {
        state(false, r.status === 'budget'
          ? '已暂停自动补题，保留交互额度；已备题目仍可练习'
          : '自动补题暂不可用；已备题目仍可练习')
        return
      }
      polling = true; polls = 0
      await poll(token)
    } catch (error) { if (valid(token)) { ports.onFail?.(error, 'refill'); state(false, errorText(error)) } }
  }
  return {
    load: () => run(false),
    complete: () => run(true),
    consume(quest: Quest, stage: StageId, consumed: number) {
      demand = { quest, stage, consumed }
      void tryRefill()
    },
    visibilityChanged() {
      if (closed) return
      if (!visible()) clear()
      else { queuePoll(epoch); void tryRefill() }
    },
    close() { closed = true; epoch++; polling = false; demand = null; clear() },
  }
}
