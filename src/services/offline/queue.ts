export interface OfflineQueueItem {
  id: string
  type: string
  payload: unknown
  createdAt: string
  attemptCount?: number
  lastAttemptAt?: string
  lastError?: string
  blocked?: boolean
}

const DB_NAME = 'enertrans-offline'
const STORE_NAME = 'queue'
// Guarda el token de sesion y la URL del backend tambien en IndexedDB (no
// solo en localStorage): el Service Worker que procesa el Background Sync
// corre con la app completamente cerrada, sin ninguna pestana abierta, y
// localStorage no es accesible desde ahi -- IndexedDB si.
const META_STORE_NAME = 'meta'
const DB_VERSION = 2

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const setMetaValue = async (key: string, value: string | null): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, 'readwrite')
    const store = tx.objectStore(META_STORE_NAME)
    if (value === null) {
      store.delete(key)
    } else {
      store.put(value, key)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Le pide al Service Worker que, apenas el sistema detecte señal (aunque la
// app este cerrada del todo), despierte y mande lo que quedo guardado. Si el
// navegador no lo soporta (Safari/iOS no lo soporta) no pasa nada: el
// polling de dentro de la app (cada 15s mientras esta abierta) sigue
// cubriendo el caso normal.
const registerBackgroundSync = async (): Promise<void> => {
  try {
    if (
      typeof navigator === 'undefined' ||
      !('serviceWorker' in navigator) ||
      typeof window === 'undefined' ||
      !('SyncManager' in window)
    ) {
      return
    }
    const registration = await navigator.serviceWorker.ready
    await (registration as unknown as { sync: { register: (tag: string) => Promise<void> } }).sync.register(
      'sync-offline-queue',
    )
  } catch {
    // best-effort
  }
}

export const enqueueItem = async (item: OfflineQueueItem): Promise<void> => {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put({
      ...item,
      attemptCount: item.attemptCount ?? 0,
      lastAttemptAt: item.lastAttemptAt ?? '',
      lastError: item.lastError ?? '',
      blocked: item.blocked ?? false,
    } satisfies OfflineQueueItem)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  void registerBackgroundSync()
}

export const getQueueItems = async (): Promise<OfflineQueueItem[]> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).getAll()
    request.onsuccess = () => resolve(request.result as OfflineQueueItem[])
    request.onerror = () => reject(request.error)
  })
}

export const removeQueueItem = async (id: string): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const updateQueueItem = async (id: string, patch: Partial<OfflineQueueItem>): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(id)

    request.onsuccess = () => {
      const current = request.result as OfflineQueueItem | undefined
      if (!current) {
        resolve()
        return
      }
      store.put({
        ...current,
        ...patch,
      } satisfies OfflineQueueItem)
    }

    request.onerror = () => reject(request.error)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export const clearQueue = async (): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
