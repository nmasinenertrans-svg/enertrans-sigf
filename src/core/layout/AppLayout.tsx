import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBanner } from '../../components/shared/ErrorBanner'
import { GlobalLoader } from '../../components/shared/GlobalLoader'
import { RouteTransitionLoader } from '../../components/shared/RouteTransitionLoader'
import { apiRequest, getAuthToken, setAuthToken } from '../../services/api/apiClient'
import { getQueueItems } from '../../services/offline/queue'
import type {
  AppUser,
  AuditRecord,
  ExternalRequest,
  FleetUnit,
  InventoryItem,
  MaintenancePlan,
  RepairRecord,
  WorkOrder,
} from '../../types/domain'
import { useAppContext } from '../hooks/useAppContext'
import { useOfflineSync } from '../hooks/useOfflineSync'
import { buildFleetDetailPath, ROUTE_PATHS } from '../routing/routePaths'
import { canUser } from '../auth/permissions'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'

const SIDEBAR_KEY = 'enertrans.sidebar.open'

const readSidebarState = () => {
  if (typeof window === 'undefined') {
    return false
  }

  try {
    const stored = window.localStorage.getItem(SIDEBAR_KEY)
    if (stored === null) {
      return false
    }
    return stored === 'true'
  } catch {
    return false
  }
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

const mergeByIdWithLocal = <T extends { id: string }>(remote: T[] | null, local?: T[], queue?: T[]): T[] | null => {
  if (!remote || !Array.isArray(remote)) {
    return null
  }

  const map = new Map<string, T>()
  remote.forEach((item) => map.set(item.id, item))
  ;(Array.isArray(local) ? local : []).forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, item)
    }
  })
  ;(Array.isArray(queue) ? queue : []).forEach((item) => {
    if (!map.has(item.id)) {
      map.set(item.id, item)
    }
  })

  return Array.from(map.values())
}

const mergeUsersByUsername = (remote: AppUser[] | null, local: AppUser[]): AppUser[] | null => {
  if (!remote) {
    return null
  }

  const map = new Map<string, AppUser>()
  remote.forEach((user) => {
    const key = user.username?.trim().toLowerCase() || user.id
    map.set(key, user)
  })

  local.forEach((user) => {
    const key = user.username?.trim().toLowerCase() || user.id
    if (!map.has(key)) {
      map.set(key, user)
    }
  })

  return Array.from(map.values())
}

