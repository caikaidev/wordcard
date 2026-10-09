import { useSyncExternalStore } from 'react'
import { api } from './api'

/** 全局计数：今日到期、进行中、DONE。任何写操作之后调用 refreshStats() */
export type Stats = { active: number; done: number; due: number }

let stats: Stats | null = null
const ls = new Set<() => void>()

export function setStats(s: Stats) {
  stats = s
  ls.forEach((l) => l())
}

export async function refreshStats() {
  try {
    setStats(await api.stats())
  } catch {
    /* 统计失败不影响主流程 */
  }
}

export function useStats() {
  return useSyncExternalStore(
    (cb) => {
      ls.add(cb)
      return () => ls.delete(cb)
    },
    () => stats,
  )
}

/** 从别的页面（如复习卡片的来源包标签）跳到词库并筛选某个包；词库页读取后清空 */
export const libraryJump: { packageId: number | null } = { packageId: null }
