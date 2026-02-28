type SyncTelemetryEventName =
  | 'queue.enqueued'
  | 'sync.success'
  | 'sync.failure'
  | 'sync.dropped'
  | 'sync.blocked'
  | 'sync.skipped.blocked'
  | 'sync.unblocked.manual'

export interface SyncTelemetryEvent {
  id: string
  at: string
  name: SyncTelemetryEventName
  itemType?: string
  itemId?: string
  statusCode?: number | null
  retryable?: boolean
  reason?: string
}

export interface SyncTelemetrySnapshot {
  totals: {
    enqueued: number
    success: number
    failure: number
    dropped: number
    blocked: number
    skippedBlocked: number
    manualUnblocked: number
  }
  byItemType: Record<string, { success: number; failure: number; dropped: number; blocked: number }>
  byStatusCode: Record<string, number>
  lastEvents: SyncTelemetryEvent[]
  updatedAt: string
}

const STORAGE_KEY = 'enertrans.offline.syncTelemetry.v1'
const MAX_EVENTS = 200

const createEmptySnapshot = (): SyncTelemetrySnapshot => ({
  totals: {
    enqueued: 0,
    success: 0,
    failure: 0,
    dropped: 0,
    blocked: 0,
    skippedBlocked: 0,
    manualUnblocked: 0,
  },
  byItemType: {},
  byStatusCode: {},
  lastEvents: [],
  updatedAt: new Date().toISOString(),
})

const safeRead = (): SyncTelemetrySnapshot => {
  if (typeof window === 'undefined') {
    return createEmptySnapshot()
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return createEmptySnapshot()
    }
    const parsed = JSON.parse(raw) as Partial<SyncTelemetrySnapshot>
    return {
      ...createEmptySnapshot(),
      ...parsed,
      totals: { ...createEmptySnapshot().totals, ...(parsed.totals ?? {}) },
      byItemType: parsed.byItemType ?? {},
      byStatusCode: parsed.byStatusCode ?? {},
      lastEvents: Array.isArray(parsed.lastEvents) ? parsed.lastEvents.slice(-MAX_EVENTS) : [],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    }
  } catch {
    return createEmptySnapshot()
  }
}

const safeWrite = (snapshot: SyncTelemetrySnapshot) => {
  if (typeof window === 'undefined') {
    return
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // ignore storage failures
  }
}

const ensureItemTypeBucket = (
  snapshot: SyncTelemetrySnapshot,
  itemType: string,
): { success: number; failure: number; dropped: number; blocked: number } => {
  if (!snapshot.byItemType[itemType]) {
    snapshot.byItemType[itemType] = { success: 0, failure: 0, dropped: 0, blocked: 0 }
  }
  return snapshot.byItemType[itemType]
}

export const readSyncTelemetry = (): SyncTelemetrySnapshot => safeRead()

export const resetSyncTelemetry = () => {
  safeWrite(createEmptySnapshot())
}

export const recordSyncTelemetry = (event: Omit<SyncTelemetryEvent, 'id' | 'at'>) => {
  const snapshot = safeRead()
  const completeEvent: SyncTelemetryEvent = {
    ...event,
    id: `sync.telemetry.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
  }

  snapshot.lastEvents = [...snapshot.lastEvents, completeEvent].slice(-MAX_EVENTS)
  snapshot.updatedAt = completeEvent.at

  if (completeEvent.name === 'queue.enqueued') {
    snapshot.totals.enqueued += 1
  }
  if (completeEvent.name === 'sync.success') {
    snapshot.totals.success += 1
  }
  if (completeEvent.name === 'sync.failure') {
    snapshot.totals.failure += 1
  }
  if (completeEvent.name === 'sync.dropped') {
    snapshot.totals.dropped += 1
  }
  if (completeEvent.name === 'sync.blocked') {
    snapshot.totals.blocked += 1
  }
  if (completeEvent.name === 'sync.skipped.blocked') {
    snapshot.totals.skippedBlocked += 1
  }
  if (completeEvent.name === 'sync.unblocked.manual') {
    snapshot.totals.manualUnblocked += 1
  }

  if (completeEvent.itemType) {
    const itemTypeBucket = ensureItemTypeBucket(snapshot, completeEvent.itemType)
    if (completeEvent.name === 'sync.success') {
      itemTypeBucket.success += 1
    }
    if (completeEvent.name === 'sync.failure') {
      itemTypeBucket.failure += 1
    }
    if (completeEvent.name === 'sync.dropped') {
      itemTypeBucket.dropped += 1
    }
    if (completeEvent.name === 'sync.blocked') {
      itemTypeBucket.blocked += 1
    }
  }

  if (typeof completeEvent.statusCode === 'number') {
    const key = String(completeEvent.statusCode)
    snapshot.byStatusCode[key] = (snapshot.byStatusCode[key] ?? 0) + 1
  }

  safeWrite(snapshot)
}