export const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(readSidebarState)
  const [isRouteLoading, setIsRouteLoading] = useState(true)
  const location = useLocation()
  const syncStatus = useOfflineSync()
  const isFetchingRef = useRef(false)
  const {
    state: {
      fleetUnits,
      maintenancePlans,
      audits,
      workOrders,
      repairs,
      externalRequests,
      inventoryItems,
      users,
      currentUser,
      maintenanceStatus,
    },
    actions: {
      setFleetUnits,
      setMaintenancePlans,
      setAudits,
      setWorkOrders,
      setRepairs,
      setExternalRequests,
      setInventoryItems,
      setUsers,
      setCurrentUser,
      setAppError,
      setGlobalLoading,
      setMaintenanceStatus,
    },
  } = useAppContext()

  const usersRef = useRef(users)
  const fleetUnitsRef = useRef(fleetUnits)
  const maintenancePlansRef = useRef(maintenancePlans)
  const auditsRef = useRef(audits)
  const workOrdersRef = useRef(workOrders)
  const repairsRef = useRef(repairs)
  const externalRequestsRef = useRef(externalRequests)
  const inventoryRef = useRef(inventoryItems)


  useEffect(() => {
    usersRef.current = users
  }, [users])

  useEffect(() => {
    fleetUnitsRef.current = fleetUnits
  }, [fleetUnits])

  useEffect(() => {
    maintenancePlansRef.current = maintenancePlans
  }, [maintenancePlans])

  useEffect(() => {
    auditsRef.current = audits
  }, [audits])

  useEffect(() => {
    workOrdersRef.current = workOrders
  }, [workOrders])

  useEffect(() => {
    repairsRef.current = repairs
  }, [repairs])

  useEffect(() => {
    externalRequestsRef.current = externalRequests
  }, [externalRequests])

  useEffect(() => {
    inventoryRef.current = inventoryItems
  }, [inventoryItems])

  const notifications = useMemo(() => {
    const items: {
      id: string
      title: string
      description: string
      severity: 'info' | 'warning' | 'danger'
      createdAt: string
      target?: string
    }[] = []

    const documentLabelMap = {
      rto: 'RTO/VTV',
      insurance: 'Seguro',
      hoist: 'Izaje',
    } as const

    fleetUnits.forEach((unit) => {
      ;(Object.keys(documentLabelMap) as Array<keyof typeof documentLabelMap>).forEach((docKey) => {
        const expiresAt = unit.documents?.[docKey]?.expiresAt
        const status = getDocumentStatus(expiresAt)
        const label = documentLabelMap[docKey]

        if (status === 'overdue') {
          items.push({
            id: `${unit.id}-${docKey}-overdue`,
            title: `${label} vencido`,
            description: `${unit.internalCode} • ${formatDate(expiresAt)}`,
            severity: 'danger',
            createdAt: expiresAt ?? new Date().toISOString(),
            target: buildFleetDetailPath(unit.id),
          })
        }

        if (status === 'soon') {
          items.push({
            id: `${unit.id}-${docKey}-soon`,
            title: `${label} por vencer`,
            description: `${unit.internalCode} • ${formatDate(expiresAt)}`,
            severity: 'warning',
            createdAt: expiresAt ?? new Date().toISOString(),
            target: buildFleetDetailPath(unit.id),
          })
        }

        if (status === 'missing') {
          items.push({
            id: `${unit.id}-${docKey}-missing`,
            title: `${label} sin registro`,
            description: `${unit.internalCode} • ${unit.ownerCompany}`,
            severity: 'info',
            createdAt: new Date().toISOString(),
            target: buildFleetDetailPath(unit.id),
          })
        }
      })
    })

    const rejectedByUnit = new Map<string, typeof audits[number]>()
    audits.forEach((audit) => {
      if (audit.result !== 'REJECTED') {
        return
      }
      const existing = rejectedByUnit.get(audit.unitId)
      if (!existing || new Date(audit.performedAt).getTime() > new Date(existing.performedAt).getTime()) {
        rejectedByUnit.set(audit.unitId, audit)
      }
    })

    rejectedByUnit.forEach((audit) => {
      const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === audit.unitId)
      items.push({
        id: `audit-${audit.id}`,
        title: 'Auditoria rechazada',
        description: `${unit?.internalCode ?? 'Unidad'} • ${formatDate(audit.performedAt)}`,
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
        createdAt: new Date().toISOString(),
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
        createdAt: new Date().toISOString(),
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
  }, [audits, fleetUnits, workOrders])

  useEffect(() => {
    const currentUserId = currentUser?.id ?? null

    const loadRemoteData = async () => {
      if (!currentUserId || !syncStatus.isOnline) {
        return
      }

      if (isFetchingRef.current) {
        return
      }

      const token = getAuthToken()
      if (!token) {
        setCurrentUser(null)
        return
      }

      let didInvalidateSession = false
      isFetchingRef.current = true

      const safeRequest = async <T,>(path: string): Promise<T | null> => {
        try {
          return await apiRequest<T>(path)
        } catch (error) {
          const message = String((error as Error)?.message ?? '')
          if (message.includes('403')) {
            return null
          }
          if (message.includes('permisos') || message.includes('Token') || message.includes('Unauthorized') || message.includes('401')) {
            if (!didInvalidateSession) {
              didInvalidateSession = true
              setAuthToken(null)
              setCurrentUser(null)
              setAppError('Sesión expirada. Iniciá sesión nuevamente.')
            }
            return null
          }
          setAppError(`No se pudo sincronizar ${path}.`)
          return null
        }
      }

      setGlobalLoading(true)
      try {
        const canViewUsers = canUser(currentUser ?? null, 'USERS', 'view')
        const [
          usersResponse,
          fleetResponse,
          maintenanceResponse,
          auditsResponse,
          workOrdersResponse,
          repairsResponse,
          externalRequestsResponse,
          inventoryResponse,
        ] = await Promise.all([
          canViewUsers ? safeRequest<AppUser[]>('/users') : Promise.resolve(null),
          safeRequest<FleetUnit[]>('/fleet'),
          safeRequest<MaintenancePlan[]>('/maintenance'),
          safeRequest<any[]>('/audits'),
          safeRequest<WorkOrder[]>('/work-orders'),
          safeRequest<RepairRecord[]>('/repairs'),
          safeRequest<ExternalRequest[]>('/external-requests'),
          safeRequest<InventoryItem[]>('/inventory'),
        ])

        const mappedAudits: AuditRecord[] | null = auditsResponse
          ? auditsResponse.map((audit: any) => ({
              id: audit.id,
              code: audit.code,
              auditKind: audit.auditKind ?? 'AUDIT',
              unitId: audit.unitId,
              auditorUserId: audit.auditorUserId,
              auditorName: audit.auditorName,
              performedAt: audit.performedAt,
              result: audit.result,
              observations: audit.observations ?? '',
              photoBase64List: Array.isArray(audit.photoUrls) ? audit.photoUrls : [],
              checklistSections: Array.isArray(audit.checklist?.sections) ? audit.checklist.sections : [],
            }))
          : null

        const queueItems = await getQueueItems()

        const getQueuedPayloads = <T extends { id: string }>(type: string): T[] =>
          queueItems.filter((item) => item.type === type).map((item) => item.payload as T)

        if (usersResponse) {
          setUsers(mergeUsersByUsername(usersResponse, usersRef.current) ?? usersResponse)
        }
        if (fleetResponse) {
          setFleetUnits(
            mergeByIdWithLocal(fleetResponse, fleetUnitsRef.current, getQueuedPayloads('fleet.create')) ?? fleetResponse,
          )
        }
        if (maintenanceResponse) {
          setMaintenancePlans(
            mergeByIdWithLocal(
              maintenanceResponse,
              maintenancePlansRef.current,
              getQueuedPayloads('maintenance.create'),
            ) ?? maintenanceResponse,
          )
        }
        if (mappedAudits) {
          setAudits(
            mergeByIdWithLocal(mappedAudits, auditsRef.current, getQueuedPayloads('audit.create')) ?? mappedAudits,
          )
        }
        if (workOrdersResponse) {
          setWorkOrders(
            mergeByIdWithLocal(workOrdersResponse, workOrdersRef.current, getQueuedPayloads('workOrder.create')) ??
              workOrdersResponse,
          )
        }
        if (repairsResponse) {
          setRepairs(
            mergeByIdWithLocal(repairsResponse, repairsRef.current, getQueuedPayloads('repair.create')) ?? repairsResponse,
          )
        }
        if (externalRequestsResponse) {
          setExternalRequests(
            mergeByIdWithLocal(
              externalRequestsResponse,
              externalRequestsRef.current,
              getQueuedPayloads('externalRequest.create'),
            ) ?? externalRequestsResponse,
          )
        }
        if (inventoryResponse) {
          setInventoryItems(
            mergeByIdWithLocal(
              inventoryResponse,
              inventoryRef.current,
              getQueuedPayloads('inventory.create'),
            ) ?? inventoryResponse,
          )
        }
      } finally {
        setGlobalLoading(false)
        isFetchingRef.current = false
      }
    }

    loadRemoteData()
  }, [
    currentUser?.id,
    syncStatus.isOnline,
    setFleetUnits,
    setMaintenancePlans,
    setAudits,
    setWorkOrders,
    setRepairs,
    setInventoryItems,
    setUsers,
    setAppError,
    setGlobalLoading,
    setCurrentUser,
  ])

  useEffect(() => {
    if (!currentUser?.id || !syncStatus.isOnline) {
      return
    }

    if (!canUser(currentUser ?? null, 'MAINTENANCE_MODE', 'view')) {
      return
    }

    const loadMaintenance = async () => {
      try {
        const response = await apiRequest<{ enabled: boolean; message?: string }>('/settings/maintenance')
        setMaintenanceStatus({ enabled: response.enabled, message: response.message ?? '' })
      } catch {
        // ignore
      }
    }

    loadMaintenance()
  }, [currentUser?.id, syncStatus.isOnline, setMaintenanceStatus])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(SIDEBAR_KEY, String(isSidebarOpen))
    } catch {
      // ignore
    }
  }, [isSidebarOpen])

  useEffect(() => {
    setIsRouteLoading(true)
    const timer = window.setTimeout(() => setIsRouteLoading(false), 700)
    return () => window.clearTimeout(timer)
  }, [location.pathname])

  return (
    <div className="flex min-h-screen bg-transparent">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex min-h-screen flex-1 flex-col">
        <TopHeader
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          syncStatus={syncStatus}
          notifications={notifications}
        />
        {maintenanceStatus.enabled ? (
          <div className="mx-6 mt-4 rounded-lg border border-amber-300 bg-amber-100 px-4 py-3 text-sm text-amber-900 md:mx-8">
            <strong className="font-semibold">Sistema en mantenimiento:</strong>{' '}
            {maintenanceStatus.message || 'Actualizaciones en curso. Las operaciones quedan pausadas.'}
          </div>
        ) : null}
        <ErrorBanner />
        <main className="flex-1 p-6 md:p-8">
          <Outlet />
        </main>
      </div>
      <GlobalLoader />
      <RouteTransitionLoader isActive={isRouteLoading} />
    </div>
  )
}
