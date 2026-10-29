import { useSyncExternalStore } from 'react'
import { reviewDayKey, type ReviewBatchState } from '../shared/review-batch'

const KEY = 'shiju-review-batch-v1'

let memory: ReviewBatchState | null = null
const listeners = new Set<() => void>()

/** 未完成的批次放在本标签页里。组件卸载、浏览器返回都不会清掉。 */
function storedBatch(): ReviewBatchState | null {
  if (memory) return memory
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) memory = JSON.parse(raw) as ReviewBatchState
  } catch {
    memory = null
  }
  return memory
}

/** 只把今天、结构还在的批次交回去。过期或坏掉的快照留待下一次写入覆盖。 */
export function readReviewBatch(): ReviewBatchState | null {
  const state = storedBatch()
  if (!state || state.day !== reviewDayKey()) return null
  if (typeof state.batchId !== 'string' || typeof state.batchSize !== 'number' || !Array.isArray(state.queue)) return null
  return state
}

export function writeReviewBatch(state: ReviewBatchState) {
  memory = state
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 隐私模式写不进存储时，至少本页内存还在 */
  }
  listeners.forEach((listener) => listener())
}

export function useReviewBatch() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    readReviewBatch,
  )
}
