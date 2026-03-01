import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBanner } from '../../components/shared/ErrorBanner'
import { GlobalLoader } from '../../components/shared/GlobalLoader'
import { RouteTransitionLoader } from '../../components/shared/RouteTransitionLoader'
import { ApiRequestError, apiRequest, getAuthToken, setAuthToken } from '../../services/api/apiClient'
import { getQueueItems } from '../../services/offline/queue'
import type {
  AppUser,
  AuditRecord,
  ExternalRequest,
  FeatureFlags,
  FleetMovement,
  FleetUnit,
  InventoryItem,
  MaintenancePlan,
  RepairRecord,
  WorkOrder,
} from '../../types/domain'
import { useAppContext } from '../hooks/useAppContext'
import { useOfflineSync } from '../hooks/useOfflineSync'
import { canUser } from '../auth/permissions'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'
import { buildAppNotifications } from '../notifications/notifications'

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
      movements,
      inventoryItems,
      users,
      currentUser,
      maintenanceStatus,
      featureFlags,
    },
    actions: {
      setFleetUnits,
      setMaintenancePlans,
      setAudits,
      setWorkOrders,
      setRepairs,
      setExternalRequests,
      setMovements,
      setInventoryItems,
      setUsers,
      setCurrentUser,
      setAppError,
      setGlobalLoading,
      setMaintenanceStatus,
      setFeatureFlags,
    },
  } = useAppContext()

  const usersRef = useRef(users)
  const currentUserRef = useRef(currentUser)
  const fleetUnitsRef = useRef(fleetUnits)
  const maintenancePlansRef = useRef(maintenancePlans)
  const auditsRef = useRef(audits)
  const workOrdersRef = useRef(workOrders)
  const repairsRef = useRef(repairs)
  const externalRequestsRef = useRef(externalRequests)
  const movementsRef = useRef(movements)
  const inventoryRef = useRef(inventoryItems)
  const featureFlagsRef = useRef(featureFlags)


  useEffect(() => {
    usersRef.current = users
  }, [users])

  useEffect(() => {
    currentUserRef.current = currentUser
  }, [currentUser])

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
    movementsRef.current = movements
  }, [movements])

  useEffect(() => {
    inventoryRef.current = inventoryItems
  }, [inventoryItems])

  useEffect(() => {
    featureFlagsRef.current = featureFlags
  }, [featureFlags])

  const notifications = useMemo(() => {
    return buildAppNotifications({ fleetUnits, audits, workOrders })
  }, [audits, fleetUnits, workOrders])

  useEffect(() => {
    const currentUserId = currentUserRef.current?.id ?? null

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
          return await apiRequest<T>(path, { timeoutMs: 15000 })
        } catch (error) {
          if (error instanceof ApiRequestError && error.status === 403) {
            return null
          }
          if (error instanceof ApiRequestError && error.status === 401) {
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
        const canViewUsers = canUser(currentUserRef.current ?? null, 'USERS', 'view')
        const [
          usersResponse,
          fleetResponse,
          maintenanceResponse,
          auditsResponse,
          workOrdersResponse,
          repairsResponse,
          externalRequestsResponse,
          movementsResponse,
          inventoryResponse,
        ] = await Promise.all([
          canViewUsers ? safeRequest<AppUser[]>('/users') : Promise.resolve(null),
          safeRequest<FleetUnit[]>('/fleet'),
          safeRequest<MaintenancePlan[]>('/maintenance'),
          safeRequest<any[]>('/audits'),
          safeRequest<WorkOrder[]>('/work-orders'),
          safeRequest<RepairRecord[]>('/repairs'),
          safeRequest<ExternalRequest[]>('/external-requests'),
          safeRequest<FleetMovement[]>('/movements'),
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
              reportPdfFileName:
                typeof audit.checklist?.meta?.reportPdfFileName === 'string'
                  ? audit.checklist.meta.reportPdfFileName
                  : undefined,
              reportPdfFileUrl:
                typeof audit.checklist?.meta?.reportPdfFileUrl === 'string'
                  ? audit.checklist.meta.reportPdfFileUrl
                  : undefined,
              checklistSections: Array.isArray(audit.checklist?.sections) ? audit.checklist.sections : [],
              unitKilometers: audit.unitKilometers ?? 0,
              engineHours: audit.engineHours ?? 0,
              hydroHours: audit.hydroHours ?? 0,
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
          const queuedAuditPayloads = getQueuedPayloads<AuditRecord>('audit.create')
          const remoteAuditIds = new Set(mappedAudits.map((audit) => audit.id))
          const pendingQueuedAudits = queuedAuditPayloads
            .filter((audit) => audit?.id && !remoteAuditIds.has(audit.id))
            .map((audit) => ({
              ...audit,
              syncState: (syncStatus.isOnline ? 'PENDING' : 'LOCAL_ONLY') as AuditRecord['syncState'],
            }))

          // For audits we intentionally avoid merging arbitrary local persisted items:
          // if an item is not in backend and not in offline queue, it is a local ghost.
          setAudits([...mappedAudits, ...pendingQueuedAudits])
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
        if (movementsResponse) {
          setMovements(
            mergeByIdWithLocal(
              movementsResponse,
              movementsRef.current,
              getQueuedPayloads('movement.create'),
            ) ?? movementsResponse,
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
    setExternalRequests,
    setMovements,
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

    const loadFlags = async () => {
      try {
        const response = await apiRequest<FeatureFlags>('/settings/features')
        const current = featureFlagsRef.current
        const merged = { ...current, ...response }
        if (JSON.stringify(current) !== JSON.stringify(merged)) {
          setFeatureFlags(merged)
        }
      } catch {
        // ignore
      }
    }

    loadFlags()
  }, [currentUser?.id, syncStatus.isOnline, setFeatureFlags])

  useEffect(() => {
    if (!currentUser?.id || !syncStatus.isOnline) {
      return
    }

    if (!canUser(currentUserRef.current ?? null, 'MAINTENANCE_MODE', 'view')) {
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
