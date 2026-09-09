import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  HandoverChecklist,
  Invoice,
  MaintenancePlan,
  RentalContract,
  RepairRecord,
  ServiceOrder,
  Supplier,
  Tire,
  TripRecord,
  UserInboxNotification,
  WorkOrder,
} from '../../types/domain'
import { useAppContext } from '../hooks/useAppContext'
import { useOfflineSync } from '../hooks/useOfflineSync'
import { canUser } from '../auth/permissions'
import { Sidebar } from './Sidebar'
import { TopHeader } from './TopHeader'
import { buildAppNotifications } from '../notifications/notifications'
import { playNotificationChime } from '../notifications/sound'
import { getPushState, isPushSupported, subscribeToPush } from '../../services/push/pushClient'

const SIDEBAR_KEY = 'enertrans.sidebar.open'
const RETRYABLE_SYNC_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504])
const WORK_ORDERS_SYNC_INTERVAL_MS = 45000
// En 4G/campo una senal debil hace que un ciclo entero de sync falle sin que
// haya un problema real -- se avisa recien despues de varios ciclos seguidos
// fallidos, no en el primero, para no bombardear con el cartel de error.
const WORK_ORDERS_ERROR_AFTER_CONSECUTIVE_FAILURES = 3
const NOTIFICATIONS_POLL_INTERVAL_MS = 25000
const PUSH_PROMPT_DISMISSED_KEY_PREFIX = 'enertrans.push.dismissed.'

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

