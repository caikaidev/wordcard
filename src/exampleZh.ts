import { useEffect, useState } from 'react'
import { api } from './api'
import type { Item } from '../shared/types'

/** 正在补翻译的卡片，避免同一张卡重复请求 */
const pending = new Map<number, Promise<Item | null>>()

/** 补上例句的中文翻译并存回卡片；失败返回 null（不打扰用户，下次再试） */
function fill(item: Item): Promise<Item | null> {
  let p = pending.get(item.id)
  if (!p) {
    p = (async () => {
      try {
        const [zh] = (await api.translate([item.meta.example])).translations
        if (!zh) return null
        return (await api.update(item.id, { meta: { ...item.meta, exampleZh: zh } })).item
      } catch {
        return null
      } finally {
        pending.delete(item.id)
      }
    })()
    pending.set(item.id, p)
  }
  return p
}

/**
 * 有例句却没有中文翻译的卡片（比如从练习页「加入复习」的），展示时自动补上翻译，
 * 初学者翻到答案面才看得懂例句。返回是否正在翻译。
 */
export function useExampleZh(item: Item, onUpdate: (item: Item) => void, enabled = true) {
  const need = enabled && !!item.meta.example && !item.meta.exampleZh
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!need) return
    let alive = true
    setLoading(true)
    fill(item).then((r) => {
      if (!alive) return
      setLoading(false)
      if (r) onUpdate(r)
    })
    return () => {
      alive = false
    }
    // 只在卡片或例句变化时触发
  }, [need, item.id, item.meta.example])
  return need && loading
}
