import type { Grade, Item } from './types'

/** 每批张数：到期很多时分批来，先完成一小批。 */
export const REVIEW_BATCH_SIZE = 20

export type BatchPhase = 'active' | 'resting' | 'skipped' | 'done' | 'empty'

/**
 * 一次复习批次。离开页面不会丢掉它：进度以 batchIndex / sessionGraded 为准，
 * 而不是重新从服务端到期列表的第 1 张计。
 */
export interface ReviewBatchState {
  batchId: string
  /** 这一批要结算多少张（不足一批时小于 20） */
  batchSize: number
  /** 本批已经作答过的张数（含「忘了」，不含巩固再答、不含跳过） */
  batchIndex: number
  /** 本次学习里真正写入服务端的评分数（跨批次累计；巩固不再 +1） */
  sessionGraded: number
  /** 本批窗口内已经结算离开的张数（记得 / 模糊 / DONE / 巩固完成），用来判断一批是否做完 */
  reviewed: number
  /** reviewed 达到它、且后面还有卡，就进入休息 */
  batchEnd: number
  queue: Item[]
  skipped: Item[]
  /** 本轮点过「忘了」、还要再出现一次的卡片 */
  againIds: number[]
  /** 本批已经计过进度的卡片，避免同一张再把 batchIndex +1 */
  gradedIds: number[]
  phase: BatchPhase
  /** 明确新开的一批；进行中的进度文案必须带「新一批」 */
  isNewBatch: boolean
  /** 本地日历日。跨天不沿用昨天的批次 */
  day: string
}

export type BatchAction =
  | { type: 'record'; grade: Grade; updated: Item }
  | { type: 'practice' }
  | { type: 'done' }
  | { type: 'skip' }
  | { type: 'restore-skipped' }
  | { type: 'continue' }
  | { type: 'replace'; item: Item }

