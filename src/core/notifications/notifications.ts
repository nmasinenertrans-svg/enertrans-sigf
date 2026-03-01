import { ROUTE_PATHS, buildFleetDetailPath } from '../routing/routePaths'
import type { AuditRecord, FleetUnit, WorkOrder } from '../../types/domain'
import { apiRequest, getAuthToken } from '../../services/api/apiClient'

export type AppNotification = {
  id: string
  title: string
  description: string
  severity: 'info' | 'warning' | 'danger'
  createdAt: string
  target?: string
}

export const NOTIFICATIONS_READ_KEY = 'enertrans.notifications.read'
export const NOTIFICATIONS_READ_UPDATED_EVENT = 'enertrans:notifications-read-updated'
let isPersistingRemote = false
let queuedRemoteIds: string[] | null = null
let hydrationInFlight: Promise<string[] | null> | null = null

const normalizeNotificationIds = (ids: string[]): string[] =>
  Array.from(new Set(ids.filter((item) => typeof item === 'string' && item.trim().length > 0)))

const areSameIds = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false
  }
  const leftSet = new Set(left)
  if (leftSet.size !== right.length) {
    return false
  }
  return right.every((item) => leftSet.has(item))
}

export const readStoredNotifications = (): string[] => {
  if (typeof window === 'undefined') {
    return []
  }
  try {
    const raw = window.localStorage.getItem(NOTIFICATIONS_READ_KEY)
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? normalizeNotificationIds(parsed) : []
  } catch {
    return []
  }
}

type PersistReadOptions = {
  merge?: boolean
}

export const persistReadNotifications = (ids: string[], options: PersistReadOptions = {}) => {
  if (typeof window === 'undefined') {
    return
  }
  const { merge = true } = options
  try {
    const current = readStoredNotifications()
    const next = merge ? normalizeNotificationIds([...current, ...ids]) : normalizeNotificationIds(ids)
    if (areSameIds(current, next)) {
      return
    }
    window.localStorage.setItem(NOTIFICATIONS_READ_KEY, JSON.stringify(next))
    window.dispatchEvent(new CustomEvent(NOTIFICATIONS_READ_UPDATED_EVENT))
    queueRemotePersist(next)
  } catch {
    // ignore
  }
}

const canSyncWithServer = () => {
  if (typeof window === 'undefined') {
    return false
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return false
  }
  return Boolean(getAuthToken())
}

const queueRemotePersist = (ids: string[]) => {
  if (!canSyncWithServer()) {
    return
  }
  queuedRemoteIds = ids
  if (isPersistingRemote) {
    return
  }
  isPersistingRemote = true
  void (async () => {
    try {
      while (queuedRemoteIds) {
        const next = queuedRemoteIds
        queuedRemoteIds = null
        await apiRequest<{ ids: string[] }>('/settings/notifications-read', {
          method: 'PUT',
          body: { ids: next },
          timeoutMs: 8000,
        })
      }
    } catch {
      // keep local state; retry on next local update
    } finally {
      isPersistingRemote = false
    }
  })()
}

export const hydrateReadNotificationsFromServer = async (): Promise<string[]> => {
  if (!canSyncWithServer()) {
    return readStoredNotifications()
  }
  if (!hydrationInFlight) {
    hydrationInFlight = (async () => {
      try {
        const response = await apiRequest<{ ids: string[] }>('/settings/notifications-read', {
          timeoutMs: 8000,
        })
        const local = readStoredNotifications()
        const merged = normalizeNotificationIds([...local, ...response.ids])
        if (!areSameIds(local, merged)) {
          persistReadNotifications(merged, { merge: false })
        }
        return merged
      } catch {
        return null
      } finally {
        hydrationInFlight = null
      }
    })()
  }
  const resolved = await hydrationInFlight
  return resolved ?? readStoredNotifications()
}

