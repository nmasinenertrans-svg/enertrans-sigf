import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { DeliveryOperation, FleetLogisticsStatus, FleetUnit } from '../../../types/domain'
import { exportDeliveryOperationPdf } from '../services/deliveryPdfService'

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

const normalizeDomain = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')
const finalStatuses = new Set<FleetLogisticsStatus>(['DELIVERED', 'RETURNED'])

const toDataUrl = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }
      reject(new Error('No se pudo leer el archivo.'))
    }
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })

export const DeliveriesPage = () => {
  const { can } = usePermissions()
  const {
    state: { deliveries, fleetUnits, clients, featureFlags },
    actions: { setDeliveries, setFleetUnits, setAppError },
  } = useAppContext()

  const canCreate = can('FLEET', 'create') || can('FLEET', 'edit')
  const [form, setForm] = useState<DeliveryFormState>(createEmptyForm)
  const [search, setSearch] = useState('')
  const [unitQuery, setUnitQuery] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [uploadingRemitoId, setUploadingRemitoId] = useState<string | null>(null)

  const orderedUnits = useMemo(
    () => [...fleetUnits].sort((left, right) => left.internalCode.localeCompare(right.internalCode, 'es-AR')),
    [fleetUnits],
  )

  const filteredUnits = useMemo(() => {
    const query = normalizeDomain(unitQuery)
    if (!query) {
      return orderedUnits
    }
    return orderedUnits.filter((unit) => normalizeDomain(unit.internalCode).includes(query))
  }, [orderedUnits, unitQuery])

  const selectedUnit = useMemo(() => {
    if (form.unitId) {
      return fleetUnits.find((unit) => unit.id === form.unitId) ?? null
    }
    const query = normalizeDomain(unitQuery)
    if (!query) {
      return null
    }
    return fleetUnits.find((unit) => normalizeDomain(unit.internalCode) === query) ?? null
  }, [fleetUnits, form.unitId, unitQuery])

  const filteredHistory = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return deliveries
    }
    return deliveries.filter((item) => {
      const unitLabel = item.unit?.internalCode ?? fleetUnits.find((unit) => unit.id === item.unitId)?.internalCode ?? ''
      const clientLabel = item.client?.name ?? clients.find((client) => client.id === item.clientId)?.name ?? ''
      const text = [
        unitLabel,
        clientLabel,
        item.summary,
        item.reason,
        item.operationType,
        item.remitoFileName ?? '',
      ]
        .join(' ')
        .toLowerCase()
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
      clientId: operationType === 'DELIVERY' ? prev.clientId : '',
    }))
  }

  const handleUnitQueryChange = (value: string) => {
    setUnitQuery(value)
    const normalized = normalizeDomain(value)
    if (!normalized) {
      setForm((prev) => ({ ...prev, unitId: '' }))
      return
    }
    const exactMatch = orderedUnits.find((unit) => normalizeDomain(unit.internalCode) === normalized)
    if (exactMatch) {
      setForm((prev) => ({ ...prev, unitId: exactMatch.id }))
    }
  }

  const resolveUnitIdForSubmit = (): string => {
    if (form.unitId) {
      return form.unitId
    }
    const normalized = normalizeDomain(unitQuery)
    if (!normalized) {
      return ''
    }
    const exactMatch = orderedUnits.find((unit) => normalizeDomain(unit.internalCode) === normalized)
    return exactMatch?.id ?? ''
  }

  const handleSubmit = async () => {
    if (!canCreate) {
      return
    }

    const resolvedUnitId = resolveUnitIdForSubmit()
    if (!resolvedUnitId) {
      setAppError('Debes seleccionar una unidad por dominio.')
      return
    }

    const unitForSubmit = fleetUnits.find((unit) => unit.id === resolvedUnitId) ?? null
    if (!unitForSubmit) {
      setAppError('La unidad seleccionada no existe en la flota actual.')
      return
    }

    if (form.operationType === 'DELIVERY' && form.targetLogisticsStatus === 'DELIVERED' && !form.clientId && !unitForSubmit.clientId) {
      setAppError('Para marcar como entregado debes indicar cliente destino o mantener uno ya asignado.')
      return
    }

    setIsSaving(true)
    try {
      const created = await apiRequest<DeliveryOperation>('/deliveries', {
        method: 'POST',
        body: {
          ...form,
          unitId: resolvedUnitId,
          clientId: form.operationType === 'DELIVERY' ? form.clientId || null : null,
          effectiveAt: form.effectiveAt ? new Date(form.effectiveAt).toISOString() : undefined,
        },
      })

      setDeliveries([created, ...deliveries])
      const refreshedFleet = await apiRequest<FleetUnit[]>('/fleet')
      setFleetUnits(refreshedFleet)
      setForm(createEmptyForm())
      setUnitQuery('')
      setAppError('Operacion de entrega/devolucion registrada correctamente.')
    } catch (error) {
      setAppError((error as Error)?.message || 'No se pudo registrar la operacion de entrega/devolucion.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleGeneratePdf = async (item: DeliveryOperation) => {
    const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === item.unitId) ?? null
    const client = clients.find((candidate) => candidate.id === item.clientId) ?? null
    try {
      await exportDeliveryOperationPdf({
        operation: item,
        unit,
        client,
      })
    } catch {
      setAppError('No se pudo generar el informe PDF de la operacion.')
    }
  }

  const handleAttachRemito = async (item: DeliveryOperation, file?: File | null) => {
    if (!file) {
      return
    }

    if (!finalStatuses.has(item.targetLogisticsStatus)) {
      setAppError('Solo se puede adjuntar remito en operaciones Entregado o Devuelto.')
      return
    }

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
    if (!isPdf) {
      setAppError('El remito debe ser un archivo PDF.')
      return
    }

    setUploadingRemitoId(item.id)
    try {
      const dataUrl = await toDataUrl(file)
      const upload = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: 'application/pdf',
          dataUrl,
          folder: 'deliveries',
        },
      })

      const updated = await apiRequest<DeliveryOperation>(`/deliveries/${item.id}/remito`, {
        method: 'PATCH',
        body: {
          remitoFileName: file.name,
          remitoFileUrl: upload.url,
        },
      })

      setDeliveries(deliveries.map((entry) => (entry.id === item.id ? updated : entry)))
      setAppError('Remito adjuntado correctamente.')
    } catch {
      setAppError('No se pudo adjuntar el remito de la operacion.')
    } finally {
      setUploadingRemitoId(null)
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Entregas y devoluciones</h2>
        <p className="text-sm text-slate-600">
          Flujo Enertrans: disponible &gt; pendiente de entrega &gt; entregado &gt; pendiente de devolucion &gt; devuelto.
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
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Unidad por dominio</label>
              <input
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                placeholder="Escribir dominio (ej: AG216KV)"
                value={unitQuery}
                onChange={(event) => handleUnitQueryChange(event.target.value)}
              />
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                value={form.unitId}
                onChange={(event) => {
                  const selected = orderedUnits.find((unit) => unit.id === event.target.value) ?? null
                  setForm((prev) => ({ ...prev, unitId: event.target.value }))
                  if (selected) {
                    setUnitQuery(selected.internalCode)
                  }
                }}
              >
                <option value="">Seleccionar unidad</option>
                {filteredUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.internalCode} - {unit.ownerCompany}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">Tip: escribi la patente y selecciona la coincidencia exacta.</p>
            </div>

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

            {form.operationType === 'DELIVERY' ? (
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Cliente destino</label>
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                  value={form.clientId}
                  onChange={(event) => setForm((prev) => ({ ...prev, clientId: event.target.value }))}
                >
                  <option value="">Mantener cliente actual de la unidad</option>
                  {clients
                    .filter((client) => client.isActive)
                    .map((client) => (
                      <option key={client.id} value={client.id}>
                        {client.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-slate-500">
                  Si elegis "Mantener", se conserva el cliente que ya tenga la unidad en el sistema.
                </p>
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                En devolucion no se cambia cliente manualmente: al marcar "Devuelto" la unidad queda sin cliente.
              </p>
            )}

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
                  <span className="font-semibold">Ultima actualizacion:</span> {formatDateTime(selectedUnit.logisticsUpdatedAt)}
                </p>
              </div>
              {selectedUnit.logisticsStatusNote ? (
                <p className="mt-2 text-xs text-slate-600">
                  <span className="font-semibold">Motivo:</span> {selectedUnit.logisticsStatusNote}
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-3 text-sm text-slate-600">Selecciona una unidad por dominio para ver su estado logistico actual.</p>
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
            filteredHistory.map((item) => {
              const canAttachRemito = finalStatuses.has(item.targetLogisticsStatus)
              return (
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
                    <p>
                      <span className="font-semibold">Remito adjunto:</span>{' '}
                      {item.remitoFileUrl ? (
                        <a
                          href={item.remitoFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold text-sky-700 underline"
                        >
                          {item.remitoFileName || 'Ver PDF'}
                        </a>
                      ) : (
                        'Sin adjunto'
                      )}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleGeneratePdf(item)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Generar informe PDF
                    </button>

                    {canAttachRemito ? (
                      <label className="inline-flex cursor-pointer items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                        {uploadingRemitoId === item.id ? 'Adjuntando...' : item.remitoFileUrl ? 'Reemplazar remito' : 'Adjuntar remito'}
                        <input
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          disabled={uploadingRemitoId === item.id}
                          onChange={(event) => {
                            const file = event.target.files?.[0]
                            void handleAttachRemito(item, file)
                            event.target.value = ''
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                </article>
              )
            })
          )}
        </div>
      </section>
    </section>
  )
}
