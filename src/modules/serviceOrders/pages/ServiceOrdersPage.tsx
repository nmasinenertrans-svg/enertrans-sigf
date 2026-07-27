import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiRequest } from '../../../services/api/apiClient'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { usePermissions } from '../../../core/auth/usePermissions'
import { buildServiceOrderDetailPath } from '../../../core/routing/routePaths'
import type { ServiceOrder, ServiceOrderStatus } from '../../../types/domain'

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En proceso',
  WAITING_PARTS: 'Esperando repuestos',
  CLOSED: 'Cerrada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  OPEN: 'bg-red-100 text-red-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  WAITING_PARTS: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800',
}

const ORIGIN_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE_CALL: 'Llamada',
  WHATSAPP: 'WhatsApp',
  INTERNAL_INSPECTION: 'Inspección interna',
}

export const ServiceOrdersPage = () => {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const {
    state: { serviceOrders, fleetUnits, clients },
    actions: { setServiceOrders },
  } = useAppContext()

  const [filterStatus, setFilterStatus] = useState<string>('ALL')
  const [filterSearch, setFilterSearch] = useState('')
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [showCreateModal, setShowCreateModal] = useState(false)

  const [form, setForm] = useState({
    unitId: '',
    externalVehicle: '',
    clientId: '',
    clientName: '',
    reportedFault: '',
    claimOrigin: 'EMAIL' as string,
    assignedToName: '',
  })

  const canCreate = can('SERVICE_ORDERS', 'create')

  const filtered = serviceOrders.filter((os) => {
    if (filterStatus !== 'ALL' && os.status !== filterStatus) return false
    const search = filterSearch.toLowerCase()
    if (!search) return true
    return (
      os.code.toLowerCase().includes(search) ||
      os.reportedFault.toLowerCase().includes(search) ||
      os.clientName.toLowerCase().includes(search) ||
      (os.unit?.internalCode ?? '').toLowerCase().includes(search)
    )
  })

  const handleCreate = async () => {
    if (!form.reportedFault.trim()) {
      setCreateError('La falla reportada es requerida.')
      return
    }
    setIsCreating(true)
    setCreateError('')
    try {
      const payload: Record<string, unknown> = {
        reportedFault: form.reportedFault.trim(),
        claimOrigin: form.claimOrigin,
        assignedToName: form.assignedToName.trim(),
      }
      if (form.unitId) payload.unitId = form.unitId
      if (form.externalVehicle.trim()) payload.externalVehicle = form.externalVehicle.trim()
      if (form.clientId) payload.clientId = form.clientId
      if (form.clientName.trim()) payload.clientName = form.clientName.trim()

      const created = await apiRequest<ServiceOrder>('/service-orders', { method: 'POST', body: payload })
      setServiceOrders([created, ...serviceOrders])
      setShowCreateModal(false)
      setForm({ unitId: '', externalVehicle: '', clientId: '', clientName: '', reportedFault: '', claimOrigin: 'EMAIL', assignedToName: '' })
      navigate(buildServiceOrderDetailPath(created.id))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error al crear la orden de servicio.'
      setCreateError(msg)
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Órdenes de Servicio</h1>
          <p className="mt-1 text-sm text-slate-400">Seguimiento de solicitudes de servicio y reparación para clientes</p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => { setShowCreateModal(true); setCreateError('') }}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300"
          >
            + Nueva OS
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Buscar por código, falla, cliente o unidad..."
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-400 focus:border-amber-400 focus:outline-none"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
        >
          <option value="ALL">Todos los estados</option>
          <option value="OPEN">Abierta</option>
          <option value="IN_PROGRESS">En proceso</option>
          <option value="WAITING_PARTS">Esperando repuestos</option>
          <option value="CLOSED">Cerrada</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-700 bg-slate-800/50 p-12 text-center">
          <p className="text-slate-400">No hay órdenes de servicio que coincidan con los filtros.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((os) => (
            <div
              key={os.id}
              onClick={() => navigate(buildServiceOrderDetailPath(os.id))}
              className="cursor-pointer rounded-xl border border-slate-700 bg-slate-800/60 p-4 transition-colors hover:border-amber-400/40 hover:bg-slate-800"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-amber-300">{os.code}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLORS[os.status]}`}>
                      {STATUS_LABELS[os.status]}
                    </span>
                    <span className="rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300">
                      {ORIGIN_LABELS[os.claimOrigin] ?? os.claimOrigin}
                    </span>
                  </div>
                  <p className="text-sm text-white">{os.reportedFault}</p>
                  <div className="flex flex-wrap gap-4 text-xs text-slate-400">
                    {os.unit && (
                      <span>Unidad: <span className="font-medium text-slate-300">{os.unit.internalCode} — {os.unit.brand} {os.unit.model}</span></span>
                    )}
                    {!os.unit && os.externalVehicle && (
                      <span>Vehículo externo: <span className="font-medium text-slate-300">{os.externalVehicle}</span></span>
                    )}
                    {os.clientName && (
                      <span>Cliente: <span className="font-medium text-slate-300">{os.clientName}</span></span>
                    )}
                    {os.assignedToName && (
                      <span>Asignado a: <span className="font-medium text-slate-300">{os.assignedToName}</span></span>
                    )}
                  </div>
                </div>
                <div className="text-right text-xs text-slate-400">
                  <p>{new Date(os.createdAt).toLocaleDateString('es-AR')}</p>
                  {os.closedAt && (
                    <p className="text-green-400">Cerrada: {new Date(os.closedAt).toLocaleDateString('es-AR')}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-white">Nueva Orden de Servicio</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Unidad de flota (opcional)</label>
                <select
                  value={form.unitId}
                  onChange={(e) => setForm((f) => ({ ...f, unitId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="">— Sin unidad asignada —</option>
                  {fleetUnits.map((u) => (
                    <option key={u.id} value={u.id}>{u.internalCode} — {u.brand} {u.model}</option>
                  ))}
                </select>
              </div>

              {!form.unitId && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-400">Vehículo externo</label>
                  <input
                    type="text"
                    placeholder="Descripción del vehículo externo"
                    value={form.externalVehicle}
                    onChange={(e) => setForm((f) => ({ ...f, externalVehicle: e.target.value }))}
                    className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Cliente</label>
                <select
                  value={form.clientId}
                  onChange={(e) => {
                    const id = e.target.value
                    const cl = clients.find((c) => c.id === id)
                    setForm((f) => ({ ...f, clientId: id, clientName: cl?.name ?? f.clientName }))
                  }}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="">— Seleccionar cliente —</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {!form.clientId && (
                  <input
                    type="text"
                    placeholder="O escribir nombre de cliente"
                    value={form.clientName}
                    onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
                    className="mt-2 w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                  />
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Origen del reclamo</label>
                <select
                  value={form.claimOrigin}
                  onChange={(e) => setForm((f) => ({ ...f, claimOrigin: e.target.value }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                >
                  <option value="EMAIL">Email</option>
                  <option value="PHONE_CALL">Llamada</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="INTERNAL_INSPECTION">Inspección interna</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Falla reportada *</label>
                <textarea
                  rows={3}
                  placeholder="Describir la falla o solicitud del cliente..."
                  value={form.reportedFault}
                  onChange={(e) => setForm((f) => ({ ...f, reportedFault: e.target.value }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-400">Asignado a</label>
                <input
                  type="text"
                  placeholder="Nombre del responsable"
                  value={form.assignedToName}
                  onChange={(e) => setForm((f) => ({ ...f, assignedToName: e.target.value }))}
                  className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
              </div>

              {createError && (
                <p className="rounded-lg border border-red-700 bg-red-900/30 px-3 py-2 text-sm text-red-400">{createError}</p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={isCreating}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-300 disabled:opacity-50"
              >
                {isCreating ? 'Creando...' : 'Crear OS'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