export const AppLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(readSidebarState)
  const [isRouteLoading, setIsRouteLoading] = useState(true)
  const [isPushPromptVisible, setIsPushPromptVisible] = useState(false)
  const [isEnablingPush, setIsEnablingPush] = useState(false)
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
      serviceOrders,
      invoices,
      trips,
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
      setServiceOrders,
      setInvoices,
      setContracts,
      setHandoverChecklists,
      setTires,
      setTrips,
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
  const serviceOrdersRef = useRef(serviceOrders)
  const invoicesRef = useRef(invoices)
  const tripsRef = useRef(trips)
  const featureFlagsRef = useRef(featureFlags)
  const lastSyncErrorAtRef = useRef<Record<string, number>>({})
  const workOrdersRefreshInProgressRef = useRef(false)
  const workOrdersConsecutiveFailuresRef = useRef(0)
  const basicViewBlockedAtRef = useRef(0)
  const lastVisibilityRefreshAtRef = useRef(0)


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
    serviceOrdersRef.current = serviceOrders
  }, [serviceOrders])

  useEffect(() => {
    invoicesRef.current = invoices
  }, [invoices])

  useEffect(() => {
    tripsRef.current = trips
  }, [trips])

  useEffect(() => {
    featureFlagsRef.current = featureFlags
  }, [featureFlags])

  const isBasicViewModeEnabled = featureFlags.basicViewMode && currentUser?.role !== 'DEV'

  const notifications = useMemo(() => {
    return buildAppNotifications({ fleetUnits, audits, workOrders, userNotifications })
  }, [audits, fleetUnits, workOrders, userNotifications])

  const loadRemoteData = useCallback(async (options?: { background?: boolean }) => {
      const isBackground = options?.background ?? false
      const currentUserId = currentUserRef.current?.id ?? null
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

      if (!isBackground) {
        setGlobalLoading(true)
      }
      try {
        const activeFlags = featureFlagsRef.current
        const shouldSyncMaintenance = activeFlags.showMaintenanceModule
        const shouldSyncAudits = activeFlags.showAuditsModule
        const shouldSyncRepairs = activeFlags.showRepairsModule
        const shouldSyncSuppliers = activeFlags.showSuppliersModule
        const shouldSyncExternalRequests = activeFlags.showExternalRequestsModule
        const shouldSyncMovements = activeFlags.showMovementsModule
        const shouldSyncClients = activeFlags.showClientsModule
        const shouldSyncDeliveries = activeFlags.showDeliveriesModule
        const shouldSyncInventory = activeFlags.showInventoryModule
        // /work-orders NO se pide aca: el poller dedicado de abajo (refreshWorkOrders) ya cubre
        // la carga inicial y el refresco periodico. Pedirlo tambien aca duplicaba la carga sobre
        // el endpoint mas pesado del sistema y disparaba el mismo error de sync dos veces.
        const [
          usersResponse,
          fleetResponse,
          maintenanceResponse,
          auditsResponse,
          repairsResponse,
          suppliersResponse,
          externalRequestsResponse,
          movementsResponse,
          clientsResponse,
          deliveriesResponse,
          inventoryResponse,
          userNotificationsResponse,
          serviceOrdersResponse,
          invoicesResponse,
          contractsResponse,
          handoverChecklistsResponse,
          tiresResponse,
          tripsResponse,
        ] = await Promise.all([
          // Datos de negocio: 3 intentos con timeout creciente para sobrevivir un "cold start"
          // del backend (Render lo duerme tras inactividad), y NUNCA en silencio — si de verdad
          // no se puede sincronizar, el usuario tiene que enterarse en vez de ver datos viejos
          // sin saberlo (ver incidente de remitos "perdidos" que en realidad estaban en el
          // servidor pero el fetch fallaba una sola vez y se rendia sin avisar).
          // El listado basico de usuarios (para asignar tareas/choferes a companeros) no
          // depende del permiso de administracion de Usuarios -- el backend ya lo permite a
          // cualquier usuario autenticado, y roles como GERENTE/COORDINADOR no tienen ese
          // permiso pero si necesitan poder asignarle algo a otra persona (ver reporte de
          // Rodrigo: sin esto solo podia asignarse tareas a si mismo).
          safeRequest<AppUser[]>('/users', { maxAttempts: 3, timeoutMs: 20000 }),
          safeRequest<FleetUnit[]>('/fleet', { maxAttempts: 3, timeoutMs: 20000 }),
          shouldSyncMaintenance
            ? safeRequest<MaintenancePlan[]>('/maintenance', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncAudits ? safeRequest<any[]>('/audits', { maxAttempts: 3, timeoutMs: 20000 }) : Promise.resolve(null),
          shouldSyncRepairs
            ? safeRequest<RepairRecord[]>('/repairs', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncSuppliers
            ? safeRequest<Supplier[]>('/suppliers', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncExternalRequests
            ? safeRequest<ExternalRequest[]>('/external-requests', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncMovements
            ? safeRequest<FleetMovement[]>('/movements', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncClients
            ? safeRequest<ClientAccount[]>('/clients', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncDeliveries
            ? safeRequest<DeliveryOperation[]>('/deliveries', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          shouldSyncInventory
            ? safeRequest<InventoryItem[]>('/inventory', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          safeRequest<UserInboxNotification[]>('/notifications', { silent: true, maxAttempts: 2 }),
          canUser(currentUserRef.current ?? null, 'SERVICE_ORDERS', 'view')
            ? safeRequest<ServiceOrder[]>('/service-orders', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          canUser(currentUserRef.current ?? null, 'INVOICES', 'view')
            ? safeRequest<Invoice[]>('/invoices', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          // Contratos: modulo en prueba, solo DEV — el backend rechaza con 403 a
          // cualquier otro rol, asi que ni se pide para no generar error de sync.
          currentUserRef.current?.role === 'DEV'
            ? safeRequest<RentalContract[]>('/contracts', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          currentUserRef.current?.role === 'DEV'
            ? safeRequest<HandoverChecklist[]>('/handover-checklists', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          currentUserRef.current?.role === 'DEV'
            ? safeRequest<Tire[]>('/tires', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
          canUser(currentUserRef.current ?? null, 'TRIPS', 'view')
            ? safeRequest<TripRecord[]>('/trips', { maxAttempts: 3, timeoutMs: 20000 })
            : Promise.resolve(null),
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
          // Users are server-authoritative. Merging with stale local state revives deleted users.
          setUsers(usersResponse)
        }
        if (fleetResponse) {
          const queuedFleetCreates = getQueuedPayloads<FleetUnit>('fleet.create')
          const queuedFleetUpdates = getQueuedPayloads<any>('fleet.update')
          const queuedFleetDeletes = getQueuedPayloads<{ id: string }>('fleet.delete')
          const deletedFleetIds = new Set(
            queuedFleetDeletes
              .map((entry) => (typeof entry?.id === 'string' ? entry.id : ''))
              .filter(Boolean),
          )
          const mergedFleet =
            mergeByIdWithLocal(
              fleetResponse.filter((unit) => !deletedFleetIds.has(unit.id)),
              [],
              queuedFleetCreates.filter((unit) => unit?.id && !deletedFleetIds.has(unit.id)),
            ) ?? fleetResponse
          const queuedById = new Map<string, Partial<FleetUnit>>()
          queuedFleetUpdates.forEach((entry) => {
            const unitId = typeof entry?.id === 'string' ? entry.id : ''
            if (!unitId || deletedFleetIds.has(unitId)) {
              return
            }
            const data =
              entry?.data && typeof entry.data === 'object'
                ? (entry.data as Partial<FleetUnit>)
                : (entry as Partial<FleetUnit>)
            queuedById.set(unitId, data)
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
        if (serviceOrdersResponse) {
          setServiceOrders(mergeByIdWithLocal(serviceOrdersResponse, serviceOrdersRef.current) ?? serviceOrdersResponse)
        }
        if (invoicesResponse) {
          setInvoices(
            mergeByIdWithLocal(invoicesResponse, invoicesRef.current, getQueuedPayloads('invoice.create')) ??
              invoicesResponse,
          )
        }
        if (contractsResponse) {
          setContracts(contractsResponse)
        }
        if (handoverChecklistsResponse) {
          setHandoverChecklists(handoverChecklistsResponse)
        }
        if (tiresResponse) {
          setTires(tiresResponse)
        }
        if (tripsResponse) {
          setTrips(
            mergeByIdWithLocal(tripsResponse, tripsRef.current, getQueuedPayloads('trip.create')) ?? tripsResponse,
          )
        }
      } finally {
        if (!isBackground) {
          setGlobalLoading(false)
        }
        isFetchingRef.current = false
      }
  }, [
    syncStatus.isOnline,
    setFleetUnits,
    setMaintenancePlans,
    setAudits,
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
    setServiceOrders,
    setInvoices,
    setContracts,
    setHandoverChecklists,
    setTires,
    setTrips,
  ])

  useEffect(() => {
    // La app persiste los datos en localStorage: si ya hay algo cargado de una
    // sesion anterior (el caso normal, todos los dias), no tiene sentido tapar
    // la pantalla mientras se actualiza — se ve y se usa lo que ya hay mientras
    // se refresca atras. Solo bloquea la primera vez de verdad (sesion nueva
    // sin nada guardado todavia), que no tendria que mostrar mas que vacio.
    const hasCachedData = fleetUnitsRef.current.length > 0 || usersRef.current.length > 0
    loadRemoteData({ background: hasCachedData })
  }, [currentUser?.id, loadRemoteData])

  // Si el usuario reabre la app (o vuelve a la pestana) despues de que un fetch
  // haya fallado en silencio, esto fuerza un refresco real en vez de dejarlo
  // mirando datos viejos indefinidamente (ver incidente de remitos "perdidos").
  useEffect(() => {
    const handleVisibilityRegain = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      const now = Date.now()
      if (now - lastVisibilityRefreshAtRef.current < 20000) {
        return
      }
      lastVisibilityRefreshAtRef.current = now
      loadRemoteData({ background: true })
    }

    document.addEventListener('visibilitychange', handleVisibilityRegain)
    window.addEventListener('focus', handleVisibilityRegain)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityRegain)
      window.removeEventListener('focus', handleVisibilityRegain)
    }
  }, [loadRemoteData])

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
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          try {
            response = await apiRequest<WorkOrder[]>('/work-orders', { timeoutMs: 22000 + (attempt - 1) * 6000 })
            break
          } catch (error) {
            if (error instanceof ApiRequestError && (error.status === 401 || error.status === 403)) {
              return
            }
            if (attempt >= 4 || !isRetryableSyncError(error)) {
              throw error
            }
            await waitMs(attempt * 1200)
          }
        }

        if (!response) {
          return
        }

        workOrdersConsecutiveFailuresRef.current = 0
        const queueItems = await getQueueItems()
        const queuedWorkOrders = queueItems
          .filter((item) => item.type === 'workOrder.create')
          .map((item) => item.payload as WorkOrder)
        const merged =
          mergeByIdWithLocal(response, workOrdersRef.current, queuedWorkOrders) ??
          response
        setWorkOrders(merged)
      } catch {
        workOrdersConsecutiveFailuresRef.current += 1
        if (workOrdersConsecutiveFailuresRef.current < WORK_ORDERS_ERROR_AFTER_CONSECUTIVE_FAILURES) {
          return
        }
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

  // Antes esto solo se pedia dentro de la carga general (al entrar o al volver
  // a la pestana), asi que una notificacion nueva podia quedar sin verse
  // durante mucho rato con la app abierta. Este polling la trae rapido y hace
  // sonar un aviso cuando aparece algo que no estaba antes.
  useEffect(() => {
    if (!currentUser?.id || !syncStatus.isOnline) {
      return
    }

    let previousIds: Set<string> | null = null

    const pollNotifications = async () => {
      try {
        const response = await apiRequest<UserInboxNotification[]>('/notifications', { timeoutMs: 15000 })
        if (previousIds) {
          const hasNew = response.some((item) => !previousIds!.has(item.id))
          if (hasNew) {
            playNotificationChime()
          }
        }
        previousIds = new Set(response.map((item) => item.id))
        setUserNotifications(response)
      } catch {
        // silencioso: es un polling de fondo, la carga principal ya reintenta y avisa
      }
    }

    void pollNotifications()
    const intervalId = window.setInterval(() => {
      void pollNotifications()
    }, NOTIFICATIONS_POLL_INTERVAL_MS)

    return () => window.clearInterval(intervalId)
  }, [currentUser?.id, syncStatus.isOnline, setUserNotifications])

  // Antes activar el push quedaba escondido atras de un boton en una pagina
  // que nadie visitaba, asi que casi nadie terminaba suscripto. Ahora se
  // ofrece solo (una vez por usuario/dispositivo) apenas entra a la app.
  useEffect(() => {
    if (!currentUser?.id || typeof window === 'undefined' || !isPushSupported()) {
      return
    }
    const dismissKey = `${PUSH_PROMPT_DISMISSED_KEY_PREFIX}${currentUser.id}`
    if (window.localStorage.getItem(dismissKey)) {
      return
    }
    let cancelled = false
    getPushState().then((state) => {
      if (!cancelled && state === 'not-subscribed') {
        setIsPushPromptVisible(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [currentUser?.id])

  const dismissPushPrompt = useCallback(() => {
    if (currentUser?.id && typeof window !== 'undefined') {
      window.localStorage.setItem(`${PUSH_PROMPT_DISMISSED_KEY_PREFIX}${currentUser.id}`, '1')
    }
    setIsPushPromptVisible(false)
  }, [currentUser?.id])

  const handleEnablePushPrompt = useCallback(async () => {
    setIsEnablingPush(true)
    try {
      await subscribeToPush()
    } catch (error) {
      setAppError(error instanceof Error ? error.message : 'No se pudieron activar las notificaciones push.')
    } finally {
      setIsEnablingPush(false)
      dismissPushPrompt()
    }
  }, [dismissPushPrompt, setAppError])

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
        {syncStatus.pendingCount > 0 ? (
          <div className="mx-6 mt-4 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900 md:mx-8">
            {syncStatus.isOnline ? (
              <>
                <strong className="font-semibold">Enviando datos guardados...</strong>{' '}
                Ten{syncStatus.pendingCount === 1 ? 'és' : 'és'} {syncStatus.pendingCount}{' '}
                {syncStatus.pendingCount === 1 ? 'trabajo guardado' : 'trabajos guardados'} en este celular, se
                está{syncStatus.pendingCount === 1 ? '' : 'n'} mandando al servidor.
              </>
            ) : (
              <>
                <strong className="font-semibold">Sin señal:</strong> tenés {syncStatus.pendingCount}{' '}
                {syncStatus.pendingCount === 1 ? 'trabajo guardado' : 'trabajos guardados'} en este celular. Se
                {syncStatus.pendingCount === 1 ? ' va a mandar solo' : 'n van a mandar solos'} apenas tengas señal
                de nuevo — no hace falta que hagas nada, ni que cierres la app.
              </>
            )}
            {syncStatus.blockedCount > 0 ? (
              <p className="mt-1 text-xs text-sky-800">
                Algunos están tardando mas en confirmarse; el sistema va a seguir intentando solo cada par de
                minutos, no se pierden.
              </p>
            ) : null}
          </div>
        ) : null}
        {isPushPromptVisible ? (
          <div className="mx-6 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 md:mx-8">
            <span>Activá las notificaciones para enterarte al toque cuando te asignen algo, aunque tengas la app cerrada.</span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={dismissPushPrompt}
                className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >
                Ahora no
              </button>
              <button
                type="button"
                onClick={() => void handleEnablePushPrompt()}
                disabled={isEnablingPush}
                className="rounded-lg border border-amber-400 bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
              >
                {isEnablingPush ? 'Activando...' : 'Activar notificaciones'}
              </button>
            </div>
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
