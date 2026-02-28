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

const openDb = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

export const enqueueItem = async (item: OfflineQueueItem): Promise<void> => {
  const db = await openDb()
  return new Promise((resolve, reject) => {
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
