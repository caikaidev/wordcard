import { api } from './api'

/* 每日提醒：浏览器的 Web Push 订阅。iPhone / iPad 要先「添加到主屏幕」，从主屏幕图标打开才能开启 */

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on'

const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true

async function registration() {
  if (!('serviceWorker' in navigator)) return null
  return (await navigator.serviceWorker.getRegistration()) ?? null
}

export async function pushState(): Promise<PushState> {
  if (!('PushManager' in window) || !('Notification' in window)) return isIOS() && !standalone() ? 'needs-install' : 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await registration()
  if (!reg) return 'unsupported'
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off'
}

const keyBytes = (b64u: string) => {
  const s = atob(b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4))
  return Uint8Array.from(s, (c) => c.charCodeAt(0))
}

/** 打开提醒：申请通知权限 → 订阅 → 交给服务器。返回最新状态 */
export async function enablePush(): Promise<PushState> {
  const { key } = await api.pushKey()
  if (!key) throw new Error('服务器还没配置推送密钥（VAPID），请管理员按部署文档补上')
  if ((await Notification.requestPermission()) !== 'granted') return pushState()
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  // 服务器换过密钥的话，旧订阅用不了，重新订阅
  if (sub && sub.options.applicationServerKey) {
    const old = new Uint8Array(sub.options.applicationServerKey)
    const cur = keyBytes(key)
    if (old.length !== cur.length || old.some((b, i) => b !== cur[i])) {
      await sub.unsubscribe()
      sub = null
    }
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) })
  await api.pushSubscribe(sub.toJSON())
  return 'on'
}

export async function disablePush(): Promise<PushState> {
  const sub = await (await registration())?.pushManager.getSubscription()
  if (sub) {
    await api.pushUnsubscribe(sub.endpoint).catch(() => {})
    await sub.unsubscribe()
  }
  return pushState()
}

/** 主屏幕图标上的数字：今天到期张数；浏览器不支持就什么也不做 */
export function setBadge(due: number) {
  const n = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
  ;(due > 0 ? n.setAppBadge?.(due) : n.clearAppBadge?.())?.catch(() => {})
}