export const formatNotificationDateTime = (value?: string): string => {
  if (!value) {
    return 'Sin fecha'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

const daysBetween = (target: Date, reference: Date) =>
  Math.ceil((target.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24))

const getDocumentStatus = (expiresAt?: string, thresholdDays = 30) => {
  if (!expiresAt) {
    return 'missing'
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return 'missing'
  }
  const delta = daysBetween(date, new Date())
  if (delta < 0) {
    return 'overdue'
  }
  if (delta <= thresholdDays) {
    return 'soon'
  }
  return 'ok'
}

const formatDate = (value?: string) => {
  if (!value) {
    return 'Sin fecha'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-AR')
}

const getLatestIsoDate = (values: Array<string | undefined>): string => {
  const valid = values
    .map((value) => (value ? new Date(value).getTime() : NaN))
    .filter((value) => Number.isFinite(value)) as number[]
  if (valid.length === 0) {
    return '1970-01-01T00:00:00.000Z'
  }
  return new Date(Math.max(...valid)).toISOString()
}

export const buildAppNotifications = (params: {
  fleetUnits: FleetUnit[]
  audits: AuditRecord[]
  workOrders: WorkOrder[]
}): AppNotification[] => {
  const { fleetUnits, audits, workOrders } = params
  const items: AppNotification[] = []

  const documentLabelMap = {
    rto: 'RTO/VTV',
    insurance: 'Seguro',
    hoist: 'Izaje',
  } as const

  fleetUnits.forEach((unit) => {
    ;(Object.keys(documentLabelMap) as Array<keyof typeof documentLabelMap>).forEach((docKey) => {
      if (docKey === 'hoist' && unit.documents?.hoistNotApplicable) {
        return
      }
      const expiresAt = unit.documents?.[docKey]?.expiresAt
      const status = getDocumentStatus(expiresAt)
      const label = documentLabelMap[docKey]

      if (status === 'overdue') {
        items.push({
          id: `${unit.id}-${docKey}-overdue`,
          title: `${label} vencido`,
          description: `${unit.internalCode} - ${formatDate(expiresAt)}`,
          severity: 'danger',
          createdAt: expiresAt ?? new Date().toISOString(),
          target: buildFleetDetailPath(unit.id),
        })
      }

      if (status === 'soon') {
        items.push({
          id: `${unit.id}-${docKey}-soon`,
          title: `${label} por vencer`,
          description: `${unit.internalCode} - ${formatDate(expiresAt)}`,
          severity: 'warning',
          createdAt: expiresAt ?? new Date().toISOString(),
          target: buildFleetDetailPath(unit.id),
        })
      }

      if (status === 'missing') {
        items.push({
          id: `${unit.id}-${docKey}-missing`,
          title: `${label} sin registro`,
          description: `${unit.internalCode} - ${unit.ownerCompany}`,
          severity: 'info',
          createdAt: '1970-01-01T00:00:00.000Z',
          target: buildFleetDetailPath(unit.id),
        })
      }
    })
  })

  const latestAuditByUnit = new Map<string, AuditRecord>()
  audits.forEach((audit) => {
    const existing = latestAuditByUnit.get(audit.unitId)
    if (!existing || new Date(audit.performedAt).getTime() > new Date(existing.performedAt).getTime()) {
      latestAuditByUnit.set(audit.unitId, audit)
    }
  })

  latestAuditByUnit.forEach((audit) => {
    if (audit.result !== 'REJECTED') {
      return
    }
    const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === audit.unitId)
    items.push({
      id: `audit-${audit.id}`,
      title: 'Auditoria rechazada',
      description: `${unit?.internalCode ?? 'Unidad'} - ${formatDate(audit.performedAt)}`,
      severity: 'danger',
      createdAt: audit.performedAt,
      target: buildFleetDetailPath(audit.unitId),
    })
  })

  const openWorkOrdersCount = workOrders.filter((order) => order.status !== 'CLOSED').length
  if (openWorkOrdersCount > 0) {
    items.push({
      id: 'workorders-open',
      title: 'Ordenes de trabajo abiertas',
      description: `${openWorkOrdersCount} abiertas en flota`,
      severity: 'warning',
      createdAt: getLatestIsoDate(workOrders.map((order) => order.createdAt)),
      target: ROUTE_PATHS.workOrders,
    })
  }

  const pendingReauditCount = workOrders.filter((order) => order.pendingReaudit).length
  if (pendingReauditCount > 0) {
    items.push({
      id: 'reaudit-pending',
      title: 'Re-auditorias pendientes',
      description: `${pendingReauditCount} unidades en espera`,
      severity: 'warning',
      createdAt: getLatestIsoDate(workOrders.filter((order) => order.pendingReaudit).map((order) => order.createdAt)),
      target: ROUTE_PATHS.audits,
    })
  }

  const severityRank = { danger: 0, warning: 1, info: 2 } as const
  return items.sort((left, right) => {
    const severityDelta = severityRank[left.severity] - severityRank[right.severity]
    if (severityDelta !== 0) {
      return severityDelta
    }
    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
}

