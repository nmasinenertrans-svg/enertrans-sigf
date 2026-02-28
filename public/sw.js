const CACHE_VERSION = 'enertrans-sigf-v2'
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`

const APP_SHELL_URLS = ['/', '/index.html', '/manifest.webmanifest', '/enertrans-favicon.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS)).catch(() => null),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(key))
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

const isNavigationRequest = (request) => request.mode === 'navigate'

const isSameOriginStatic = (requestUrl) => {
  const url = new URL(requestUrl)
  if (url.origin !== self.location.origin) {
    return false
  }
  if (url.pathname.startsWith('/api/')) {
    return false
  }
  return true
}

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') {
    return
  }

  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(async () => {
          // Fallback only for offline navigation shell.
          const shellMatch = await caches.match('/index.html')
          if (shellMatch) {
            return shellMatch
          }
          return Response.error()
        }),
    )
    return
  }

  if (!isSameOriginStatic(request.url)) {
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) {
        return cached
      }
      return fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone()
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, clone)).catch(() => null)
          }
          return response
        })
        .catch(() => Response.error())
    }),
  )
})
