import { useMemo, useState } from 'react'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { apiRequest } from '../../../services/api/apiClient'
import type { Tire } from '../../../types/domain'
import {
  buildTireView,
  createEmptyTireFormData,
  toTirePayload,
  validateTireFormData,
  wearTypeLabels,
  wearTypeValues,
} from '../services/tiresService'
import type { TireFormData, TireFormErrors, TireFormField } from '../types'
import { wheelLayoutConfigs, wheelLayoutLabels, wheelLayoutValues, type WheelLayout } from '../wheelLayouts'
import { WheelDiagram } from './WheelDiagram'

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const TireDiagramSection = () => {
  const {
    state: { fleetUnits, tires },
    actions: { setTires, setFleetUnits, setAppError },
  } = useAppContext()

  const [unitSearch, setUnitSearch] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [selectedSlotCode, setSelectedSlotCode] = useState<string | null>(null)
  const [formData, setFormData] = useState<TireFormData>(createEmptyTireFormData)
  const [errors, setErrors] = useState<TireFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)

  const view = useMemo(() => buildTireView(tires, fleetUnits), [tires, fleetUnits])

  const selectedUnit = fleetUnits.find((unit) => unit.id === selectedUnitId) ?? null
  const layout = (selectedUnit?.tireWheelLayout || '') as WheelLayout | ''

  const tiresByPosition = useMemo(() => {
    const map = new Map<string, (typeof view)[number]>()
    if (!selectedUnitId) return map
    view
      .filter((tire) => tire.unitId === selectedUnitId && tire.isActive)
      .forEach((tire) => map.set(tire.position, tire))
    return map
  }, [view, selectedUnitId])

  const selectedTire = selectedSlotCode ? tiresByPosition.get(selectedSlotCode) ?? null : null
  const selectedSlotLabel =
    layout && selectedSlotCode ? wheelLayoutConfigs[layout].slots.find((slot) => slot.code === selectedSlotCode)?.label : ''

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return fleetUnits.slice(0, 8)
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const handleSelectUnit = (unitId: string) => {
    setSelectedUnitId(unitId)
    setSelectedSlotCode(null)
    setErrors({})
  }

  const handleSetLayout = async (nextLayout: WheelLayout | '') => {
    if (!selectedUnit) return
    try {
      await apiRequest(`/fleet/${selectedUnit.id}`, { method: 'PATCH', body: { tireWheelLayout: nextLayout } })
      setFleetUnits(fleetUnits.map((unit) => (unit.id === selectedUnit.id ? { ...unit, tireWheelLayout: nextLayout } : unit)))
    } catch {
      setAppError('No se pudo guardar la configuración de ruedas.')
    }
  }

  const handleSelectSlot = (code: string) => {
    setSelectedSlotCode(code)
    setErrors({})
    const existing = tiresByPosition.get(code)
    if (existing) {
      setFormData({
        unitId: existing.unitId,
        position: existing.position,
        brand: existing.brand,
        model: existing.model,
        wearType: existing.wearType,
        installedAt: existing.installedAt ? existing.installedAt.slice(0, 10) : new Date().toISOString().slice(0, 10),
        installedKmInput: String(existing.installedKm ?? ''),
        costBaseInput: existing.costBase ? String(existing.costBase) : '',
        currency: existing.currency,
        notes: existing.notes,
      })
    } else {
      const empty = createEmptyTireFormData()
      setFormData({ ...empty, unitId: selectedUnitId ?? '', position: code })
    }
  }

  const handleFieldChange = <TField extends TireFormField>(field: TField, value: TireFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleSave = async () => {
    const validationErrors = validateTireFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }
    setIsSaving(true)
    try {
      if (selectedTire) {
        const updated = await apiRequest(`/tires/${selectedTire.id}`, { method: 'PATCH', body: toTirePayload(formData) })
        setTires(tires.map((tire) => (tire.id === selectedTire.id ? (updated as Tire) : tire)))
      } else {
        const created = await apiRequest('/tires', { method: 'POST', body: toTirePayload(formData) })
        setTires([created as Tire, ...tires])
      }
    } catch {
      setAppError('No se pudo guardar la cubierta.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMarkRemoved = async () => {
    if (!selectedTire) return
    try {
      const updated = await apiRequest(`/tires/${selectedTire.id}`, {
        method: 'PATCH',
        body: { isActive: false, removedAt: new Date().toISOString() },
      })
      setTires(tires.map((tire) => (tire.id === selectedTire.id ? (updated as Tire) : tire)))
      setSelectedSlotCode(null)
    } catch {
      setAppError('No se pudo dar de baja la cubierta.')
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return
    const idToDelete = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await apiRequest(`/tires/${idToDelete}`, { method: 'DELETE' })
      setTires(tires.filter((tire) => tire.id !== idToDelete))
      setSelectedSlotCode(null)
    } catch {
      setAppError('No se pudo eliminar la cubierta.')
    }
  }

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-bold text-slate-900">Diagrama por unidad</h3>
      <p className="mt-1 text-xs text-slate-500">
        Elegí una unidad, marcá su configuración de ruedas y tocá cada rueda para cargar marca, rodado y estado.
      </p>

      <div className="mt-4">
        {selectedUnit ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <span>
              {selectedUnit.internalCode} - {selectedUnit.brand} {selectedUnit.model}
            </span>
            <button
              type="button"
              onClick={() => {
                setSelectedUnitId(null)
                setSelectedSlotCode(null)
              }}
              className="font-semibold text-amber-700 hover:underline"
            >
              Cambiar unidad
            </button>
          </div>
        ) : (
          <>
            <input
              className={inputClassName}
              value={unitSearch}
              onChange={(event) => setUnitSearch(event.target.value)}
              placeholder="Buscar por dominio, marca o modelo..."
            />
            <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
              {filteredUnits.map((unit) => (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => handleSelectUnit(unit.id)}
                  className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                >
                  {unit.internalCode} - {unit.brand} {unit.model}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {selectedUnit && !layout ? (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-semibold text-slate-700">¿Qué configuración de ruedas tiene esta unidad?</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {wheelLayoutValues.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => void handleSetLayout(option)}
                className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                {wheelLayoutLabels[option]}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {selectedUnit && layout ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-500">{wheelLayoutLabels[layout]}</span>
              <button
                type="button"
                onClick={() => void handleSetLayout('')}
                className="text-xs font-semibold text-slate-500 hover:underline"
              >
                Cambiar configuración
              </button>
            </div>
            <WheelDiagram
              layout={layout}
              tiresByPosition={tiresByPosition}
              selectedCode={selectedSlotCode}
              onSelectSlot={handleSelectSlot}
            />
            <div className="mt-2 flex flex-wrap items-center justify-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-emerald-500" /> OK
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-amber-500" /> Desgaste alto
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-rose-500" /> Para cambio
              </span>
              <span className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full bg-slate-300" /> Sin cargar
              </span>
            </div>
          </div>

          {selectedSlotCode ? (
            <form
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault()
                void handleSave()
              }}
            >
              <p className="text-sm font-semibold text-slate-700">{selectedSlotLabel}</p>
              {errors.unitId || errors.position ? (
                <p className="text-xs text-rose-600">Seleccioná una unidad válida antes de guardar.</p>
              ) : null}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Marca</label>
                  <input className={`${inputClassName} mt-1`} value={formData.brand} onChange={(event) => handleFieldChange('brand', event.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Rodado</label>
                  <input
                    className={`${inputClassName} mt-1`}
                    value={formData.model}
                    onChange={(event) => handleFieldChange('model', event.target.value)}
                    placeholder="Ej: 295/80R22.5"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Tipo de desgaste</label>
                <select
                  className={`${inputClassName} mt-1`}
                  value={formData.wearType}
                  onChange={(event) => handleFieldChange('wearType', event.target.value)}
                >
                  {wearTypeValues.map((value) => (
                    <option key={value} value={value}>
                      {wearTypeLabels[value]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700">Fecha instalación</label>
                  <input
                    type="date"
                    className={`${inputClassName} mt-1`}
                    value={formData.installedAt}
                    onChange={(event) => handleFieldChange('installedAt', event.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700">Km instalación</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    className={`${inputClassName} mt-1`}
                    value={formData.installedKmInput}
                    onChange={(event) => handleFieldChange('installedKmInput', event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700">Notas (opcional)</label>
                <textarea className={`${inputClassName} mt-1`} rows={2} value={formData.notes} onChange={(event) => handleFieldChange('notes', event.target.value)} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  type="submit"
                  disabled={isSaving}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
                >
                  {isSaving ? 'Guardando...' : 'Guardar'}
                </button>
                {selectedTire ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleMarkRemoved()}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Dar de baja
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(selectedTire.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="flex items-center justify-center rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
              Tocá una rueda del dibujo para cargar o editar su cubierta.
            </div>
          )}
        </div>
      ) : null}

      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        title="Eliminar cubierta"
        message="¿Eliminar este registro de cubierta? Esta acción no se puede deshacer."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </article>
  )
}
