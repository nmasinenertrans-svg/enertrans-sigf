import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import enertransLogoUrl from '../../assets/enertrans-logo.png'
import { setAuthToken } from '../../services/api/apiClient'
import { getQueueItems, type OfflineQueueItem } from '../../services/offline/queue'
import { syncQueue, syncQueueItem } from '../../services/offline/sync'
import { readSyncTelemetry, resetSyncTelemetry, type SyncTelemetrySnapshot } from '../../services/offline/telemetry'
import { useAppContext } from '../hooks/useAppContext'
import { ROUTE_PATHS } from '../routing/routePaths'
import {
  formatNotificationDateTime,
  hydrateReadNotificationsFromServer,
  NOTIFICATIONS_READ_UPDATED_EVENT,
  persistReadNotifications,
  readStoredNotifications,
  type AppNotification,
} from '../notifications/notifications'

interface TopHeaderProps {
  onToggleSidebar: () => void
  syncStatus: {
    isOnline: boolean
    pendingCount: number
    blockedCount: number
    isSyncing: boolean
  }
  notifications: AppNotification[]
}

export const TopHeader = ({ onToggleSidebar, syncStatus, notifications }: TopHeaderProps) => {
  const navigate = useNavigate()
  const {
    state: { currentUser },
    actions: { setCurrentUser, setAppError },
  } = useAppContext()
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(readStoredNotifications)
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isQueueOpen, setIsQueueOpen] = useState(false)
  const [queueItems, setQueueItems] = useState<OfflineQueueItem[]>([])
  const [syncTelemetry, setSyncTelemetry] = useState<SyncTelemetrySnapshot | null>(null)
  const [isQueueLoading, setIsQueueLoading] = useState(false)
  const [showOnlyQueueErrors, setShowOnlyQueueErrors] = useState(false)

  useEffect(() => {
    persistReadNotifications(readNotificationIds)
  }, [readNotificationIds])

  useEffect(() => {
    void hydrateReadNotificationsFromServer()
    const syncReadIds = () => {
      setReadNotificationIds(readStoredNotifications())
    }

    window.addEventListener(NOTIFICATIONS_READ_UPDATED_EVENT, syncReadIds)
    window.addEventListener('storage', syncReadIds)
    return () => {
      window.removeEventListener(NOTIFICATIONS_READ_UPDATED_EVENT, syncReadIds)
      window.removeEventListener('storage', syncReadIds)
    }
  }, [])

  const activeReadNotificationIds = useMemo(() => {
    if (notifications.length === 0) {
      return readNotificationIds
    }
    const validIds = new Set(notifications.map((item) => item.id))
    return readNotificationIds.filter((id) => validIds.has(id))
  }, [notifications, readNotificationIds])

  const statusLabel = syncStatus.isOnline ? 'Online' : 'Offline'
  const statusClass = syncStatus.blockedCount > 0
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : syncStatus.isOnline
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : 'border-rose-200 bg-rose-50 text-rose-700'

  const unreadNotifications = useMemo(
    () => notifications.filter((item) => !activeReadNotificationIds.includes(item.id)),
    [notifications, activeReadNotificationIds],
  )
  const unreadCount = unreadNotifications.length
  const dropdownNotifications = unreadNotifications.slice(0, 8)

  const markAllUnreadNotificationsAsRead = () => {
    if (unreadNotifications.length === 0) {
      return
    }
    setReadNotificationIds((prev) => Array.from(new Set([...prev, ...unreadNotifications.map((item) => item.id)])))
  }

  const notificationBadgeClass = (severity: AppNotification['severity']) => {
    if (severity === 'danger') {
      return 'border-rose-200 bg-rose-50 text-rose-700'
    }
    if (severity === 'warning') {
      return 'border-amber-200 bg-amber-50 text-amber-700'
    }
    return 'border-slate-200 bg-slate-100 text-slate-600'
  }

  const initials = useMemo(() => {
    const name = currentUser?.fullName?.trim() || currentUser?.username || ''
    const parts = name.split(' ').filter(Boolean)
    const letters = parts.slice(0, 2).map((part) => part[0])
    return letters.join('').toUpperCase() || 'U'
  }, [currentUser])

  const loadQueue = async () => {
    setIsQueueLoading(true)
    try {
      const items = await getQueueItems()
      setQueueItems(items)
      setSyncTelemetry(readSyncTelemetry())
    } catch {
      setAppError('No se pudo cargar la cola offline.')
    } finally {
      setIsQueueLoading(false)
    }
  }

  const handleExportQueue = () => {
    const payload = JSON.stringify(queueItems, null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `enertrans-offline-queue-${new Date().toISOString()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const handleExportSyncTelemetry = () => {
    const payload = JSON.stringify(readSyncTelemetry(), null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `enertrans-sync-telemetry-${new Date().toISOString()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const queueErrorCount = useMemo(
    () => queueItems.filter((item) => Boolean(item.lastError)).length,
    [queueItems],
  )
  const visibleQueueItems = useMemo(
    () => (showOnlyQueueErrors ? queueItems.filter((item) => Boolean(item.lastError)) : queueItems),
    [queueItems, showOnlyQueueErrors],
  )

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-amber-300/80 bg-amber-300 px-3 py-2 shadow-sm md:h-20 md:flex-nowrap md:gap-3 md:px-8">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          data-basic-view-allow="true"
          className="rounded-lg border border-slate-900/20 bg-white/60 p-2 text-slate-700 transition hover:bg-white"
          aria-label="Abrir menu"
        >
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <img src={enertransLogoUrl} alt="Enertrans" className="h-7 w-auto md:h-10" />
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-700 md:text-xs">ENERTRANS</p>
          <p className="truncate text-sm font-bold text-slate-900 md:text-lg">Sistema Integral de Gestion de Flota</p>
        </div>
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2 md:ml-0 md:gap-3">
        <div className={`rounded-full border px-2 py-1 text-[10px] font-semibold md:px-3 md:text-xs ${statusClass}`}>
          {statusLabel}
          {syncStatus.isSyncing ? <span className="hidden sm:inline"> • Sincronizando</span> : null}
          {syncStatus.pendingCount > 0 ? (
            <span className="hidden sm:inline">{` • Pendientes: ${syncStatus.pendingCount}`}</span>
          ) : null}
          {syncStatus.blockedCount > 0 ? (
            <span className="hidden sm:inline">{` • Bloqueados: ${syncStatus.blockedCount}`}</span>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() =>
              setIsNotificationsOpen((prev) => {
                if (prev) {
                  markAllUnreadNotificationsAsRead()
                }
                return !prev
              })
            }
            className="relative rounded-lg border border-slate-900/20 bg-white/70 p-2 text-slate-700 transition hover:bg-white"
            aria-label="Notificaciones"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 17h5l-1.4-1.4a2 2 0 0 1-.6-1.4V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
              <path d="M9 17a3 3 0 0 0 6 0" />
            </svg>
            {unreadCount > 0 ? (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                {unreadCount}
              </span>
            ) : null}
          </button>

          {isNotificationsOpen ? (
            <div className="fixed left-3 right-3 top-16 z-50 rounded-xl border border-slate-200 bg-white p-4 shadow-xl md:absolute md:left-auto md:right-0 md:top-auto md:mt-3 md:w-80">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">Notificaciones</p>
                <div className="flex items-center gap-2">
                  {unreadCount > 0 ? (
                    <button
                      type="button"
                      onClick={() =>
                        setReadNotificationIds((prev) =>
                          Array.from(new Set([...prev, ...notifications.map((item) => item.id)])),
                        )
                      }
                      className="text-xs font-semibold text-amber-600 hover:text-amber-700"
                    >
                      Marcar todo leido
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      markAllUnreadNotificationsAsRead()
                      setIsNotificationsOpen(false)
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-700"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="mt-3 max-h-[55vh] space-y-2 overflow-auto md:max-h-[380px]">
                {unreadNotifications.length === 0 ? (
                  <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    No hay alertas pendientes.
                  </p>
                ) : (
                  dropdownNotifications.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                    onClick={() => {
                      setReadNotificationIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
                        if (item.target) {
                          navigate(item.target)
                          setIsNotificationsOpen(false)
                        }
                      }}
                      className="w-full rounded-lg border border-slate-200 px-3 py-2 text-left transition hover:border-amber-300 hover:bg-amber-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{item.title}</p>
                          <p className="text-xs text-slate-600">{item.description}</p>
                          <p className="mt-1 text-[11px] text-slate-500">{formatNotificationDateTime(item.createdAt)}</p>
                        </div>
                        <span
                          className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${notificationBadgeClass(
                            item.severity,
                          )}`}
                        >
                          {item.severity === 'danger' ? 'Urgente' : item.severity === 'warning' ? 'Atencion' : 'Info'}
                        </span>
                      </div>
                    </button>
                  ))
                )}
              </div>
              {notifications.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <p>
                    Mostrando {Math.min(8, unreadNotifications.length)} de {unreadNotifications.length} no leidas
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      navigate(ROUTE_PATHS.notifications)
                      setIsNotificationsOpen(false)
                    }}
                    className="font-semibold text-amber-600 hover:text-amber-700"
                  >
                    Ver todas
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            className="flex items-center gap-2 rounded-lg border border-slate-900/10 bg-white/50 px-2 py-2 text-left backdrop-blur md:gap-3 md:px-3"
          >
            {currentUser?.avatarUrl ? (
              <img src={currentUser.avatarUrl} alt={currentUser.fullName} className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">
                {initials}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Usuario</p>
              <p className="max-w-[140px] truncate text-sm font-bold text-slate-900 md:max-w-none">
                {currentUser?.fullName ?? 'Sin usuario'}
              </p>
              <p className="text-xs font-semibold text-slate-600">{currentUser?.role ?? ''}</p>
            </div>
            <svg className="h-4 w-4 text-slate-500" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.06l3.71-3.83a.75.75 0 0 1 1.08 1.04l-4.25 4.38a.75.75 0 0 1-1.08 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>

          {isUserMenuOpen ? (
            <div className="absolute right-0 mt-3 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-xl">
              <button
                type="button"
                onClick={() => {
                  navigate(ROUTE_PATHS.profile)
                  setIsUserMenuOpen(false)
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Perfil
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (typeof navigator !== 'undefined' && !navigator.onLine) {
                    setAppError('No hay conexion para sincronizar.')
                    setIsUserMenuOpen(false)
                    return
                  }
                  await syncQueue()
                  setAppError('Sincronizacion iniciada.')
                  setIsUserMenuOpen(false)
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Sincronizar pendientes
              </button>
              {currentUser?.role === 'DEV' ? (
                <button
                  type="button"
                  onClick={async () => {
                    await loadQueue()
                    setIsQueueOpen(true)
                    setIsUserMenuOpen(false)
                  }}
                  className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Ver pendientes (cola)
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  setAuthToken(null)
                  setCurrentUser(null)
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                Cerrar sesion
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {isQueueOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Cola offline</p>
                <h3 className="text-lg font-bold text-slate-900">Pendientes de sincronizacion</h3>
                <p className="text-sm text-slate-600">
                  {isQueueLoading ? 'Cargando...' : `${queueItems.length} item(s) en cola • ${queueErrorCount} con error`}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setShowOnlyQueueErrors((prev) => !prev)}
                  className={[
                    'rounded-lg border px-3 py-2 text-xs font-semibold',
                    showOnlyQueueErrors
                      ? 'border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100',
                  ].join(' ')}
                >
                  {showOnlyQueueErrors ? 'Mostrar todo' : 'Solo con error'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await syncQueue()
                    await loadQueue()
                    setAppError('Reintento de sincronizacion completado.')
                  }}
                  className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                >
                  Reintentar sync
                </button>
                <button
                  type="button"
                  onClick={handleExportQueue}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Exportar JSON
                </button>
                <button
                  type="button"
                  onClick={() => setIsQueueOpen(false)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {syncTelemetry ? (
                <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-[11px] text-slate-700">
                  <p className="font-semibold text-sky-800">Telemetria sync (local)</p>
                  <p className="mt-1">
                    Encolados: {syncTelemetry.totals.enqueued} | Exito: {syncTelemetry.totals.success} | Fallos:{' '}
                    {syncTelemetry.totals.failure} | Descartados: {syncTelemetry.totals.dropped}
                  </p>
                  <p>
                    Bloqueados: {syncTelemetry.totals.blocked} | Omitidos por bloqueo:{' '}
                    {syncTelemetry.totals.skippedBlocked} | Desbloqueo manual: {syncTelemetry.totals.manualUnblocked}
                  </p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Ultima actualizacion: {new Date(syncTelemetry.updatedAt).toLocaleString()}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleExportSyncTelemetry}
                  className="rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50"
                >
                  Exportar telemetria
                </button>
                <button
                  type="button"
                  onClick={() => {
                    resetSyncTelemetry()
                    setSyncTelemetry(readSyncTelemetry())
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Reset telemetria
                </button>
              </div>

              {visibleQueueItems.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  {showOnlyQueueErrors ? 'No hay elementos con error.' : 'No hay elementos pendientes.'}
                </div>
              ) : (
                visibleQueueItems.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-semibold">{item.type}</p>
                        <p className="text-[11px] text-slate-500">{item.id}</p>
                        <p className="text-[11px] text-slate-500">
                          Intentos: <span className="font-semibold text-slate-700">{item.attemptCount ?? 0}</span>
                        </p>
                        {item.blocked ? (
                          <p className="mt-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                            Estado: bloqueado por reintentos
                          </p>
                        ) : null}
                        {item.lastAttemptAt ? (
                          <p className="text-[11px] text-slate-500">
                            Ultimo intento: {new Date(item.lastAttemptAt).toLocaleString()}
                          </p>
                        ) : null}
                        {item.lastError ? (
                          <p className="mt-1 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
                            Error: {item.lastError}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-600">
                          {new Date(item.createdAt).toLocaleString()}
                        </span>
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await syncQueueItem(item.id)
                              setAppError('Reintento individual completado.')
                            } catch {
                              setAppError('El reintento individual fallo. Revisa el error en la cola.')
                            } finally {
                              await loadQueue()
                            }
                          }}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Reintentar
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </header>
  )
}