export function reviewDayKey(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function newBatchId(now = Date.now()) {
  return `b-${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function batchInProgress(state: ReviewBatchState | null): boolean {
  return state?.phase === 'active'
}

export interface BatchProgress {
  current: number
  total: number
  /** 本批已经结算离开的张数，进度条用它，不把当前这张算进去 */
  done: number
  /** 例如 `4/20` 或 `新一批 · 1/5` */
  label: string
  retrying: number
  /** 本批还没结算的张数，用于「本批剩」 */
  remaining: number
}

export function batchProgress(state: ReviewBatchState): BatchProgress {
  const total = state.batchSize
  const head = state.phase === 'active' ? state.queue[0] : undefined
  const onFresh = !!head && !state.againIds.includes(head.id)
  let current = 0
  if (total > 0) {
    if (state.phase === 'active') current = Math.min(Math.max(state.batchIndex + (onFresh ? 1 : 0), head ? 1 : 0), total)
    else if (state.phase === 'resting' || state.phase === 'done') current = total
    else current = Math.min(state.batchIndex, total)
  }
  const prefix = state.isNewBatch && state.phase === 'active' ? '新一批 · ' : ''
  const label = total > 0 ? `${prefix}${current}/${total}` : state.isNewBatch ? '新一批' : ''
  const batchStart = state.batchEnd - state.batchSize
  const done = Math.max(0, Math.min(state.batchSize, state.reviewed - batchStart))
  const retrying = state.queue.filter((card) => state.againIds.includes(card.id)).length
  const remaining = Math.min(state.queue.length, Math.max(0, state.batchEnd - state.reviewed))
  return { current, total, done, label, retrying, remaining }
}

export function resumeOrStart(saved: ReviewBatchState | null, due: Item[], now = new Date()): ReviewBatchState {
  const day = reviewDayKey(now)
  if (!isBatchState(saved) || saved.day !== day) {
    return startFromDue(due, { day, isNewBatch: false, sessionGraded: 0, reviewed: 0 })
  }
  if (saved.phase === 'done' || saved.phase === 'empty') {
    if (due.length === 0) {
      return phaseOf({ ...saved, queue: [], skipped: [], isNewBatch: false, day })
    }
    return startFromDue(due, {
      day,
      isNewBatch: saved.sessionGraded > 0 || saved.reviewed > 0,
      sessionGraded: saved.sessionGraded,
      reviewed: saved.reviewed,
    })
  }
  return reconcile(saved, due, day)
}

export function reduceBatch(state: ReviewBatchState, action: BatchAction): ReviewBatchState {
  switch (action.type) {
    case 'record':
      return record(state, action.grade, action.updated)
    case 'practice':
      return practice(state)
    case 'done':
      return markDone(state)
    case 'skip':
      return skip(state)
    case 'restore-skipped':
      return restoreSkipped(state)
    case 'continue':
      return continueBatch(state)
    case 'replace':
      return replace(state, action.item)
    default:
      return state
  }
}

function startFromDue(
  due: Item[],
  ctx: { day: string; isNewBatch: boolean; sessionGraded: number; reviewed: number },
): ReviewBatchState {
  const batchSize = Math.min(REVIEW_BATCH_SIZE, due.length)
  return phaseOf({
    batchId: newBatchId(),
    batchSize,
    batchIndex: 0,
    sessionGraded: ctx.sessionGraded,
    reviewed: ctx.reviewed,
    batchEnd: ctx.reviewed + batchSize,
    queue: due.slice(),
    skipped: [],
    againIds: [],
    gradedIds: [],
    phase: 'active',
    isNewBatch: due.length > 0 && ctx.isNewBatch,
    day: ctx.day,
  })
}

/** 把离开前的队列和刚拉到的到期列表对齐：已评的不再从 1 计数，「忘了」的仍留在本批队尾。 */
function reconcile(saved: ReviewBatchState, due: Item[], day: string): ReviewBatchState {
  const dueById = new Map(due.map((item) => [item.id, item]))
  const again = new Set(saved.againIds)
  const keep = (item: Item): Item | null => {
    const fresh = dueById.get(item.id)
    if (again.has(item.id)) return fresh ? { ...item, ...fresh } : item
    return fresh ?? null
  }
  const queue = saved.queue.map(keep).filter((item): item is Item => item !== null)
  const skipped = saved.skipped.map(keep).filter((item): item is Item => item !== null)
  const alive = new Set([...queue, ...skipped].map((item) => item.id))
  return phaseOf({
    ...saved,
    day,
    queue,
    skipped,
    againIds: saved.againIds.filter((id) => alive.has(id)),
  })
}

function record(state: ReviewBatchState, grade: Grade, updated: Item): ReviewBatchState {
  const card = state.queue[0]
  if (!card || state.phase !== 'active') return state
  if (state.againIds.includes(card.id)) return practice(state)
  const first = !state.gradedIds.includes(card.id)
  const base: ReviewBatchState = {
    ...state,
    gradedIds: first ? [...state.gradedIds, card.id] : state.gradedIds,
    batchIndex: first ? state.batchIndex + 1 : state.batchIndex,
    sessionGraded: state.sessionGraded + 1,
  }
  if (grade === 0) {
    const nextItem = { ...card, ...updated, id: card.id }
    return phaseOf({
      ...base,
      againIds: [...state.againIds, card.id],
      queue: [...state.queue.slice(1), nextItem],
    })
  }
  return phaseOf({
    ...base,
    reviewed: state.reviewed + 1,
    queue: state.queue.slice(1),
  })
}

function practice(state: ReviewBatchState): ReviewBatchState {
  const card = state.queue[0]
  if (!card || state.phase !== 'active') return state
  return phaseOf({
    ...state,
    reviewed: state.reviewed + 1,
    againIds: state.againIds.filter((id) => id !== card.id),
    queue: state.queue.slice(1),
  })
}

function markDone(state: ReviewBatchState): ReviewBatchState {
  const card = state.queue[0]
  if (!card || state.phase !== 'active') return state
  const first = !state.gradedIds.includes(card.id)
  return phaseOf({
    ...state,
    gradedIds: first ? [...state.gradedIds, card.id] : state.gradedIds,
    batchIndex: first ? state.batchIndex + 1 : state.batchIndex,
    reviewed: state.reviewed + 1,
    againIds: state.againIds.filter((id) => id !== card.id),
    queue: state.queue.slice(1),
  })
}

function skip(state: ReviewBatchState): ReviewBatchState {
  const card = state.queue[0]
  if (!card || state.phase !== 'active') return state
  return phaseOf({
    ...state,
    queue: state.queue.slice(1),
    skipped: [...state.skipped, card],
  })
}

function restoreSkipped(state: ReviewBatchState): ReviewBatchState {
  if (state.skipped.length === 0) return state
  return phaseOf({
    ...state,
    queue: [...state.queue, ...state.skipped],
    skipped: [],
  })
}

function continueBatch(state: ReviewBatchState): ReviewBatchState {
  if (state.phase !== 'resting') return state
  const batchSize = Math.min(REVIEW_BATCH_SIZE, state.queue.length)
  if (batchSize === 0) return phaseOf({ ...state, isNewBatch: false })
  return phaseOf({
    ...state,
    batchId: newBatchId(),
    batchSize,
    batchIndex: 0,
    batchEnd: state.reviewed + batchSize,
    gradedIds: [],
    isNewBatch: true,
    phase: 'active',
  })
}

function replace(state: ReviewBatchState, item: Item): ReviewBatchState {
  const map = (list: Item[]) => list.map((card) => (card.id === item.id ? { ...card, ...item } : card))
  return { ...state, queue: map(state.queue), skipped: map(state.skipped) }
}

function phaseOf(state: ReviewBatchState): ReviewBatchState {
  let phase: BatchPhase
  if (state.queue.length === 0 && state.skipped.length === 0) {
    phase = state.reviewed > 0 || state.sessionGraded > 0 || state.batchIndex > 0 ? 'done' : 'empty'
  } else if (state.queue.length === 0) {
    phase = 'skipped'
  } else if (state.reviewed >= state.batchEnd) {
    phase = 'resting'
  } else {
    phase = 'active'
  }
  return phase === state.phase ? state : { ...state, phase }
}

function isBatchState(value: ReviewBatchState | null): value is ReviewBatchState {
  if (!value || typeof value !== 'object') return false
  return (
    typeof value.batchId === 'string' &&
    typeof value.batchSize === 'number' &&
    typeof value.batchIndex === 'number' &&
    typeof value.sessionGraded === 'number' &&
    typeof value.reviewed === 'number' &&
    typeof value.batchEnd === 'number' &&
    Array.isArray(value.queue) &&
    Array.isArray(value.skipped) &&
    Array.isArray(value.againIds) &&
    Array.isArray(value.gradedIds) &&
    typeof value.day === 'string' &&
    (value.phase === 'active' || value.phase === 'resting' || value.phase === 'skipped' || value.phase === 'done' || value.phase === 'empty')
  )
}
