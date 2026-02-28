import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import {
  buildAppNotifications,
  formatNotificationDateTime,
  NOTIFICATIONS_READ_UPDATED_EVENT,
  persistReadNotifications,
  readStoredNotifications,
} from '../../../core/notifications/notifications'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

type NotificationFilter = 'ALL' | 'UNREAD' | 'DANGER' | 'WARNING' | 'INFO'

export const NotificationsPage = () => {
  const navigate = useNavigate()
  const {
    state: { fleetUnits, audits, workOrders },
  } = useAppContext()

  const notifications = useMemo(
    () => buildAppNotifications({ fleetUnits, audits, workOrders }),
    [fleetUnits, audits, workOrders],
  )
  const [filter, setFilter] = useState<NotificationFilter>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [readNotificationIds, setReadNotificationIds] = useState<string[]>(readStoredNotifications)

  useEffect(() => {
    persistReadNotifications(readNotificationIds)
  }, [readNotificationIds])

  useEffect(() => {
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

  const filteredNotifications = useMemo(() => {
      const query = searchTerm.trim().toLowerCase()
    return notifications.filter((item) => {
      const isRead = activeReadNotificationIds.includes(item.id)
      if (filter === 'UNREAD' && isRead) {
        return false
      }
      if (filter === 'DANGER' && item.severity !== 'danger') {
        return false
      }
      if (filter === 'WARNING' && item.severity !== 'warning') {
        return false
      }
      if (filter === 'INFO' && item.severity !== 'info') {
        return false
      }
      if (!query) {
        return true
      }
      return [item.title, item.description].join(' ').toLowerCase().includes(query)
    })
  }, [notifications, filter, activeReadNotificationIds, searchTerm])

  const unreadCount = useMemo(
    () => notifications.filter((item) => !activeReadNotificationIds.includes(item.id)).length,
    [notifications, activeReadNotificationIds],
  )

  const severityBadgeClass = (severity: 'info' | 'warning' | 'danger') => {
    if (severity === 'danger') {
      return 'border-rose-200 bg-rose-50 text-rose-700'
    }
    if (severity === 'warning') {
      return 'border-amber-200 bg-amber-50 text-amber-700'
    }
    return 'border-slate-200 bg-slate-100 text-slate-600'
  }

  return (
    <section className="space-y-5">
      <header>
        <button
          type="button"
          onClick={() => window.location.assign(ROUTE_PATHS.dashboard)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          <span className="text-base leading-none">{'<-'}</span>
          Volver al inicio
        </button>
        <h2 className="text-2xl font-bold text-slate-900">Notificaciones</h2>
        <p className="text-sm text-slate-600">
          Historial de alertas del sistema. No leidas: <span className="font-semibold">{unreadCount}</span>
        </p>
      </header>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[240px] flex-1 flex-col gap-2 text-sm font-semibold text-slate-700">
            Buscar
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Titulo o descripcion..."
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Filtro
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as NotificationFilter)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="ALL">Todas</option>
              <option value="UNREAD">No leidas</option>
              <option value="DANGER">Urgentes</option>
              <option value="WARNING">Atencion</option>
              <option value="INFO">Info</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => setReadNotificationIds(Array.from(new Set([...readNotificationIds, ...notifications.map((item) => item.id)])))}
            className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
          >
            Marcar todas leidas
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="space-y-3">
          {filteredNotifications.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              No hay notificaciones para el filtro seleccionado.
            </div>
          ) : (
            filteredNotifications.map((item) => {
              const isRead = activeReadNotificationIds.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setReadNotificationIds((prev) => (prev.includes(item.id) ? prev : [...prev, item.id]))
                    if (item.target) {
                      navigate(item.target)
                    }
                  }}
                  className={[
                    'w-full rounded-xl border px-4 py-3 text-left transition',
                    isRead
                      ? 'border-slate-200 bg-white hover:border-slate-300'
                      : 'border-amber-200 bg-amber-50/40 hover:border-amber-300',
                  ].join(' ')}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        {!isRead ? (
                          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            No leida
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{item.description}</p>
                      <p className="mt-2 text-xs text-slate-500">{formatNotificationDateTime(item.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${severityBadgeClass(item.severity)}`}
                      >
                        {item.severity === 'danger' ? 'Urgente' : item.severity === 'warning' ? 'Atencion' : 'Info'}
                      </span>
                    </div>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </section>
    </section>
  )
}
