const CACHE_VERSION = 'enertrans-sigf-v4'
const APP_SHELL_CACHE = `${CACHE_VERSION}-app-shell`
const ASSET_CACHE = `${CACHE_VERSION}-assets`

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
      Promise.all(
        keys.filter((key) => key !== APP_SHELL_CACHE && key !== ASSET_CACHE).map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

const isNavigationRequest = (request) => request.mode === 'navigate'

// Estrategia "network-first" para todo: nunca sirve un bundle/HTML viejo mientras
// haya conexion. El cache solo actua como respaldo offline (ver incidente que
// forzo a deshabilitar el SW por completo en src/main.tsx, commit 5fa7bb2).
//
// IMPORTANTE: la rama de assets de aca abajo tiene que ESCRIBIR en el cache
// cada vez que una descarga online tiene exito (cache.put), no solo leerlo
// como respaldo. Sin ese cache.put, la app quedaba con index.html cacheado
// pero ningun .js/.css real guardado en ningun lado -- entonces al abrir
// offline, index.html cargaba desde el cache pero pedia los bundles (con
// nombre con hash, ej. index-XXXX.js) y esos SIEMPRE fallaban por no estar
// cacheados en ningun lado, dejando la pantalla en blanco para siempre
// (React nunca llegaba a montarse). Bug reportado por Nicolas: "en offline
// queda la pantalla en blanco, nunca entra a la app".
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

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone()
          caches.open(ASSET_CACHE).then((cache) => cache.put(request, clone)).catch(() => null)
        }
        return response
      })
      .catch(async () => (await caches.match(request)) || Response.error()),
  )
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

// ---------------------------------------------------------------------------
// Background Sync: manda lo que quedo guardado sin señal aunque la app este
// completamente cerrada (Android/Chrome; no soportado en iOS/Safari, ahi
// sigue dependiendo de que se reabra la app).
//
// IMPORTANTE PARA QUIEN TOQUE ESTO A FUTURO: esta es una COPIA en JS puro de
// la logica real de src/services/offline/sync.ts (el Service Worker no
// puede importar codigo TypeScript de la app). Si se agrega/cambia un tipo
// de item de cola en sync.ts (un nuevo "case" en syncItem), HAY QUE
// REPLICAR EL MISMO CAMBIO ACA ABAJO en SW_SYNC_HANDLERS, o esa asignacion
// va a fallar en silencio cuando la app este cerrada (nadie lo ve, nadie
// se entera) en vez de fallar visiblemente como pasa cuando la app esta
// abierta.
// ---------------------------------------------------------------------------

const DB_NAME = 'enertrans-offline'
const QUEUE_STORE = 'queue'
const META_STORE = 'meta'
const MAX_RETRY_ATTEMPTS = 5
const NON_RETRYABLE_STATUS_CODES = new Set([400, 404, 409, 422])

const swOpenDb = () =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

const swGetMeta = async (key) => {
  const db = await swOpenDb()
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(META_STORE)) {
      resolve(null)
      return
    }
    const tx = db.transaction(META_STORE, 'readonly')
    const request = tx.objectStore(META_STORE).get(key)
    request.onsuccess = () => resolve(request.result ?? null)
    request.onerror = () => reject(request.error)
  })
}

const swGetQueueItems = async () => {
  const db = await swOpenDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readonly')
    const request = tx.objectStore(QUEUE_STORE).getAll()
    request.onsuccess = () => resolve(request.result || [])
    request.onerror = () => reject(request.error)
  })
}

