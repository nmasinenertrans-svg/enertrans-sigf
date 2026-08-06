const CACHE_VERSION = 'enertrans-sigf-v3'
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`

const APP_SHELL_URLS = ['/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)).catch(() => null),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== APP_SHELL_CACHE).map((key) => caches.delete(key))),
    ),
  )
  self.clients.claim()
})

const isNavigationRequest = (request) => request.mode === 'navigate'

// Estrategia "network-first" para todo: nunca sirve un bundle/HTML viejo mientras
// haya conexion. El cache solo actua como respaldo offline (ver incidente que
// forzo a deshabilitar el SW por completo en src/main.tsx, commit 5fa7bb2).
self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone()
          caches.open(APP_SHELL_CACHE).then((cache) => cache.put('/index.html', clone)).catch(() => null)
          return response
        })
        .catch(async () => (await caches.match('/index.html')) || Response.error()),
    )
    return
  }

  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) {
    return
  }

  event.respondWith(fetch(request).catch(async () => (await caches.match(request)) || Response.error()))
})

self.addEventListener('push', (event) => {
  if (!event.data) {
    return
  }

  let payload = {}
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Enertrans SIGF', body: event.data.text() }
  }

  const title = payload.title || 'Enertrans SIGF'
  const options = {
    body: payload.body || '',
    icon: '/enertrans-favicon.png',
    badge: '/enertrans-favicon.png',
    tag: payload.tag || undefined,
    data: { url: payload.url || '/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        const clientUrl = new URL(client.url)
        if (clientUrl.origin === self.location.origin && 'focus' in client) {
          client.navigate(targetUrl).catch(() => null)
          return client.focus()
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
