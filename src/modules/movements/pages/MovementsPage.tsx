import { useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { FleetMovement } from '../../../types/domain'
import {
  applyParsedPayload,
  createEmptyMovementFormData,
  expandMovementUnitIdsWithAssociations,
  formatMovementDateForView,
  normalizeRemitoDateInput,
  validateMovementFormData,
  type MovementFormData,
} from '../services/movementsService'
import { exportMovementPdf } from '../services/movementPdfService'

type NextRemitoResponse = {
  remitoNumber: string
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })

export const MovementsPage = () => {
  const {
    state: { fleetUnits, movements, featureFlags, currentUser },
    actions: { setMovements, setAppError },
  } = useAppContext()
  const [formData, setFormData] = useState<MovementFormData>(createEmptyMovementFormData())
  const [errors, setErrors] = useState<Partial<Record<keyof MovementFormData, string>>>({})
  const [isParsing, setIsParsing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [nextRemitoNumber, setNextRemitoNumber] = useState('')
  const [editingMovementId, setEditingMovementId] = useState<string | null>(null)

  const unitsOptions = useMemo(
    () =>
      fleetUnits.map((unit) => ({
        id: unit.id,
        label: `${unit.internalCode} - ${unit.ownerCompany}`,
        searchText: `${unit.internalCode} ${unit.ownerCompany} ${unit.clientName} ${unit.brand} ${unit.model}`.toLowerCase(),
      })),
    [fleetUnits],
  )

  const selectedUnitOptions = useMemo(
    () => unitsOptions.filter((unit) => formData.unitIds.includes(unit.id)),
    [formData.unitIds, unitsOptions],
  )

  const filteredUnitOptions = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    const available = unitsOptions.filter((unit) => !formData.unitIds.includes(unit.id))
    if (!query) {
      return []
    }
    return available.filter((unit) => unit.searchText.includes(query)).slice(0, 12)
  }, [unitSearch, unitsOptions, formData.unitIds])

  const canManageMovements = currentUser?.role === 'GERENTE' || currentUser?.role === 'DEV'

  useEffect(() => {
    const loadNextRemito = async () => {
      try {
        const response = await apiRequest<NextRemitoResponse>('/movements/next-remito')
        setNextRemitoNumber(response.remitoNumber)
        setFormData((previous) => ({ ...previous, remitoNumber: response.remitoNumber }))
      } catch {
        // ignore
      }
    }
    void loadNextRemito()
  }, [])

  if (!featureFlags.showMovementsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Entregas y devoluciones</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const handleFieldChange = <K extends keyof MovementFormData>(field: K, value: MovementFormData[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setFormData((previous) => ({
        ...previous,
        pdfFileName: file.name,
        pdfFileBase64: dataUrl,
      }))

      setIsParsing(true)
      const parsed = await apiRequest<Record<string, unknown>>('/movements/parse', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: file.type || 'application/pdf',
          dataUrl,
        },
      })

      setFormData((previous) => applyParsedPayload(previous, parsed ?? {}, fleetUnits))
    } catch {
      setAppError('No se pudo leer el PDF automaticamente. Completa los datos manualmente.')
    } finally {
      setIsParsing(false)
    }
  }

  const handleSubmit = async () => {
    const validationErrors = validateMovementFormData(formData, fleetUnits)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      let pdfUrl = formData.pdfFileUrl
      if (formData.pdfFileBase64 && !pdfUrl) {
        const uploadResponse = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: formData.pdfFileName || `remito-${Date.now()}.pdf`,
            contentType: 'application/pdf',
            dataUrl: formData.pdfFileBase64,
            folder: 'remitos',
          },
        })
        pdfUrl = uploadResponse.url
      }

      const payload = {
        ...formData,
        unitIds: expandMovementUnitIdsWithAssociations(formData.unitIds, fleetUnits),
        remitoDate: normalizeRemitoDateInput(formData.remitoDate),
        pdfFileUrl: pdfUrl,
      }

      if (editingMovementId) {
        const updated = await apiRequest<FleetMovement>(`/movements/${editingMovementId}`, {
          method: 'PATCH',
          body: payload,
        })
        setMovements(movements.map((movement) => (movement.id === editingMovementId ? updated : movement)))
        setEditingMovementId(null)
        setFormData({ ...createEmptyMovementFormData(), remitoNumber: nextRemitoNumber })
      } else {
        const created = await apiRequest<FleetMovement>('/movements', {
          method: 'POST',
          body: payload,
        })

        setMovements([created, ...movements])
        setFormData({ ...createEmptyMovementFormData(), remitoNumber: nextRemitoNumber })
        try {
          const response = await apiRequest<NextRemitoResponse>('/movements/next-remito')
          setNextRemitoNumber(response.remitoNumber)
          setFormData((previous) => ({ ...previous, remitoNumber: response.remitoNumber }))
        } catch {
          // ignore
        }
      }
    } catch {
      setAppError('No se pudo guardar el movimiento. Intenta nuevamente.')
    } finally {
      setIsSaving(false)
    }
  }

  const addUnitId = (unitId: string) => {
    const nextUnitIds = expandMovementUnitIdsWithAssociations([...formData.unitIds, unitId], fleetUnits)
    handleFieldChange('unitIds', nextUnitIds)
  }

  const removeUnitId = (unitId: string) => {
    handleFieldChange(
      'unitIds',
      formData.unitIds.filter((id) => id !== unitId),
    )
  }

  const handleExportMovementPdf = async (movementId: string) => {
    const movement = movements.find((item) => item.id === movementId)
    if (!movement) {
      setAppError('No se encontro el remito para generar el PDF.')
      return
    }
    try {
      await exportMovementPdf({ movement, units: fleetUnits })
    } catch {
      setAppError('No se pudo generar el PDF del remito.')
    }
  }

  const handleDeleteMovement = async (movementId: string) => {
    if (!canManageMovements) {
      return
    }
    const confirmed = window.confirm('¿Eliminar este remito? Esta acción no se puede deshacer.')
    if (!confirmed) {
      return
    }

    try {
      await apiRequest(`/movements/${movementId}`, { method: 'DELETE' })
      setMovements(movements.filter((movement) => movement.id !== movementId))
    } catch {
      setAppError('No se pudo eliminar el remito.')
    }
  }

  const handleEditMovement = (movementId: string) => {
    if (!canManageMovements) {
      return
    }

    const selected = movements.find((movement) => movement.id === movementId)
    if (!selected) {
      return
    }

    const normalizedDate = normalizeRemitoDateInput(selected.remitoDate ?? '')
    setEditingMovementId(selected.id)
    setFormData({
      unitIds: selected.unitIds ?? [],
      movementType: selected.movementType,
      remitoNumber: selected.remitoNumber ?? '',
      remitoDate: normalizedDate,
      clientName: selected.clientName ?? '',
      workLocation: selected.workLocation ?? '',
      equipmentDescription: selected.equipmentDescription ?? '',
      observations: selected.observations ?? '',
      deliveryContactName: selected.deliveryContactName ?? '',
      deliveryContactDni: selected.deliveryContactDni ?? '',
      deliveryContactSector: selected.deliveryContactSector ?? '',
      deliveryContactRole: selected.deliveryContactRole ?? '',
      receiverContactName: selected.receiverContactName ?? '',
      receiverContactDni: selected.receiverContactDni ?? '',
      receiverContactSector: selected.receiverContactSector ?? '',
      receiverContactRole: selected.receiverContactRole ?? '',
      pdfFileName: selected.pdfFileName ?? '',
      pdfFileBase64: '',
      pdfFileUrl: selected.pdfFileUrl ?? '',
      parsedPayload: selected.parsedPayload,
    })
  }

  return (
    <section className="space-y-6">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Entregas y devoluciones</h2>
        <p className="text-sm text-slate-600">
          Carga los remitos de entrada o devolucion. Se intenta auto-lectura del PDF y luego podes corregir manualmente.
        </p>
      </header>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">{editingMovementId ? 'Editar remito' : 'Nuevo remito'}</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Unidades
            <input
              value={unitSearch}
              onChange={(event) => setUnitSearch(event.target.value)}
              placeholder="Buscar por dominio, cliente, marca, modelo..."
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
              <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                {!unitSearch.trim() ? (
                  <p className="text-xs text-slate-500">Escribi para buscar y agregar unidades.</p>
                ) : filteredUnitOptions.length === 0 ? (
                  <p className="text-xs text-slate-500">Sin resultados.</p>
                ) : (
                <div className="space-y-1">
                  {filteredUnitOptions.map((unit) => (
                    <button
                      key={`${unit.id}-add`}
                      type="button"
                      onClick={() => addUnitId(unit.id)}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-sm text-slate-900 hover:bg-white"
                    >
                      <span>{unit.label}</span>
                      <span className="text-xs font-semibold text-amber-700">Agregar</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <select
              multiple
              value={formData.unitIds}
              onChange={(event) =>
                handleFieldChange(
                  'unitIds',
                  Array.from(event.target.selectedOptions).map((option) => option.value),
                )
              }
              className="hidden"
            >
              {filteredUnitOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
            {selectedUnitOptions.length > 0 ? (
              <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                {selectedUnitOptions.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => removeUnitId(unit.id)}
                    className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    <span>{unit.label}</span>
                    <span className="text-rose-600">x</span>
                  </button>
                ))}
              </div>
            ) : null}
            <span className="text-xs text-slate-500">Selecciona una o mas unidades.</span>
            {errors.unitIds ? <span className="text-xs text-rose-700">{errors.unitIds}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Tipo
            <select
              value={formData.movementType}
              onChange={(event) => handleFieldChange('movementType', event.target.value as MovementFormData['movementType'])}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="ENTRY">ENTREGA</option>
              <option value="RETURN">Devolucion</option>
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Numero de remito
            <input
              value={formData.remitoNumber}
              readOnly
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            <span className="text-xs text-slate-500">Se genera automaticamente al guardar.</span>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Fecha del remito
            <input
              type="date"
              value={formData.remitoDate}
              onChange={(event) => handleFieldChange('remitoDate', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.remitoDate ? <span className="text-xs text-rose-700">{errors.remitoDate}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Cliente
            <input
              value={formData.clientName}
              onChange={(event) => handleFieldChange('clientName', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.clientName ? <span className="text-xs text-rose-700">{errors.clientName}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Lugar de trabajo
            <input
              value={formData.workLocation}
              onChange={(event) => handleFieldChange('workLocation', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.workLocation ? <span className="text-xs text-rose-700">{errors.workLocation}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Equipo / Descripcion
            <textarea
              value={formData.equipmentDescription}
              onChange={(event) => handleFieldChange('equipmentDescription', event.target.value)}
              className="min-h-[90px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Observaciones
            <textarea
              value={formData.observations}
              onChange={(event) => handleFieldChange('observations', event.target.value)}
              className="min-h-[80px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 lg:col-span-2">
            <h4 className="text-sm font-semibold text-slate-800">Entrega (informativo)</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Nombre y apellido
                <input
                  value={formData.deliveryContactName}
                  onChange={(event) => handleFieldChange('deliveryContactName', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                DNI
                <input
                  value={formData.deliveryContactDni}
                  onChange={(event) => handleFieldChange('deliveryContactDni', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Sector
                <input
                  value={formData.deliveryContactSector}
                  onChange={(event) => handleFieldChange('deliveryContactSector', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Cargo
                <input
                  value={formData.deliveryContactRole}
                  onChange={(event) => handleFieldChange('deliveryContactRole', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 lg:col-span-2">
            <h4 className="text-sm font-semibold text-slate-800">Recepcion (informativo)</h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Nombre y apellido
                <input
                  value={formData.receiverContactName}
                  onChange={(event) => handleFieldChange('receiverContactName', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                DNI
                <input
                  value={formData.receiverContactDni}
                  onChange={(event) => handleFieldChange('receiverContactDni', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Sector
                <input
                  value={formData.receiverContactSector}
                  onChange={(event) => handleFieldChange('receiverContactSector', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700">
                Cargo
                <input
                  value={formData.receiverContactRole}
                  onChange={(event) => handleFieldChange('receiverContactRole', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-normal text-slate-900"
                />
              </label>
            </div>
          </div>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Remito (PDF)
            <input type="file" accept="application/pdf" onChange={handleFileSelection} />
            <span className="text-xs text-slate-500">
              {formData.pdfFileName ? `Archivo: ${formData.pdfFileName}` : 'Adjunta el PDF para autoleer datos.'}
            </span>
            {isParsing ? <span className="text-xs text-amber-600">Leyendo PDF...</span> : null}
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-70"
          >
            {isSaving ? 'Guardando...' : editingMovementId ? 'Guardar cambios' : 'Guardar remito'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditingMovementId(null)
              setFormData({ ...createEmptyMovementFormData(), remitoNumber: nextRemitoNumber })
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            {editingMovementId ? 'Cancelar edicion' : 'Limpiar'}
          </button>
        </div>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Historial de remitos</h3>
        {movements.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aun no hay movimientos cargados.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Remito</th>
                  <th className="px-3 py-2">Unidad</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">PDF app</th>
                  <th className="px-3 py-2">PDF</th>
                  {canManageMovements ? <th className="px-3 py-2">Acciones</th> : null}
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const unit = fleetUnits.find((item) => movement.unitIds.includes(item.id))
                  return (
                    <tr key={movement.id} className="border-t border-slate-200">
                      <td className="px-3 py-2">{formatMovementDateForView(movement.remitoDate ?? movement.createdAt)}</td>
                      <td className="px-3 py-2">{movement.remitoNumber || 'Sin numero'}</td>
                      <td className="px-3 py-2">{unit?.internalCode ?? 'Unidad'}</td>
                      <td className="px-3 py-2">{movement.clientName || unit?.clientName || 'Sin cliente'}</td>
                      <td className="px-3 py-2">{movement.movementType === 'ENTRY' ? 'ENTREGA' : 'Devolucion'}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => handleExportMovementPdf(movement.id)}
                          className="text-emerald-700 hover:underline"
                        >
                          Generar PDF
                        </button>
                      </td>
                      <td className="px-3 py-2">
                        {movement.pdfFileUrl ? (
                          <a
                            href={movement.pdfFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-600 hover:underline"
                          >
                            Ver PDF
                          </a>
                        ) : (
                          'Sin adjunto'
                        )}
                      </td>
                      {canManageMovements ? (
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => handleEditMovement(movement.id)}
                            className="mr-3 text-slate-700 hover:underline"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMovement(movement.id)}
                            className="text-rose-700 hover:underline"
                          >
                            Eliminar
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  )
}
