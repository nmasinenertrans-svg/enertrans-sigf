import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { enqueueAndSync } from '../../../services/offline/sync'
import { getQueueItems, removeQueueItem } from '../../../services/offline/queue'
import { BackLink } from '../../../components/shared/BackLink'
import { exportExternalRequestPdf, exportPurchaseOrderPdf } from '../services/externalRequestPdfService'
import {
  buildExternalRequestView,
  calculatePartsTotal,
  createEmptyExternalRequestFormData,
  createEmptyPartItemFormData,
  toExternalRequest,
  toExternalRequestFormData,
  validateExternalRequestFormData,
  type ExternalRequestFormData,
  type ExternalRequestFormErrors,
} from '../services/externalRequestsService'
import type { ExternalRequest } from '../../../types/domain'

export const ExternalRequestsPage = () => {
  const { can } = usePermissions()
  const {
    state: { fleetUnits, externalRequests, featureFlags },
    actions: { setExternalRequests, setAppError },
  } = useAppContext()

  const canCreate = can('WORK_ORDERS', 'create')
  const canEdit = can('WORK_ORDERS', 'edit')
  const canDelete = can('WORK_ORDERS', 'delete')

  const [formData, setFormData] = useState<ExternalRequestFormData>(() => createEmptyExternalRequestFormData(''))
  const [errors, setErrors] = useState<ExternalRequestFormErrors>({})
  const [providerFile, setProviderFile] = useState<File | null>(null)
  const [providerFileInputKey, setProviderFileInputKey] = useState(0)
  const [uploadingAttachmentId, setUploadingAttachmentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [unitFilter, setUnitFilter] = useState<string>('ALL')
  const [searchTerm, setSearchTerm] = useState('')
  const [unitSearch, setUnitSearch] = useState('')

  const orderedUnits = useMemo(
    () => [...fleetUnits].sort((left, right) => left.internalCode.localeCompare(right.internalCode, 'es-AR')),
    [fleetUnits],
  )

  const normalizeDomain = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')

  const matchedUnit = useMemo(() => {
    const query = normalizeDomain(unitSearch)
    if (!query) {
      return null
    }
    return orderedUnits.find((unit) => normalizeDomain(unit.internalCode) === query) ?? null
  }, [orderedUnits, unitSearch])

  const requestsView = useMemo(
    () => buildExternalRequestView(externalRequests ?? [], fleetUnits ?? []),
    [externalRequests, fleetUnits],
  )

  const filteredRequests = useMemo(() => {
    const normalized = searchTerm.trim().toLowerCase()
    return requestsView.filter((item) => {
      if (unitFilter !== 'ALL' && item.unitId !== unitFilter) {
        return false
      }
      if (!normalized) {
        return true
      }
      const haystack = [item.code, item.unitLabel, item.description, item.companyName].join(' ').toLowerCase()
      return haystack.includes(normalized)
    })
  }, [requestsView, unitFilter, searchTerm])

  if (!featureFlags.showExternalRequestsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Notas de pedido externo</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const handleFieldChange = <TField extends keyof ExternalRequestFormData>(
    field: TField,
    value: ExternalRequestFormData[TField],
  ) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleUnitSearchChange = (value: string) => {
    setUnitSearch(value)
    const query = normalizeDomain(value)
    if (!query) {
      setFormData((previous) => ({ ...previous, unitId: '' }))
      return
    }
    const exactMatch = orderedUnits.find((unit) => normalizeDomain(unit.internalCode) === query) ?? null
    setFormData((previous) => ({ ...previous, unitId: exactMatch?.id ?? '' }))
    if (exactMatch) {
      setErrors((previous) => ({ ...previous, unitId: undefined }))
    }
  }

  const handlePartRowChange = (
    rowId: string,
    field: 'description' | 'quantityInput' | 'unitPriceInput',
    value: string,
  ) => {
    setFormData((previous) => ({
      ...previous,
      partsItems: previous.partsItems.map((row) => (row.id === rowId ? { ...row, [field]: value } : row)),
    }))
    setErrors((previous) => ({ ...previous, partsItems: undefined }))
  }

  const handleAddPartRow = () => {
    setFormData((previous) => ({
      ...previous,
      partsItems: [...previous.partsItems, createEmptyPartItemFormData()],
    }))
  }

  const handleRemovePartRow = (rowId: string) => {
    setFormData((previous) => {
      const nextRows = previous.partsItems.filter((row) => row.id !== rowId)
      return {
        ...previous,
        partsItems: nextRows.length > 0 ? nextRows : [createEmptyPartItemFormData()],
      }
    })
  }

  const resetForm = () => {
    setFormData(createEmptyExternalRequestFormData(''))
    setErrors({})
    setProviderFile(null)
    setProviderFileInputKey((previous) => previous + 1)
    setUnitSearch('')
    setEditingId(null)
  }

  const handleStartEdit = (request: ExternalRequest) => {
    const unit = fleetUnits.find((item) => item.id === request.unitId)
    setFormData(toExternalRequestFormData(request))
    setUnitSearch(unit?.internalCode ?? '')
    setErrors({})
    setProviderFile(null)
    setProviderFileInputKey((previous) => previous + 1)
    setEditingId(request.id)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleEditSubmit = async () => {
    if (!canEdit || !editingId) return
    const resolvedUnitId = resolveUnitIdFromSearch()
    const draftForValidation = { ...formData, unitId: resolvedUnitId }
    const validationErrors = validateExternalRequestFormData(draftForValidation, fleetUnits)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    const tasks = formData.tasksInput.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
    setIsSaving(true)
    try {
      const updated = await apiRequest<ExternalRequest>(`/external-requests/${editingId}`, {
        method: 'PATCH',
        body: {
          unitId: resolvedUnitId,
          companyName: formData.companyName.trim(),
          description: formData.description.trim(),
          tasks,
          currency: formData.currency,
          partsItems: formData.partsItems
            .map((item) => ({
              description: item.description.trim(),
              quantity: Number(item.quantityInput.replace(',', '.')),
              unitPrice: Number(item.unitPriceInput.replace(/\./g, '').replace(',', '.')),
            }))
            .filter((item) => item.description && item.quantity > 0),
        },
      })
      setExternalRequests(externalRequests.map((item) => (item.id === editingId ? updated : item)))
      resetForm()
    } catch {
      setAppError('No se pudieron guardar los cambios.')
    } finally {
      setIsSaving(false)
    }
  }

  const resolveUnitIdFromSearch = () => {
    const query = normalizeDomain(unitSearch)
    if (!query) {
      return ''
    }
    return orderedUnits.find((unit) => normalizeDomain(unit.internalCode) === query)?.id ?? ''
  }

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
      reader.readAsDataURL(file)
    })

  const handleSubmit = async () => {
    if (!canCreate) {
      return
    }
    const resolvedUnitId = resolveUnitIdFromSearch()
    const draftForValidation = { ...formData, unitId: resolvedUnitId }
    const validationErrors = validateExternalRequestFormData(draftForValidation, fleetUnits)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const unitCode = fleetUnits.find((unit) => unit.id === resolvedUnitId)?.internalCode ?? ''
    let providerFileBase64 = ''
    let providerFileUrl = ''
    let providerFileName = ''

    if (providerFile) {
      providerFileName = providerFile.name
      providerFileBase64 = await readFileAsDataUrl(providerFile)
      providerFileUrl = ''
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        try {
          const response = await apiRequest<{ url: string }>('/files/upload', {
            method: 'POST',
            body: {
              fileName: providerFile.name,
              contentType: providerFile.type || 'application/octet-stream',
              dataUrl: providerFileBase64,
              folder: 'external-requests',
            },
          })
          providerFileUrl = response.url
          providerFileBase64 = ''
        } catch {
          providerFileUrl = ''
        }
      }
    }

    const request = toExternalRequest(
      {
        ...formData,
        unitId: resolvedUnitId,
        providerFileName,
        providerFileBase64,
        providerFileUrl,
      },
      unitCode,
      externalRequests,
    )

    setExternalRequests([request, ...externalRequests])
    enqueueAndSync({
      id: `externalRequest.create.${request.id}`,
      type: 'externalRequest.create',
      payload: request,
      createdAt: new Date().toISOString(),
    })
    resetForm()
  }

  const handleAttachProviderFile = async (request: ExternalRequest, file?: File | null) => {
    if (!file) {
      return
    }
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setAppError('Para adjuntar o reemplazar presupuesto debes tener conexion.')
      return
    }

    setUploadingAttachmentId(request.id)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const upload = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          dataUrl,
          folder: 'external-requests',
        },
      })

      const updated = await apiRequest<ExternalRequest>(`/external-requests/${request.id}`, {
        method: 'PATCH',
        body: {
          providerFileName: file.name,
          providerFileUrl: upload.url,
        },
      })

      setExternalRequests(externalRequests.map((item) => (item.id === request.id ? updated : item)))
      setAppError('Presupuesto adjuntado correctamente.')
    } catch {
      setAppError('No se pudo adjuntar el presupuesto a la NDP.')
    } finally {
      setUploadingAttachmentId(null)
    }
  }

  const handleExport = async (requestId: string) => {
    const request = externalRequests.find((item) => item.id === requestId)
    if (!request) return
    const unit = fleetUnits.find((item) => item.id === request.unitId)
    try {
      await exportExternalRequestPdf({ request, unit })
    } catch {
      setAppError('No se pudo generar la nota de pedido.')
    }
  }

  const handleExportOc = async (requestId: string) => {
    const request = externalRequests.find((item) => item.id === requestId)
    if (!request) return
    const unit = fleetUnits.find((item) => item.id === request.unitId)
    try {
      await exportPurchaseOrderPdf({ request, unit })
    } catch {
      setAppError('No se pudo generar la orden de compra.')
    }
  }

  const handleDelete = async (requestId: string) => {
    if (!canDelete) {
      return
    }

    const confirmed = window.confirm('¿Eliminar esta nota de pedido externo?')
    if (!confirmed) {
      return
    }

    const previous = [...externalRequests]
    setExternalRequests(externalRequests.filter((item) => item.id !== requestId))

    try {
      const queueItems = await getQueueItems()
      const queuedCreate = queueItems.find((item) => {
        if (item.type !== 'externalRequest.create') {
          return false
        }
        const payload = item.payload as { id?: string }
        return payload?.id === requestId
      })

      if (queuedCreate) {
        await removeQueueItem(queuedCreate.id)
        setAppError('Nota eliminada de la cola local.')
        return
      }

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueueAndSync({
          id: `externalRequest.delete.${requestId}`,
          type: 'externalRequest.delete',
          payload: { id: requestId },
          createdAt: new Date().toISOString(),
        })
        setAppError('Nota eliminada localmente. Se sincronizara al recuperar conexion.')
        return
      }

      await apiRequest<void>(`/external-requests/${requestId}`, { method: 'DELETE' })
      setAppError('Nota eliminada correctamente.')
    } catch {
      setExternalRequests(previous)
      setAppError('No se pudo eliminar la nota de pedido.')
    }
  }

  if (fleetUnits.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Notas de pedido externo</h2>
        <p className="mt-2 text-sm text-slate-600">Primero necesitas registrar una unidad en Flota.</p>
        <Link
          to={ROUTE_PATHS.fleet.create}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Crear unidad
        </Link>
      </section>
    )
  }

  const formPartsTotal = calculatePartsTotal(formData.partsItems)

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.workOrders} label="Volver a OT" />
        <h2 className="text-2xl font-bold text-slate-900">Notas de pedido externo</h2>
        <p className="text-sm text-slate-600">Solicitudes a proveedores externos por unidad.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {canCreate || (canEdit && editingId) ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900">
                {editingId ? 'Editar nota' : 'Nueva nota'}
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                {editingId
                  ? 'Modificá los datos de la nota. El código no cambia.'
                  : 'Asocia unidad, repuestos comprados y presupuesto proveedor.'}
              </p>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Unidad
                <input
                  value={unitSearch}
                  onChange={(event) => handleUnitSearchChange(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Escribir dominio (ej: AG216KV)"
                />
                {unitSearch.trim() ? (
                  <span className="text-xs font-normal text-slate-500">
                    {matchedUnit
                      ? `Unidad encontrada: ${matchedUnit.internalCode} - ${matchedUnit.ownerCompany}`
                      : 'Sin coincidencia exacta. Escribe la patente completa (ej: AG216KV).'}
                  </span>
                ) : null}
                {errors.unitId ? <span className="text-xs font-semibold text-rose-700">{errors.unitId}</span> : null}
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Empresa
                <input
                  value={formData.companyName}
                  onChange={(event) => handleFieldChange('companyName', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Empresa proveedor"
                />
                {errors.companyName ? (
                  <span className="text-xs font-semibold text-rose-700">{errors.companyName}</span>
                ) : null}
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Moneda
                <select
                  value={formData.currency}
                  onChange={(event) => handleFieldChange('currency', event.target.value as ExternalRequestFormData['currency'])}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                >
                  <option value="ARS">ARS - Peso argentino</option>
                  <option value="USD">USD - Dolar estadounidense</option>
                </select>
                {errors.currency ? <span className="text-xs font-semibold text-rose-700">{errors.currency}</span> : null}
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Descripcion del pedido
                <textarea
                  rows={3}
                  value={formData.description}
                  onChange={(event) => handleFieldChange('description', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Ej: Reparacion de carroceria, pintura general..."
                />
                {errors.description ? (
                  <span className="text-xs font-semibold text-rose-700">{errors.description}</span>
                ) : null}
              </label>

              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-slate-700">Repuestos comprados</p>
                  <button
                    type="button"
                    onClick={handleAddPartRow}
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Agregar item
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {formData.partsItems.map((row, index) => (
                    <div key={row.id} className="grid grid-cols-12 gap-2">
                      <input
                        className="col-span-6 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900"
                        placeholder={`Descripcion item ${index + 1}`}
                        value={row.description}
                        onChange={(event) => handlePartRowChange(row.id, 'description', event.target.value)}
                      />
                      <input
                        className="col-span-2 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900"
                        placeholder="Cant"
                        value={row.quantityInput}
                        onChange={(event) => handlePartRowChange(row.id, 'quantityInput', event.target.value)}
                      />
                      <input
                        className="col-span-3 rounded-lg border border-slate-300 bg-white px-2 py-2 text-xs text-slate-900"
                        placeholder="P.Unit"
                        value={row.unitPriceInput}
                        onChange={(event) => handlePartRowChange(row.id, 'unitPriceInput', event.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => handleRemovePartRow(row.id)}
                        className="col-span-1 rounded-lg border border-rose-300 bg-rose-50 px-2 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        x
                      </button>
                    </div>
                  ))}
                </div>
                {errors.partsItems ? <p className="mt-2 text-xs font-semibold text-rose-700">{errors.partsItems}</p> : null}
                <p className="mt-3 text-sm font-semibold text-slate-700">
                  Total repuestos: {new Intl.NumberFormat(formData.currency === 'USD' ? 'en-US' : 'es-AR', {
                    style: 'currency',
                    currency: formData.currency,
                  }).format(formPartsTotal)}
                </p>
              </div>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Trabajos solicitados (uno por linea)
                <textarea
                  rows={4}
                  value={formData.tasksInput}
                  onChange={(event) => handleFieldChange('tasksInput', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Revision hidrogrua completa&#10;Pintura lateral&#10;Reparacion de caja"
                />
                {errors.tasksInput ? (
                  <span className="text-xs font-semibold text-rose-700">{errors.tasksInput}</span>
                ) : null}
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Presupuesto / archivo proveedor (opcional)
                <input
                  key={providerFileInputKey}
                  type="file"
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
                  onChange={(event) => setProviderFile(event.target.files?.[0] ?? null)}
                />
                {providerFile ? (
                  <span className="text-xs text-slate-500">Adjunto: {providerFile.name}</span>
                ) : (
                  <span className="text-xs text-amber-700">Sin adjunto: la NDP quedara pendiente para vincular a reparacion.</span>
                )}
              </label>

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {editingId ? 'Cancelar' : 'Limpiar'}
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={editingId ? () => { void handleEditSubmit() } : handleSubmit}
                  className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
                >
                  {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Generar nota'}
                </button>
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear notas de pedido externo.
            </section>
          )}
        </div>

        <div className="xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial de notas</h3>
                <p className="mt-1 text-sm text-slate-600">Registro de pedidos externos enviados.</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px]">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Buscar
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Unidad, codigo, descripcion..."
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Filtrar unidad
                <select
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                >
                  <option value="ALL">Todas</option>
                  {fleetUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.internalCode} - {unit.ownerCompany}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {filteredRequests.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                  No hay notas para el filtro seleccionado.
                </div>
              ) : (
                filteredRequests.map((request) => {
                  const moneyFormatter = new Intl.NumberFormat(request.currency === 'USD' ? 'en-US' : 'es-AR', {
                    style: 'currency',
                    currency: request.currency,
                  })

                  return (
                    <article key={request.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nota externa</p>
                          <h4 className="mt-1 text-base font-bold text-slate-900">{request.code}</h4>
                          <p className="mt-1 text-sm text-slate-600">{request.unitLabel}</p>
                          <p className="mt-1 text-xs font-semibold text-slate-500">{request.companyName}</p>
                        </div>
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                          {new Date(request.createdAt ?? new Date().toISOString()).toLocaleDateString('es-AR')}
                        </span>
                      </div>

                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className={`rounded-full border px-2 py-1 font-semibold ${
                            request.eligibilityStatus === 'READY_FOR_REPAIR'
                              ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border-amber-300 bg-amber-50 text-amber-700'
                          }`}
                        >
                          {request.eligibilityStatus === 'READY_FOR_REPAIR' ? 'Lista para reparacion' : 'Pendiente adjunto'}
                        </span>
                        {request.ocCode ? (
                          <span className="rounded-full border border-teal-300 bg-teal-50 px-2 py-1 font-semibold text-teal-700">
                            OC generada: {request.ocCode}
                          </span>
                        ) : null}
                        {request.linkedRepairId ? (
                          <span className="rounded-full border border-sky-300 bg-sky-50 px-2 py-1 font-semibold text-sky-700">
                            Vinculada a reparacion
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-3 text-sm text-slate-600">{request.description}</p>
                      <ul className="mt-3 flex list-disc flex-col gap-1 pl-5 text-sm text-slate-600">
                        {request.tasks.map((task) => (
                          <li key={`${request.id}-${task}`}>{task}</li>
                        ))}
                      </ul>

                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                        <p className="text-xs font-semibold text-slate-700">Repuestos ({request.partsItems.length} items)</p>
                        <p className="text-sm font-bold text-slate-900">Total: {moneyFormatter.format(request.partsTotal)}</p>
                      </div>

                      {request.providerFileUrl || request.providerFileName ? (
                        <p className="mt-3 text-xs text-slate-500">
                          Adjunto proveedor: {request.providerFileName ?? 'Archivo'}
                        </p>
                      ) : null}

                      <div className="mt-4 flex flex-wrap gap-2">
                        {request.providerFileUrl ? (
                          <a
                            href={request.providerFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Ver adjunto
                          </a>
                        ) : null}

                        <label className="inline-flex cursor-pointer items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                          {uploadingAttachmentId === request.id
                            ? 'Adjuntando...'
                            : request.providerFileUrl
                              ? 'Reemplazar presupuesto'
                              : 'Adjuntar presupuesto'}
                          <input
                            type="file"
                            className="hidden"
                            disabled={uploadingAttachmentId === request.id}
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              void handleAttachProviderFile(request, file)
                              event.target.value = ''
                            }}
                          />
                        </label>

                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => handleStartEdit(request)}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          >
                            Editar
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => handleExport(request.id)}
                          className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                        >
                          Imprimir NDP
                        </button>
                        {request.ocCode ? (
                          <button
                            type="button"
                            onClick={() => { void handleExportOc(request.id) }}
                            className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-semibold text-white hover:bg-teal-700"
                          >
                            Imprimir OC
                          </button>
                        ) : null}
                        {canDelete ? (
                          <button
                            type="button"
                            onClick={() => void handleDelete(request.id)}
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            Eliminar
                          </button>
                        ) : null}
                      </div>
                    </article>
                  )
                })
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