const swRemoveQueueItem = async (id) => {
  const db = await swOpenDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    tx.objectStore(QUEUE_STORE).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

const swUpdateQueueItem = async (id, patch) => {
  const db = await swOpenDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(QUEUE_STORE, 'readwrite')
    const store = tx.objectStore(QUEUE_STORE)
    const request = store.get(id)
    request.onsuccess = () => {
      const current = request.result
      if (!current) {
        resolve()
        return
      }
      store.put({ ...current, ...patch })
    }
    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

class SwApiError extends Error {
  constructor(status, body) {
    super(`${status} ${body || 'Error en la API'}`)
    this.status = status
    this.body = body
  }
}

const swApiFetch = async (baseUrl, token, path, { method = 'GET', body } = {}) => {
  const headers = { 'Content-Type': 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new SwApiError(response.status, text)
  }
  if (response.status === 204) {
    return undefined
  }
  return response.json()
}

const swParseDataUrl = (dataUrl) => {
  const [meta] = dataUrl.split(',')
  const contentType = meta?.split(':')[1]?.split(';')[0] || 'application/octet-stream'
  return contentType
}

const swUploadDataUrl = async (baseUrl, token, dataUrl, fileName, folder) => {
  const contentType = swParseDataUrl(dataUrl)
  const response = await swApiFetch(baseUrl, token, '/files/upload', {
    method: 'POST',
    body: { fileName, contentType, dataUrl, folder },
  })
  return response.url
}

const swSanitizeFleetUpdateData = (rawData) => {
  const data = { ...rawData }
  delete data.id
  delete data.crmDealLink
  const rawLogisticsUpdatedAt = data.logisticsUpdatedAt
  if (rawLogisticsUpdatedAt === null || rawLogisticsUpdatedAt === undefined || rawLogisticsUpdatedAt === '') {
    delete data.logisticsUpdatedAt
  } else if (typeof rawLogisticsUpdatedAt !== 'string') {
    delete data.logisticsUpdatedAt
  }
  if (typeof data.clientId === 'string' && !data.clientId.trim()) {
    data.clientId = null
  }
  return data
}

// Copia (simplificada, sin el merge server-side de secciones) de syncAudit en sync.ts
const swSyncAudit = async (baseUrl, token, payload) => {
  const photoUrls = Array.isArray(payload.photoUrls) ? [...payload.photoUrls] : []
  const photoList = payload.photoBase64List || []
  if (photoUrls.length === 0) {
    for (let index = 0; index < photoList.length; index += 1) {
      const url = await swUploadDataUrl(baseUrl, token, photoList[index], `audit-${payload.id}-${index}.jpg`, 'audits')
      photoUrls.push(url)
    }
  }

  let reportPdfFileUrl = payload.reportPdfFileUrl || ''
  if (!reportPdfFileUrl && payload.reportPdfFileBase64) {
    reportPdfFileUrl = await swUploadDataUrl(
      baseUrl,
      token,
      payload.reportPdfFileBase64,
      payload.reportPdfFileName || `audit-${payload.id}.pdf`,
      'audits',
    )
  }

  const body = {
    id: payload.id,
    auditKind: payload.auditKind,
    workOrderId: payload.workOrderId,
    workOrderCode: payload.workOrderCode,
    unitId: payload.unitId,
    auditorUserId: payload.auditorUserId,
    auditorName: payload.auditorName,
    performedAt: payload.performedAt,
    result: payload.result,
    observations: payload.observations,
    photoUrls,
    checklist: {
      sections: payload.checklistSections,
      meta: reportPdfFileUrl
        ? { reportPdfFileUrl, reportPdfFileName: payload.reportPdfFileName || `audit-${payload.id}.pdf` }
        : undefined,
    },
    unitKilometers: payload.unitKilometers ?? 0,
    engineHours: payload.engineHours ?? 0,
    hydroHours: payload.hydroHours ?? 0,
  }

  await swApiFetch(baseUrl, token, '/audits', { method: 'POST', body })
}

// Espejo de syncItem() en src/services/offline/sync.ts -- ver aviso arriba.
const SW_SYNC_HANDLERS = {
  'fleet.create': (baseUrl, token, payload) => swApiFetch(baseUrl, token, '/fleet', { method: 'POST', body: payload }),
  'fleet.update': (baseUrl, token, payload) => {
    if (!payload?.id) return Promise.resolve()
    const dataFromPayload =
      'data' in payload && payload.data && typeof payload.data === 'object'
        ? payload.data
        : (() => {
            const legacy = { ...payload }
            delete legacy.id
            return legacy
          })()
    return swApiFetch(baseUrl, token, `/fleet/${payload.id}`, {
      method: 'PATCH',
      body: swSanitizeFleetUpdateData(dataFromPayload),
    })
  },
  'fleet.delete': (baseUrl, token, payload) => {
    if (!payload?.id) return Promise.resolve()
    return swApiFetch(baseUrl, token, `/fleet/${payload.id}`, { method: 'DELETE' })
  },
  'maintenance.create': (baseUrl, token, payload) =>
    swApiFetch(baseUrl, token, '/maintenance', { method: 'POST', body: payload }),
  'workOrder.create': (baseUrl, token, payload) =>
    swApiFetch(baseUrl, token, '/work-orders', { method: 'POST', body: payload }),
  'repair.create': async (baseUrl, token, payload) => {
    let invoiceFileUrl = payload.invoiceFileUrl || ''
    let invoiceFileBase64 = payload.invoiceFileBase64 || ''
    if (invoiceFileBase64 && !invoiceFileUrl) {
      invoiceFileUrl = await swUploadDataUrl(
        baseUrl,
        token,
        invoiceFileBase64,
        payload.invoiceFileName || `repair-${payload.id}.pdf`,
        'repairs',
      )
      invoiceFileBase64 = ''
    }
    await swApiFetch(baseUrl, token, '/repairs', { method: 'POST', body: { ...payload, invoiceFileUrl, invoiceFileBase64 } })
  },
  'inventory.create': (baseUrl, token, payload) =>
    swApiFetch(baseUrl, token, '/inventory', { method: 'POST', body: payload }),
  'invoice.create': async (baseUrl, token, payload) => {
    let fileUrl = payload.fileUrl || ''
    let fileBase64 = payload.fileBase64 || ''
    if (fileBase64 && !fileUrl) {
      fileUrl = await swUploadDataUrl(baseUrl, token, fileBase64, payload.fileName || `invoice-${payload.id}.pdf`, 'invoices')
      fileBase64 = ''
    }
    await swApiFetch(baseUrl, token, '/invoices', { method: 'POST', body: { ...payload, fileUrl, fileBase64 } })
  },
  'audit.create': (baseUrl, token, payload) => swSyncAudit(baseUrl, token, payload),
  'externalRequest.create': async (baseUrl, token, payload) => {
    let providerFileUrl = payload.providerFileUrl || ''
    let providerFileBase64 = payload.providerFileBase64 || ''
    if (providerFileBase64 && !providerFileUrl) {
      providerFileUrl = await swUploadDataUrl(
        baseUrl,
        token,
        providerFileBase64,
        payload.providerFileName || `external-${payload.id}.pdf`,
        'external-requests',
      )
      providerFileBase64 = ''
    }
    await swApiFetch(baseUrl, token, '/external-requests', {
      method: 'POST',
      body: { ...payload, providerFileUrl, providerFileBase64 },
    })
  },
  'externalRequest.delete': (baseUrl, token, payload) => {
    if (!payload?.id) return Promise.resolve()
    return swApiFetch(baseUrl, token, `/external-requests/${payload.id}`, { method: 'DELETE' })
  },
  'movement.create': async (baseUrl, token, payload) => {
    let pdfFileUrl = payload.pdfFileUrl || ''
    let pdfFileBase64 = payload.pdfFileBase64 || ''
    if (pdfFileBase64 && !pdfFileUrl) {
      pdfFileUrl = await swUploadDataUrl(baseUrl, token, pdfFileBase64, payload.pdfFileName || `remito-${payload.id}.pdf`, 'remitos')
      pdfFileBase64 = ''
    }
    await swApiFetch(baseUrl, token, '/movements', { method: 'POST', body: { ...payload, pdfFileUrl, pdfFileBase64 } })
  },
  'task.create': (baseUrl, token, payload) => swApiFetch(baseUrl, token, '/tasks', { method: 'POST', body: payload }),
  'trip.create': (baseUrl, token, payload) => swApiFetch(baseUrl, token, '/trips', { method: 'POST', body: payload }),
  'crmDeal.create': (baseUrl, token, payload) =>
    swApiFetch(baseUrl, token, '/crm/deals', { method: 'POST', body: payload }),
}

const swSyncOfflineQueue = async () => {
  const [baseUrl, token] = await Promise.all([swGetMeta('apiBaseUrl'), swGetMeta('authToken')])
  if (!baseUrl || !token) {
    return
  }

  const items = await swGetQueueItems()
  let successCount = 0

  for (const item of items) {
    const handler = SW_SYNC_HANDLERS[item.type]
    if (!handler) {
      continue
    }
    if (item.blocked) {
      continue
    }
    try {
      await handler(baseUrl, token, item.payload)
      await swRemoveQueueItem(item.id)
      successCount += 1
    } catch (error) {
      const statusCode = error instanceof SwApiError ? error.status : null
      if (item.type === 'audit.create' && statusCode === 409) {
        await swRemoveQueueItem(item.id)
        continue
      }
      const nextAttemptCount = (item.attemptCount ?? 0) + 1
      const isBlocked = nextAttemptCount >= MAX_RETRY_ATTEMPTS
      const message = error?.message || 'Error al sincronizar en segundo plano.'
      await swUpdateQueueItem(item.id, {
        attemptCount: nextAttemptCount,
        lastAttemptAt: new Date().toISOString(),
        lastError: isBlocked ? `PAUSADO_AUTOMATICO: supero ${MAX_RETRY_ATTEMPTS} intentos. ${message}` : message,
        blocked: statusCode && !NON_RETRYABLE_STATUS_CODES.has(statusCode) ? item.blocked : isBlocked,
      })
    }
  }

  if (successCount > 0) {
    await self.registration
      .showNotification('Enertrans SIGF', {
        body:
          successCount === 1
            ? 'Se sincronizo 1 trabajo guardado en este celular.'
            : `Se sincronizaron ${successCount} trabajos guardados en este celular.`,
        icon: '/enertrans-favicon.png',
        badge: '/enertrans-favicon.png',
        tag: 'offline-sync-complete',
      })
      .catch(() => null)
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-offline-queue') {
    event.waitUntil(swSyncOfflineQueue())
  }
})
