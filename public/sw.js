// 离线缓存：页面走网络优先（拿不到时用缓存），带哈希的静态资源缓存优先。只处理本站的 GET 请求，AI 和 GitHub 请求不经过缓存。
const CACHE = 'iteration-plan-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k)
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== self.location.origin) return

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const res = await fetch(req)
        const c = await caches.open(CACHE)
        c.put('./', res.clone())
        return res
      } catch {
        return (await caches.match('./')) || (await caches.match(req)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.includes('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      const res = await fetch(req)
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return res
    })())
    return
  }

  e.respondWith((async () => {
    const hit = await caches.match(req)
    const net = fetch(req).then(async (res) => {
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone())
      return res
    }).catch(() => hit)
    return hit || net
  })())
})
