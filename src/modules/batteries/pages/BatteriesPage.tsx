import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import {
  buildBatteryView,
  createEmptyBatteryFormData,
  getSuggestedBatteryPositions,
  toBatteryPayload,
  validateBatteryFormData,
} from '../services/batteriesService'
import type { BatteryFormData, BatteryFormErrors, BatteryFormField } from '../types'
import type { BatteryStatus } from '../services/batteriesService'

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const statusBadgeClassName: Record<BatteryStatus, string> = {
  SIN_FECHA: 'border-slate-200 bg-slate-50 text-slate-600',
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  DUE_SOON: 'border-amber-200 bg-amber-50 text-amber-700',
  VENCIDA: 'border-rose-200 bg-rose-50 text-rose-700',
}

const statusBadgeLabel: Record<BatteryStatus, string> = {
  SIN_FECHA: 'Sin fecha',
  OK: 'OK',
  DUE_SOON: 'Por vencer',
  VENCIDA: 'Vencida',
}

export const BatteriesPage = () => {
  const {
    state: { fleetUnits, batteries },
    actions: { setBatteries, setAppError },
  } = useAppContext()

  const [formData, setFormData] = useState<BatteryFormData>(createEmptyBatteryFormData)
  const [errors, setErrors] = useState<BatteryFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const view = useMemo(() => buildBatteryView(batteries, fleetUnits), [batteries, fleetUnits])
  const visibleView = showInactive ? view : view.filter((battery) => battery.isActive)

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return fleetUnits.slice(0, 8)
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)
  const suggestedPositions = getSuggestedBatteryPositions(selectedUnit?.unitType)

  const handleFieldChange = <TField extends BatteryFormField>(field: TField, value: BatteryFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const resetForm = () => {
    setErrors({})
    setFormData(createEmptyBatteryFormData())
  }

  const handleSubmit = async () => {
    const validationErrors = validateBatteryFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      const created = await apiRequest('/batteries', { method: 'POST', body: toBatteryPayload(formData) })
      setBatteries([created as any, ...batteries])
      resetForm()
    } catch {
      setAppError('No se pudo guardar la batería.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMarkRemoved = async (batteryId: string) => {
    try {
      const updated = await apiRequest(`/batteries/${batteryId}`, {
        method: 'PATCH',
        body: { isActive: false, removedAt: new Date().toISOString() },
      })
      setBatteries(batteries.map((battery) => (battery.id === batteryId ? (updated as any) : battery)))
    } catch {
      setAppError('No se pudo dar de baja la batería.')
    }
  }

  const handleRegisterReplacement = async (batteryId: string) => {
    try {
      const updated = await apiRequest(`/batteries/${batteryId}`, {
        method: 'PATCH',
        body: { installedAt: new Date().toISOString() },
      })
      setBatteries(batteries.map((battery) => (battery.id === batteryId ? (updated as any) : battery)))
    } catch {
      setAppError('No se pudo registrar el cambio de batería.')
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return
    const idToDelete = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await apiRequest(`/batteries/${idToDelete}`, { method: 'DELETE' })
      setBatteries(batteries.filter((battery) => battery.id !== idToDelete))
    } catch {
      setAppError('No se pudo eliminar la batería.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Control de baterías</h2>
        <p className="text-sm text-slate-600">
          Se controla por fecha, no por km ni horas. Vida útil por defecto: 18 meses desde la instalación. Los
          camiones/tractores llevan dos baterías, autos y utilitarios una.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="xl:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Nueva batería</h3>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
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

            <div>
              <label className="text-sm font-semibold text-slate-700">Posición</label>
              <input
                className={`${inputClassName} mt-1`}
                value={formData.position}
                onChange={(event) => handleFieldChange('position', event.target.value)}
                placeholder="Ej: 1, 2, Única"
              />
              {suggestedPositions.length > 0 ? (
                <div className="mt-1.5 flex gap-1.5">
                  {suggestedPositions.map((position) => (
                    <button
                      key={position}
                      type="button"
                      onClick={() => handleFieldChange('position', position)}
                      className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-100"
                    >
                      {position}
                    </button>
                  ))}
                </div>
              ) : null}
              {errors.position ? <p className="mt-1 text-xs text-rose-600">{errors.position}</p> : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Marca</label>
                <input className={`${inputClassName} mt-1`} value={formData.brand} onChange={(event) => handleFieldChange('brand', event.target.value)} />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Modelo</label>
                <input className={`${inputClassName} mt-1`} value={formData.model} onChange={(event) => handleFieldChange('model', event.target.value)} />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Número de serie</label>
              <input
                className={`${inputClassName} mt-1`}
                value={formData.serialNumber}
                onChange={(event) => handleFieldChange('serialNumber', event.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Fecha instalación</label>
                <input
                  type="date"
                  className={`${inputClassName} mt-1`}
                  value={formData.installedAt}
                  onChange={(event) => handleFieldChange('installedAt', event.target.value)}
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Vida útil (meses)</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClassName} mt-1`}
                  value={formData.lifespanMonthsInput}
                  onChange={(event) => handleFieldChange('lifespanMonthsInput', event.target.value)}
                  placeholder="18"
                />
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Notas (opcional)</label>
              <textarea className={`${inputClassName} mt-1`} rows={2} value={formData.notes} onChange={(event) => handleFieldChange('notes', event.target.value)} />
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
              >
                {isSaving ? 'Guardando...' : 'Agregar batería'}
              </button>
            </div>
          </form>
        </article>

        <div className="xl:col-span-2 space-y-3">
          <div className="flex items-center justify-end gap-2">
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
              Mostrar dadas de baja
            </label>
          </div>

          {visibleView.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Todavía no hay baterías cargadas.
            </div>
          ) : (
            visibleView.map((battery) => (
              <article key={battery.id} className={`rounded-xl border bg-white p-4 shadow-sm ${battery.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Batería {battery.position}</p>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900">{battery.unitLabel}</h3>
                    <p className="text-xs text-slate-500">
                      {battery.brand} {battery.model} {!battery.isActive ? '· Dada de baja' : ''}
                    </p>
                  </div>
                  {battery.isActive ? (
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusBadgeClassName[battery.status]}`}>
                      {statusBadgeLabel[battery.status]}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <p>N° de serie: {battery.serialNumber || '-'}</p>
                  <p>Instalación: {battery.installedAt ? new Date(battery.installedAt).toLocaleDateString('es-AR') : '-'}</p>
                  <p>Vence: {battery.expiresAt ? battery.expiresAt.toLocaleDateString('es-AR') : '-'}</p>
                  <p>Vida útil: {battery.lifespanMonths} meses</p>
                </div>

                {battery.notes ? <p className="mt-2 text-xs text-slate-600">{battery.notes}</p> : null}

                {battery.isActive ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRegisterReplacement(battery.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Registrar cambio
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkRemoved(battery.id)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Dar de baja
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(battery.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(battery.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        title="Eliminar batería"
        message="¿Eliminar este registro de batería? Esta acción no se puede deshacer."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
