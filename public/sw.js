/* 拾句 Service Worker
 *
 * - 页面（HTML）：网络优先，弱网等待超过 1.5 秒或断网时先用缓存界面；API 仍由 Access 验证
 * - /assets/*（带 hash 的 JS/CSS/字体）：缓存优先，永不过期 → 秒开
 * - /api/tts 语音：缓存优先，最多保留 MAX_AUDIO 段 → 听过的再点瞬间播放，没网也能播
 * - 其它 /api：不经过缓存，始终走网络
 * - 推送：收到每日提醒就弹通知，并把主屏幕图标上的数字更新为今天到期张数
 */
const VERSION = 'v4'
const SHELL = `shell-${VERSION}`
// Keep immutable assets and existing audio across shell strategy updates.
const ASSETS = 'assets-v3'
const AUDIO = 'audio-v3'
const MAX_AUDIO = 600

self.addEventListener('install', (event) => {
  self.skipWaiting()
  // The first page loaded before this worker took control; seed its shell now.
  event.waitUntil((async () => {
    try {
      const res = await fetch('/', { cache: 'no-store', redirect: 'manual' })
      if (cacheable(res) && (res.headers.get('content-type') || '').includes('text/html')) {
        const cache = await caches.open(SHELL)
        await cache.put('/', res)
      }
    } catch { /* Installation still succeeds when offline. */ }
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, AUDIO])
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key)
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') return event.respondWith(page(event))
  if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(req, ASSETS))
  // <audio> 直接请求时带 Range，交给浏览器自己处理；只接管 fetch() 发起的语音请求
  if (url.pathname === '/api/tts' && req.destination !== 'audio') return event.respondWith(audio(req))
  if (url.pathname.startsWith('/api/')) return
  // manifest 必须总是最新的：安装 / 更新 App 时 Chrome 靠它读取名字、图标、分享入口
  if (url.pathname === '/manifest.webmanifest') return
  // 图标等：后台更新
  event.respondWith(staleWhileRevalidate(event, SHELL))
})

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected

async function page(event) {
  const cache = await caches.open(SHELL)
  const cached = await cache.match('/')
  const network = (async () => {
    const res = (await event.preloadResponse) || (await fetch(event.request))
    if (cacheable(res) && (res.headers.get('content-type') || '').includes('text/html')) {
      await cache.put('/', res.clone())
    }
    return res
  })()
  // Keep the network update alive even when we show the cached shell first.
  event.waitUntil(network.then(() => {}, () => {}))
  if (!cached) return network.catch(() => Response.error())
  let timer
  try {
    return await Promise.race([
      network.catch(() => cached),
      new Promise((resolve) => { timer = setTimeout(() => resolve(cached), 1500) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function cacheFirst(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (cacheable(res)) await cache.put(req, res.clone())
  return res
}

async function staleWhileRevalidate(event, name) {
  const req = event.request
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  const update = fetch(req)
    .then(async (res) => {
      if (cacheable(res)) await cache.put(req, res.clone())
      return res
    })
    .catch(() => hit || Response.error())
  event.waitUntil(update.then(() => {}))
  return hit || update
}

async function audio(req) {
  const cache = await caches.open(AUDIO)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (cacheable(res) && (res.headers.get('content-type') || '').startsWith('audio/')) {
    await cache.put(req, res.clone())
    trim(cache)
  }
  return res
}

/** 超过上限时删掉最早缓存的语音 */
async function trim(cache) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - MAX_AUDIO; i++) await cache.delete(keys[i])
}

self.addEventListener('push', (event) => {
  let msg = {}
  try {
    msg = event.data ? event.data.json() : {}
  } catch {
    msg = { body: event.data ? event.data.text() : '' }
  }
  event.waitUntil(
    (async () => {
      if (typeof msg.badge === 'number' && self.navigator.setAppBadge) {
        await (msg.badge > 0 ? self.navigator.setAppBadge(msg.badge) : self.navigator.clearAppBadge()).catch(() => {})
      }
      await self.registration.showNotification(msg.title || '拾句', {
        body: msg.body || '',
        icon: '/icon-192.png?v=2',
        tag: msg.tag || 'daily',
        renotify: true,
        data: { url: msg.url || '/' },
      })
    })(),
  )
})

// 点通知：已经开着拾句就切过去，否则新开一个
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin)
      if (win) {
        await win.focus()
        if ('navigate' in win && win.url !== url) await win.navigate(url).catch(() => {})
        return
      }
      await self.clients.openWindow(url)
    })(),
  )
})

