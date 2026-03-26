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
  ClientAccount,
  DeliveryOperation,
  ExternalRequest,
  FeatureFlags,
  FleetMovement,
  FleetUnit,
  InventoryItem,
  MaintenancePlan,
  RepairRecord,
  Supplier,
  UserInboxNotification,
  WorkOrder,
} from '../../types/domain'
import { useAppContext } from '../hooks/useAppContext'
import { useOfflineSync } from '../hooks/useOfflineSync'
import { canUser } from '../auth/permissions'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'
import { buildAppNotifications } from '../notifications/notifications'

const SIDEBAR_KEY = 'enertrans.sidebar.open'
const RETRYABLE_SYNC_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])
const WORK_ORDERS_SYNC_INTERVAL_MS = 20000

const waitMs = (ms: number) => new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms))

const isRetryableSyncError = (error: unknown): boolean => {
  if (error instanceof ApiRequestError) {
    return RETRYABLE_SYNC_STATUS_CODES.has(error.status)
  }
  return true
}

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
      userNotifications,
      movements,
      clients,
      suppliers,
      deliveries,
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
      setUserNotifications,
      setMovements,
      setClients,
      setSuppliers,
      setDeliveries,
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
  const clientsRef = useRef(clients)
  const suppliersRef = useRef(suppliers)
  const deliveriesRef = useRef(deliveries)
  const inventoryRef = useRef(inventoryItems)
  const featureFlagsRef = useRef(featureFlags)
  const lastSyncErrorAtRef = useRef<Record<string, number>>({})
  const workOrdersRefreshInProgressRef = useRef(false)
  const basicViewBlockedAtRef = useRef(0)


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
    clientsRef.current = clients
  }, [clients])

  useEffect(() => {
    suppliersRef.current = suppliers
  }, [suppliers])

  useEffect(() => {
    deliveriesRef.current = deliveries
  }, [deliveries])

  useEffect(() => {
    inventoryRef.current = inventoryItems
  }, [inventoryItems])

  useEffect(() => {
    featureFlagsRef.current = featureFlags
  }, [featureFlags])

  const isBasicViewModeEnabled = featureFlags.basicViewMode && currentUser?.role !== 'DEV'

  const notifications = useMemo(() => {
    return buildAppNotifications({ fleetUnits, audits, workOrders, userNotifications })
  }, [audits, fleetUnits, workOrders, userNotifications])

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

      const reportSyncError = (path: string) => {
        const now = Date.now()
        const lastAt = lastSyncErrorAtRef.current[path] ?? 0
        if (now - lastAt < 120000) {
          return
        }
        lastSyncErrorAtRef.current[path] = now
        setAppError(`No se pudo sincronizar ${path}.`)
      }

      const safeRequest = async <T,>(
        path: string,
        options?: { silent?: boolean; maxAttempts?: number; timeoutMs?: number },
      ): Promise<T | null> => {
        const maxAttempts = Math.max(1, options?.maxAttempts ?? 1)
        const baseTimeoutMs = options?.timeoutMs ?? 15000

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
          try {
            const timeoutMs = baseTimeoutMs + (attempt - 1) * 5000
            return await apiRequest<T>(path, { timeoutMs })
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

            const canRetry = attempt < maxAttempts && isRetryableSyncError(error)
            if (canRetry) {
              await waitMs(attempt * 600)
              continue
            }

            if (!options?.silent) {
              reportSyncError(path)
            }
            return null
          }
        }

        if (!options?.silent) {
          reportSyncError(path)
        }
        return null
      }

      setGlobalLoading(true)
      try {
        const canViewUsers = canUser(currentUserRef.current ?? null, 'USERS', 'view')
        const activeFlags = featureFlagsRef.current
        const shouldSyncMaintenance = activeFlags.showMaintenanceModule
        const shouldSyncAudits = activeFlags.showAuditsModule
        const shouldSyncWorkOrders = activeFlags.showWorkOrdersModule
        const shouldSyncRepairs = activeFlags.showRepairsModule
        const shouldSyncSuppliers = activeFlags.showSuppliersModule
        const shouldSyncExternalRequests = activeFlags.showExternalRequestsModule
        const shouldSyncMovements = activeFlags.showMovementsModule
        const shouldSyncClients = activeFlags.showClientsModule
        const shouldSyncDeliveries = activeFlags.showDeliveriesModule
        const shouldSyncInventory = activeFlags.showInventoryModule
        const [
          usersResponse,
          fleetResponse,
          maintenanceResponse,
          auditsResponse,
          workOrdersResponse,
          repairsResponse,
          suppliersResponse,
          externalRequestsResponse,
          movementsResponse,
          clientsResponse,
          deliveriesResponse,
          inventoryResponse,
          userNotificationsResponse,
        ] = await Promise.all([
          canViewUsers ? safeRequest<AppUser[]>('/users') : Promise.resolve(null),
          safeRequest<FleetUnit[]>('/fleet'),
          shouldSyncMaintenance ? safeRequest<MaintenancePlan[]>('/maintenance', { silent: true }) : Promise.resolve(null),
          shouldSyncAudits ? safeRequest<any[]>('/audits', { maxAttempts: 2, timeoutMs: 20000 }) : Promise.resolve(null),
          shouldSyncWorkOrders
            ? safeRequest<WorkOrder[]>('/work-orders', { maxAttempts: 3, timeoutMs: 22000 })
            : Promise.resolve(null),
          shouldSyncRepairs ? safeRequest<RepairRecord[]>('/repairs', { silent: true }) : Promise.resolve(null),
          shouldSyncSuppliers ? safeRequest<Supplier[]>('/suppliers', { silent: true }) : Promise.resolve(null),
          shouldSyncExternalRequests
            ? safeRequest<ExternalRequest[]>('/external-requests', { silent: true })
            : Promise.resolve(null),
          shouldSyncMovements ? safeRequest<FleetMovement[]>('/movements', { silent: true }) : Promise.resolve(null),
          shouldSyncClients ? safeRequest<ClientAccount[]>('/clients', { silent: true }) : Promise.resolve(null),
          shouldSyncDeliveries ? safeRequest<DeliveryOperation[]>('/deliveries', { silent: true }) : Promise.resolve(null),
          shouldSyncInventory ? safeRequest<InventoryItem[]>('/inventory', { silent: true }) : Promise.resolve(null),
          safeRequest<UserInboxNotification[]>('/notifications', { silent: true }),
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
          const mergedFleet =
            mergeByIdWithLocal(fleetResponse, fleetUnitsRef.current, getQueuedPayloads('fleet.create')) ?? fleetResponse
          const queuedFleetUpdates = getQueuedPayloads<FleetUnit>('fleet.update')
          const queuedById = new Map<string, FleetUnit>()
          queuedFleetUpdates.forEach((unit) => {
            if (unit?.id) {
              queuedById.set(unit.id, unit)
            }
          })
          setFleetUnits(
            mergedFleet.map((unit) => {
              const queued = queuedById.get(unit.id)
              return queued ? { ...unit, ...queued } : unit
            }),
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
        if (suppliersResponse) {
          setSuppliers(mergeByIdWithLocal(suppliersResponse, suppliersRef.current) ?? suppliersResponse)
        }
        if (externalRequestsResponse) {
          const queuedExternalRequests = getQueuedPayloads<ExternalRequest>('externalRequest.create')
          const remoteIds = new Set(externalRequestsResponse.map((request) => request.id))
          const pendingQueuedRequests = queuedExternalRequests.filter((request) => request?.id && !remoteIds.has(request.id))
          setExternalRequests([...externalRequestsResponse, ...pendingQueuedRequests])
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
        if (clientsResponse) {
          setClients(mergeByIdWithLocal(clientsResponse, clientsRef.current) ?? clientsResponse)
        }
        if (deliveriesResponse) {
          setDeliveries(mergeByIdWithLocal(deliveriesResponse, deliveriesRef.current) ?? deliveriesResponse)
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
        if (userNotificationsResponse) {
          setUserNotifications(userNotificationsResponse)
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
    setSuppliers,
    setExternalRequests,
    setMovements,
    setClients,
    setDeliveries,
    setInventoryItems,
    setUserNotifications,
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
    if (!currentUser?.id || !syncStatus.isOnline) {
      return
    }

    if (!featureFlags.showWorkOrdersModule) {
      return
    }

    const refreshWorkOrders = async () => {
      if (workOrdersRefreshInProgressRef.current || isFetchingRef.current) {
        return
      }

      const token = getAuthToken()
      if (!token) {
        return
      }

      workOrdersRefreshInProgressRef.current = true
      try {
        let response: WorkOrder[] | null = null
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            response = await apiRequest<WorkOrder[]>('/work-orders', { timeoutMs: 22000 + (attempt - 1) * 5000 })
            break
          } catch (error) {
            if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
              return
            }
            if (attempt >= 3 || !isRetryableSyncError(error)) {
              throw error
            }
            await waitMs(attempt * 600)
          }
        }

        if (!response) {
          return
        }

        const queueItems = await getQueueItems()
        const queuedWorkOrders = queueItems
          .filter((item) => item.type === 'workOrder.create')
          .map((item) => item.payload as WorkOrder)
        const merged =
          mergeByIdWithLocal(response, workOrdersRef.current, queuedWorkOrders) ??
          response
        setWorkOrders(merged)
      } catch {
        const now = Date.now()
        const lastAt = lastSyncErrorAtRef.current['/work-orders'] ?? 0
        if (now - lastAt >= 120000) {
          lastSyncErrorAtRef.current['/work-orders'] = now
          setAppError('No se pudo sincronizar /work-orders.')
        }
      } finally {
        workOrdersRefreshInProgressRef.current = false
      }
    }

    void refreshWorkOrders()
    const intervalId = window.setInterval(() => {
      void refreshWorkOrders()
    }, WORK_ORDERS_SYNC_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
      workOrdersRefreshInProgressRef.current = false
    }
  }, [currentUser?.id, syncStatus.isOnline, featureFlags.showWorkOrdersModule, setAppError, setWorkOrders])

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

  useEffect(() => {
    if (typeof window === 'undefined' || !isBasicViewModeEnabled) {
      return
    }

    const notifyBlockedAction = () => {
      const now = Date.now()
      if (now - basicViewBlockedAtRef.current < 1200) {
        return
      }
      basicViewBlockedAtRef.current = now
      setAppError('Modo vista basica activo: operacion bloqueada para este usuario.')
    }

    const isDownloadAnchor = (element: Element): boolean => {
      if (element.tagName.toLowerCase() !== 'a') {
        return false
      }
      const anchor = element as HTMLAnchorElement
      if (anchor.hasAttribute('download')) {
        return true
      }
      const href = (anchor.getAttribute('href') ?? '').trim().toLowerCase()
      if (!href) {
        return false
      }
      return (
        href.startsWith('blob:') ||
        href.startsWith('data:') ||
        href.includes('.pdf') ||
        href.includes('.csv') ||
        href.includes('.xlsx') ||
        href.includes('/storage/v1/object') ||
        href.includes('supabase.co/storage')
      )
    }

    const onClickCapture = (event: MouseEvent) => {
      const rawTarget = event.target
      if (!(rawTarget instanceof Element)) {
        return
      }
      if (rawTarget.closest('[data-basic-view-allow="true"]')) {
        return
      }

      const interactive = rawTarget.closest('button, input, select, textarea, [role="button"], a, label, [contenteditable="true"]')
      if (!interactive) {
        return
      }

      if (interactive.tagName.toLowerCase() === 'a' && !isDownloadAnchor(interactive)) {
        const href = (interactive.getAttribute('href') ?? '').trim().toLowerCase()
        const isRouteNavigation = href.startsWith('/') || href.startsWith('#') || href === ''
        if (isRouteNavigation) {
          return
        }
      }

      event.preventDefault()
      event.stopPropagation()
      notifyBlockedAction()
    }

    const onSubmitCapture = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      notifyBlockedAction()
    }

    window.addEventListener('click', onClickCapture, true)
    window.addEventListener('submit', onSubmitCapture, true)

    return () => {
      window.removeEventListener('click', onClickCapture, true)
      window.removeEventListener('submit', onSubmitCapture, true)
    }
  }, [isBasicViewModeEnabled, setAppError])

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
        {isBasicViewModeEnabled ? (
          <div className="mx-6 mt-4 rounded-lg border border-rose-300 bg-rose-100 px-4 py-3 text-sm text-rose-900 md:mx-8">
            <strong className="font-semibold">Modo vista basica activo:</strong>{' '}
            solo lectura para este usuario (sin acciones ni descargas).
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
