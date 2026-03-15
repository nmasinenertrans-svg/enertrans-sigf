import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { DeliveryOperation, FleetLogisticsStatus, FleetUnit } from '../../../types/domain'

type DeliveryFormState = {
  unitId: string
  operationType: 'DELIVERY' | 'RETURN'
  targetLogisticsStatus: FleetLogisticsStatus
  clientId: string
  summary: string
  reason: string
  effectiveAt: string
}

const nowDateTimeLocal = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
}

const createEmptyForm = (): DeliveryFormState => ({
  unitId: '',
  operationType: 'DELIVERY',
  targetLogisticsStatus: 'PENDING_DELIVERY',
  clientId: '',
  summary: '',
  reason: '',
  effectiveAt: nowDateTimeLocal(),
})

const logisticsLabelMap: Record<FleetLogisticsStatus, string> = {
  AVAILABLE: 'Disponible',
  PENDING_DELIVERY: 'Pendiente de entrega',
  DELIVERED: 'Entregado',
  PENDING_RETURN: 'Pendiente de devolucion',
  RETURNED: 'Devuelto',
}

const targetStatusOptions = (operationType: 'DELIVERY' | 'RETURN'): FleetLogisticsStatus[] =>
  operationType === 'DELIVERY' ? ['PENDING_DELIVERY', 'DELIVERED'] : ['PENDING_RETURN', 'RETURNED']

const formatDateTime = (value?: string) => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

