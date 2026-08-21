import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { checklistItemKeys } from '../../../types/domain'
import type { ChecklistItemStatus, HandoverChecklistType } from '../../../types/domain'
import {
  buildHandoverChecklistView,
  checklistItemLabels,
  computeCompliance,
  createEmptyHandoverChecklistFormData,
  toHandoverChecklistFormData,
  toHandoverChecklistPayload,
  validateHandoverChecklistFormData,
} from '../services/handoverChecklistsService'
import type { HandoverChecklistFormData, HandoverChecklistFormErrors, HandoverChecklistFormField } from '../types'

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const typeLabels: Record<HandoverChecklistType, string> = { DELIVERY: 'Entrega', RETURN: 'Devolución' }

const statusOptions: { value: ChecklistItemStatus; label: string; className: string }[] = [
  { value: 'OK', label: 'OK', className: 'border-emerald-300 bg-emerald-50 text-emerald-700' },
  { value: 'REGULAR', label: 'Regular', className: 'border-amber-300 bg-amber-50 text-amber-700' },
  { value: 'MALO', label: 'Malo', className: 'border-rose-300 bg-rose-50 text-rose-700' },
]

const semaforoClassName: Record<'VERDE' | 'AMARILLO' | 'ROJO', string> = {
  VERDE: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  AMARILLO: 'border-amber-200 bg-amber-50 text-amber-700',
  ROJO: 'border-rose-200 bg-rose-50 text-rose-700',
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })

const formatDateTime = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString('es-AR')
}

