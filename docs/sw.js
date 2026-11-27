const CACHE_NAME = 'trx-flow-static-v2'
const APP_BASE = new URL('.', self.registration.scope).pathname
const appPath = (path) => `${APP_BASE}${path}`
const APP_INDEX = appPath('index.html')
const APP_SHELL = [APP_BASE, APP_INDEX, appPath('favicon.svg'), appPath('manifest.webmanifest')]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('trx-flow-static-') && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      let response
      try {
        response = await fetch(request)
      } catch (error) {
        const fallback = await caches.match(APP_INDEX)
        if (fallback) return fallback
        throw error
      }
      if (response.ok) await (await caches.open(CACHE_NAME)).put(APP_INDEX, response.clone())
      return response
    })())
    return
  }

  if (url.pathname.startsWith(appPath('assets/')) || url.pathname === appPath('favicon.svg') || url.pathname === appPath('manifest.webmanifest')) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
        }
        return response
      })),
    )
  }
})