export const DeliveriesPage = () => {
  const { can } = usePermissions()
  const {
    state: { deliveries, fleetUnits, clients, featureFlags },
    actions: { setDeliveries, setFleetUnits, setAppError },
  } = useAppContext()

  const canCreate = can('FLEET', 'create') || can('FLEET', 'edit')
  const [form, setForm] = useState<DeliveryFormState>(createEmptyForm)
  const [search, setSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const selectedUnit = useMemo(
    () => fleetUnits.find((unit) => unit.id === form.unitId) ?? null,
    [fleetUnits, form.unitId],
  )

  const filteredHistory = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return deliveries
    }
    return deliveries.filter((item) => {
      const unitLabel = item.unit?.internalCode ?? fleetUnits.find((unit) => unit.id === item.unitId)?.internalCode ?? ''
      const clientLabel = item.client?.name ?? clients.find((client) => client.id === item.clientId)?.name ?? ''
      const text = [unitLabel, clientLabel, item.summary, item.reason, item.operationType].join(' ').toLowerCase()
      return text.includes(query)
    })
  }, [deliveries, fleetUnits, clients, search])

  if (!featureFlags.showDeliveriesModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Entregas y devoluciones</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const handleOperationTypeChange = (operationType: 'DELIVERY' | 'RETURN') => {
    setForm((prev) => ({
      ...prev,
      operationType,
      targetLogisticsStatus: operationType === 'DELIVERY' ? 'PENDING_DELIVERY' : 'PENDING_RETURN',
    }))
  }

  const handleSubmit = async () => {
    if (!canCreate) {
      return
    }
    if (!form.unitId) {
      setAppError('Debes seleccionar una unidad.')
      return
    }
    if (form.operationType === 'DELIVERY' && !form.clientId && !selectedUnit?.clientId) {
      setAppError('Debes seleccionar un cliente para registrar una entrega.')
      return
    }

    setIsSaving(true)
    try {
      const created = await apiRequest<DeliveryOperation>('/deliveries', {
        method: 'POST',
        body: {
          ...form,
          clientId: form.clientId || null,
          effectiveAt: form.effectiveAt ? new Date(form.effectiveAt).toISOString() : undefined,
        },
      })
      setDeliveries([created, ...deliveries])
      const refreshedFleet = await apiRequest<FleetUnit[]>('/fleet')
      setFleetUnits(refreshedFleet)
      setForm(createEmptyForm())
      setAppError('Operacion de entrega/devolucion registrada correctamente.')
    } catch {
      setAppError('No se pudo registrar la operacion de entrega/devolucion.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Entregas y devoluciones</h2>
        <p className="text-sm text-slate-600">
          Gestion de estados logisticos por unidad para operar con escenarios reales de entrega y devolucion.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">Nueva operacion</h3>
          <form
            className="mt-4 grid grid-cols-1 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.unitId}
              onChange={(event) => setForm((prev) => ({ ...prev, unitId: event.target.value }))}
            >
              <option value="">Seleccionar unidad</option>
              {fleetUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.internalCode} - {unit.ownerCompany}
                </option>
              ))}
            </select>

            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.operationType}
              onChange={(event) => handleOperationTypeChange(event.target.value as 'DELIVERY' | 'RETURN')}
            >
              <option value="DELIVERY">Entrega</option>
              <option value="RETURN">Devolucion</option>
            </select>

            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.targetLogisticsStatus}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  targetLogisticsStatus: event.target.value as FleetLogisticsStatus,
                }))
              }
            >
              {targetStatusOptions(form.operationType).map((status) => (
                <option key={status} value={status}>
                  {logisticsLabelMap[status]}
                </option>
              ))}
            </select>

            <select
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.clientId}
              onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
            >
              <option value="">Sin cambio de cliente</option>
              {clients
                .filter((client) => client.isActive)
                .map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
            </select>

            <input
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Resumen corto"
              value={form.summary}
              onChange={(event) => setForm((prev) => ({ ...prev, summary: event.target.value }))}
            />

            <textarea
              className="min-h-[90px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              placeholder="Motivo / detalle operativo"
              value={form.reason}
              onChange={(event) => setForm((prev) => ({ ...prev, reason: event.target.value }))}
            />

            <input
              type="datetime-local"
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              value={form.effectiveAt}
              onChange={(event) => setForm((prev) => ({ ...prev, effectiveAt: event.target.value }))}
            />

            <button
              type="submit"
              disabled={isSaving || !canCreate}
              className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-60"
            >
              {isSaving ? 'Guardando...' : 'Registrar operacion'}
            </button>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <h3 className="text-lg font-bold text-slate-900">Estado actual de unidad</h3>
          {selectedUnit ? (
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-base font-bold text-slate-900">
                {selectedUnit.internalCode} - {selectedUnit.ownerCompany}
              </p>
              <div className="mt-2 grid grid-cols-1 gap-2 text-sm text-slate-700 md:grid-cols-2">
                <p>
                  <span className="font-semibold">Estado tecnico:</span> {selectedUnit.operationalStatus}
                </p>
                <p>
                  <span className="font-semibold">Estado logistico:</span>{' '}
                  {logisticsLabelMap[selectedUnit.logisticsStatus ?? 'AVAILABLE']}
                </p>
                <p>
                  <span className="font-semibold">Cliente:</span> {selectedUnit.clientName || 'Sin asignar'}
                </p>
                <p>
                  <span className="font-semibold">Ultima actualizacion:</span>{' '}
                  {formatDateTime(selectedUnit.logisticsUpdatedAt)}
                </p>
              </div>
              {selectedUnit.logisticsStatusNote ? (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-semibold">Motivo:</span> {selectedUnit.logisticsStatusNote}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Selecciona una unidad para ver su estado logístico actual.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Historial operativo</h3>
            <p className="text-sm text-slate-600">Eventos de entrega/devolucion aplicados sobre la flota.</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="Buscar en historial..."
          />
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {filteredHistory.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
              No hay operaciones registradas.
            </div>
          ) : (
            filteredHistory.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-slate-900">
                      {item.unit?.internalCode || fleetUnits.find((unit) => unit.id === item.unitId)?.internalCode || 'Unidad'}
                    </p>
                    <p className="text-xs text-slate-600">{item.client?.name || 'Sin cliente'}</p>
                  </div>
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700">
                    {item.operationType === 'DELIVERY' ? 'ENTREGA' : 'DEVOLUCION'}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <p>
                    <span className="font-semibold">Estado objetivo:</span> {logisticsLabelMap[item.targetLogisticsStatus]}
                  </p>
                  <p>
                    <span className="font-semibold">Fecha:</span> {formatDateTime(item.effectiveAt || item.createdAt)}
                  </p>
                  <p>
                    <span className="font-semibold">Usuario:</span> {item.requestedByUserName || 'No registrado'}
                  </p>
                  {item.summary ? (
                    <p>
                      <span className="font-semibold">Resumen:</span> {item.summary}
                    </p>
                  ) : null}
                  {item.reason ? (
                    <p>
                      <span className="font-semibold">Motivo:</span> {item.reason}
                    </p>
                  ) : null}
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  )
}
