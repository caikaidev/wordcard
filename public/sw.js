/* 拾句 Service Worker
 *
 * - 页面（HTML）：网络优先，断网时用缓存的最后一份 → 在线时总是最新，也不会绕过 Cloudflare Access 登录
 * - /assets/*（带 hash 的 JS/CSS/字体）：缓存优先，永不过期 → 秒开
 * - /api/tts 语音：缓存优先，最多保留 MAX_AUDIO 段 → 听过的再点瞬间播放，没网也能播
 * - 其它 /api：不经过缓存，始终走网络
 */
const VERSION = 'v3'
const SHELL = `shell-${VERSION}`
const ASSETS = `assets-${VERSION}`
const AUDIO = `audio-${VERSION}`
const MAX_AUDIO = 600

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS, AUDIO])
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key)
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  if (req.mode === 'navigate') return event.respondWith(page(req))
  if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(req, ASSETS))
  // <audio> 直接请求时带 Range，交给浏览器自己处理；只接管 fetch() 发起的语音请求
  if (url.pathname === '/api/tts' && req.destination !== 'audio') return event.respondWith(audio(req))
  if (url.pathname.startsWith('/api/')) return
  // manifest 必须总是最新的：安装 / 更新 App 时 Chrome 靠它读取名字、图标、分享入口
  if (url.pathname === '/manifest.webmanifest') return
  // 图标等：后台更新
  event.respondWith(staleWhileRevalidate(req, SHELL))
})

const cacheable = (res) => res && res.ok && res.type === 'basic' && !res.redirected

async function page(req) {
  try {
    const res = await fetch(req)
    if (cacheable(res)) {
      const cache = await caches.open(SHELL)
      await cache.put('/', res.clone())
    }
    return res
  } catch {
    const cached = await caches.match('/', { cacheName: SHELL })
    return cached || Response.error()
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

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  const update = fetch(req)
    .then(async (res) => {
      if (cacheable(res)) await cache.put(req, res.clone())
      return res
    })
    .catch(() => hit || Response.error())
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