export const HandoverChecklistsPage = () => {
  const {
    state: { fleetUnits, clients, contracts, handoverChecklists },
    actions: { setHandoverChecklists, setAppError },
  } = useAppContext()

  const [formData, setFormData] = useState<HandoverChecklistFormData>(createEmptyHandoverChecklistFormData)
  const [errors, setErrors] = useState<HandoverChecklistFormErrors>({})
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingPhotos, setIsUploadingPhotos] = useState(false)
  const [isUploadingAct, setIsUploadingAct] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const view = useMemo(() => buildHandoverChecklistView(handoverChecklists, fleetUnits), [handoverChecklists, fleetUnits])

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return fleetUnits.slice(0, 8)
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)
  const unitContracts = contracts.filter((contract) => contract.unitId === formData.unitId)
  const preview = computeCompliance(formData.checklist)

  const handleFieldChange = <TField extends HandoverChecklistFormField>(
    field: TField,
    value: HandoverChecklistFormData[TField],
  ) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const setItemStatus = (key: (typeof checklistItemKeys)[number], status: ChecklistItemStatus) => {
    setFormData((previous) => ({
      ...previous,
      checklist: { ...previous.checklist, [key]: { ...previous.checklist[key], status } },
    }))
  }

  const setItemNotes = (key: (typeof checklistItemKeys)[number], notes: string) => {
    setFormData((previous) => ({
      ...previous,
      checklist: { ...previous.checklist, [key]: { ...previous.checklist[key], notes } },
    }))
  }

  const resetForm = () => {
    setEditingId(null)
    setErrors({})
    setFormData(createEmptyHandoverChecklistFormData())
  }

  const handlePhotosSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setIsUploadingPhotos(true)
    try {
      const uploadedUrls: string[] = []
      for (const file of Array.from(files)) {
        const dataUrl = await readFileAsDataUrl(file)
        const response = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: { fileName: file.name, contentType: file.type || 'application/octet-stream', dataUrl, folder: 'handover-checklists' },
        })
        uploadedUrls.push(response.url)
      }
      handleFieldChange('photoUrls', [...formData.photoUrls, ...uploadedUrls])
    } catch {
      setAppError('No se pudieron subir una o más fotos.')
    } finally {
      setIsUploadingPhotos(false)
    }
  }

  const handleActSelected = async (file: File | null) => {
    if (!file) return
    setIsUploadingAct(true)
    try {
      const dataUrl = await readFileAsDataUrl(file)
      const response = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: { fileName: file.name, contentType: file.type || 'application/octet-stream', dataUrl, folder: 'handover-checklists' },
      })
      handleFieldChange('signedActUrl', response.url)
    } catch {
      setAppError('No se pudo subir el acta firmada.')
    } finally {
      setIsUploadingAct(false)
    }
  }

  const handleSubmit = async () => {
    const validationErrors = validateHandoverChecklistFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      const payload = toHandoverChecklistPayload(formData)
      if (editingId) {
        const updated = await apiRequest(`/handover-checklists/${editingId}`, { method: 'PATCH', body: payload })
        setHandoverChecklists(handoverChecklists.map((item) => (item.id === editingId ? (updated as any) : item)))
      } else {
        const created = await apiRequest('/handover-checklists', { method: 'POST', body: payload })
        setHandoverChecklists([created as any, ...handoverChecklists])
      }
      resetForm()
    } catch {
      setAppError('No se pudo guardar el checklist.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (id: string) => {
    const item = handoverChecklists.find((entry) => entry.id === id)
    if (!item) return
    setEditingId(id)
    setFormData(toHandoverChecklistFormData(item))
  }

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return
    const idToDelete = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await apiRequest(`/handover-checklists/${idToDelete}`, { method: 'DELETE' })
      setHandoverChecklists(handoverChecklists.filter((item) => item.id !== idToDelete))
      if (editingId === idToDelete) resetForm()
    } catch {
      setAppError('No se pudo eliminar el checklist.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Checklist de entrega / devolución</h2>
        <p className="text-sm text-slate-600">
          Estado del equipo al entregarlo o devolverlo: documentación, luces, cubiertas, frenos, cabina, carrocería,
          accesorios y kit de seguridad, con fotos y acta firmada.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="xl:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Editar checklist' : 'Nuevo checklist'}</h3>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div className="flex gap-2">
              {(['DELIVERY', 'RETURN'] as HandoverChecklistType[]).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleFieldChange('type', type)}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold ${
                    formData.type === type
                      ? 'border-amber-400 bg-amber-100 text-amber-900'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {typeLabels[type]}
                </button>
              ))}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Unidad</label>
              {selectedUnit ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span>
                    {selectedUnit.internalCode} - {selectedUnit.brand} {selectedUnit.model}
                  </span>
                  <button type="button" onClick={() => handleFieldChange('unitId', '')} className="font-semibold text-amber-700 hover:underline">
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={`${inputClassName} mt-1`}
                    value={unitSearch}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder="Buscar por dominio, marca o modelo..."
                  />
                  <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                    {filteredUnits.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => handleFieldChange('unitId', unit.id)}
                        className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {unit.internalCode} - {unit.brand} {unit.model}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {errors.unitId ? <p className="mt-1 text-xs text-rose-600">{errors.unitId}</p> : null}
            </div>

            {unitContracts.length > 0 ? (
              <div>
                <label className="text-sm font-semibold text-slate-700">Contrato (opcional)</label>
                <select
                  className={`${inputClassName} mt-1`}
                  value={formData.contractId}
                  onChange={(event) => handleFieldChange('contractId', event.target.value)}
                >
                  <option value="">Sin vincular</option>
                  {unitContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.code || contract.id.slice(0, 8)} - {contract.clientName}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}

            <div>
              <label className="text-sm font-semibold text-slate-700">Cliente</label>
              <select
                className={`${inputClassName} mt-1`}
                value={formData.clientId}
                onChange={(event) => {
                  const clientId = event.target.value
                  const client = clients.find((item) => item.id === clientId)
                  handleFieldChange('clientId', clientId)
                  if (client) handleFieldChange('clientName', client.name)
                }}
              >
                <option value="">Sin cliente registrado</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <input
                className={`${inputClassName} mt-2`}
                value={formData.clientName}
                onChange={(event) => handleFieldChange('clientName', event.target.value)}
                placeholder="Nombre del cliente (o corregilo)"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Responsable</label>
              <input
                className={`${inputClassName} mt-1`}
                value={formData.responsibleName}
                onChange={(event) => handleFieldChange('responsibleName', event.target.value)}
                placeholder="Quién hizo el checklist"
              />
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Fecha y hora</label>
              <input
                type="datetime-local"
                className={`${inputClassName} mt-1`}
                value={formData.performedAt}
                onChange={(event) => handleFieldChange('performedAt', event.target.value)}
              />
              {errors.performedAt ? <p className="mt-1 text-xs text-rose-600">{errors.performedAt}</p> : null}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-xs font-semibold text-slate-700">Km</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClassName} mt-1`}
                  value={formData.unitKilometersInput}
                  onChange={(event) => handleFieldChange('unitKilometersInput', event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Horas motor</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClassName} mt-1`}
                  value={formData.engineHoursInput}
                  onChange={(event) => handleFieldChange('engineHoursInput', event.target.value)}
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-700">Combustible %</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClassName} mt-1`}
                  value={formData.fuelLevelPctInput}
                  onChange={(event) => handleFieldChange('fuelLevelPctInput', event.target.value)}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-slate-700">Estado del equipo</label>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${semaforoClassName[preview.semaforo]}`}>
                  {preview.percent}% cumplimiento
                </span>
              </div>
              <div className="mt-2 space-y-2">
                {checklistItemKeys.map((key) => (
                  <div key={key} className="rounded-lg border border-slate-200 p-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">{checklistItemLabels[key]}</span>
                      <div className="flex gap-1">
                        {statusOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => setItemStatus(key, option.value)}
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                              formData.checklist[key]?.status === option.value
                                ? option.className
                                : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {formData.checklist[key]?.status !== 'OK' ? (
                      <input
                        className={`${inputClassName} mt-1.5 text-xs`}
                        value={formData.checklist[key]?.notes ?? ''}
                        onChange={(event) => setItemNotes(key, event.target.value)}
                        placeholder="Detalle (opcional)"
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            </div>

            {formData.type === 'RETURN' ? (
              <div className="space-y-3 rounded-lg border border-rose-200 bg-rose-50/40 p-3">
                <div>
                  <label className="text-sm font-semibold text-slate-700">Daños detectados</label>
                  <textarea
                    className={`${inputClassName} mt-1`}
                    rows={2}
                    value={formData.damagesFound}
                    onChange={(event) => handleFieldChange('damagesFound', event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-slate-700">Cargo al cliente (USD)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className={`${inputClassName} mt-1`}
                    value={formData.chargeToClientUsdInput}
                    onChange={(event) => handleFieldChange('chargeToClientUsdInput', event.target.value)}
                    placeholder="0.00"
                  />
                </div>
              </div>
            ) : null}

            <div>
              <label className="text-sm font-semibold text-slate-700">Fotos</label>
              <input
                type="file"
                accept="image/*"
                multiple
                className={`${inputClassName} mt-1`}
                onChange={(event) => void handlePhotosSelected(event.target.files)}
              />
              {isUploadingPhotos ? <p className="mt-1 text-xs text-slate-500">Subiendo fotos...</p> : null}
              {formData.photoUrls.length > 0 ? (
                <p className="mt-1 text-xs text-emerald-700">{formData.photoUrls.length} foto(s) adjuntas.</p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Acta firmada (opcional)</label>
              <input
                type="file"
                accept="image/*,application/pdf"
                className={`${inputClassName} mt-1`}
                onChange={(event) => void handleActSelected(event.target.files?.[0] ?? null)}
              />
              {isUploadingAct ? <p className="mt-1 text-xs text-slate-500">Subiendo acta...</p> : null}
              {formData.signedActUrl ? <p className="mt-1 text-xs text-emerald-700">Acta adjunta.</p> : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Observaciones</label>
              <textarea
                className={`${inputClassName} mt-1`}
                rows={2}
                value={formData.observations}
                onChange={(event) => handleFieldChange('observations', event.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              {editingId ? (
                <button type="button" onClick={resetForm} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100">
                  Cancelar
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSaving || isUploadingPhotos || isUploadingAct}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
              >
                {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear checklist'}
              </button>
            </div>
          </form>
        </article>

        <div className="xl:col-span-2 space-y-3">
          {view.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Todavía no hay checklists cargados.
            </div>
          ) : (
            view.map((item) => (
              <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      {typeLabels[item.type]} · {item.code || item.id.slice(0, 8)}
                    </p>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900">{item.unitLabel}</h3>
                    <p className="text-xs text-slate-500">{item.clientName || 'Sin cliente'} · {formatDateTime(item.performedAt)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${semaforoClassName[item.semaforo]}`}>
                    {item.compliancePercent}% cumplimiento
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <p>Km: {item.unitKilometers}</p>
                  <p>Horas motor: {item.engineHours}</p>
                  <p>Combustible: {item.fuelLevelPct}%</p>
                  <p>Responsable: {item.responsibleName || '-'}</p>
                </div>

                {item.type === 'RETURN' && item.damagesFound ? (
                  <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                    Daños: {item.damagesFound}
                    {item.chargeToClientUsd > 0 ? ` · Cargo: USD ${item.chargeToClientUsd}` : ''}
                  </p>
                ) : null}

                {item.photoUrls.length > 0 || item.signedActUrl ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {item.photoUrls.map((url, index) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
                      >
                        Foto {index + 1}
                      </a>
                    ))}
                    {item.signedActUrl ? (
                      <a
                        href={item.signedActUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        Acta firmada
                      </a>
                    ) : null}
                  </div>
                ) : null}

                {item.observations ? <p className="mt-2 text-xs text-slate-600">{item.observations}</p> : null}

                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(item.id)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => setPendingDeleteId(item.id)}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        title="Eliminar checklist"
        message="¿Eliminar este checklist? Esta acción no se puede deshacer."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
