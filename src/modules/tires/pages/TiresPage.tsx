import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import {
  buildTireView,
  createEmptyTireFormData,
  toTirePayload,
  validateTireFormData,
} from '../services/tiresService'
import type { TireFormData, TireFormErrors, TireFormField } from '../types'

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const wearBadgeClassName: Record<'OK' | 'ALTO' | 'CAMBIO', string> = {
  OK: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  ALTO: 'border-amber-200 bg-amber-50 text-amber-700',
  CAMBIO: 'border-rose-200 bg-rose-50 text-rose-700',
}

const wearBadgeLabel: Record<'OK' | 'ALTO' | 'CAMBIO', string> = {
  OK: 'OK',
  ALTO: 'Desgaste alto',
  CAMBIO: 'Para cambio',
}

const formatCurrency = (value: number, currency: 'ARS' | 'USD') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

export const TiresPage = () => {
  const {
    state: { fleetUnits, tires },
    actions: { setTires, setAppError },
  } = useAppContext()

  const [formData, setFormData] = useState<TireFormData>(createEmptyTireFormData)
  const [errors, setErrors] = useState<TireFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)

  const view = useMemo(() => buildTireView(tires, fleetUnits), [tires, fleetUnits])
  const visibleView = showInactive ? view : view.filter((tire) => tire.isActive)

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return fleetUnits.slice(0, 8)
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)

  const handleFieldChange = <TField extends TireFormField>(field: TField, value: TireFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const resetForm = () => {
    setErrors({})
    setFormData(createEmptyTireFormData())
  }

  const handleSubmit = async () => {
    const validationErrors = validateTireFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      const created = await apiRequest('/tires', { method: 'POST', body: toTirePayload(formData) })
      setTires([created as any, ...tires])
      resetForm()
    } catch {
      setAppError('No se pudo guardar la cubierta.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleMarkRemoved = async (tireId: string) => {
    try {
      const updated = await apiRequest(`/tires/${tireId}`, {
        method: 'PATCH',
        body: { isActive: false, removedAt: new Date().toISOString() },
      })
      setTires(tires.map((tire) => (tire.id === tireId ? (updated as any) : tire)))
    } catch {
      setAppError('No se pudo dar de baja la cubierta.')
    }
  }

  const handleRegisterRotation = async (tireId: string, currentKm: number) => {
    try {
      const updated = await apiRequest(`/tires/${tireId}`, {
        method: 'PATCH',
        body: { lastRotationKm: currentKm },
      })
      setTires(tires.map((tire) => (tire.id === tireId ? (updated as any) : tire)))
    } catch {
      setAppError('No se pudo registrar la rotación.')
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) return
    const idToDelete = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await apiRequest(`/tires/${idToDelete}`, { method: 'DELETE' })
      setTires(tires.filter((tire) => tire.id !== idToDelete))
    } catch {
      setAppError('No se pudo eliminar la cubierta.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Control de cubiertas</h2>
        <p className="text-sm text-slate-600">
          Una cubierta por posición. Los km recorridos se calculan solos a partir del km actual de la unidad, y se
          avisa automáticamente cuando conviene cambiarla (90.000 km).
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="xl:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Nueva cubierta</h3>

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
                placeholder="Ej: Eje 1 Izq., Eje 2 Der. Ext."
              />
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
                <label className="text-sm font-semibold text-slate-700">Km instalación</label>
                <input
                  type="text"
                  inputMode="numeric"
                  className={`${inputClassName} mt-1`}
                  value={formData.installedKmInput}
                  onChange={(event) => handleFieldChange('installedKmInput', event.target.value)}
                  placeholder="Km de la unidad al instalarla"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Costo</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={`${inputClassName} mt-1`}
                  value={formData.costBaseInput}
                  onChange={(event) => handleFieldChange('costBaseInput', event.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Moneda</label>
                <select
                  className={`${inputClassName} mt-1`}
                  value={formData.currency}
                  onChange={(event) => handleFieldChange('currency', event.target.value as TireFormData['currency'])}
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
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
                {isSaving ? 'Guardando...' : 'Agregar cubierta'}
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
              Todavía no hay cubiertas cargadas.
            </div>
          ) : (
            visibleView.map((tire) => (
              <article key={tire.id} className={`rounded-xl border bg-white p-4 shadow-sm ${tire.isActive ? 'border-slate-200' : 'border-slate-200 opacity-60'}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{tire.position}</p>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900">{tire.unitLabel}</h3>
                    <p className="text-xs text-slate-500">
                      {tire.brand} {tire.model} {!tire.isActive ? '· Dada de baja' : ''}
                    </p>
                  </div>
                  {tire.isActive ? (
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${wearBadgeClassName[tire.wearLevel]}`}>
                      {wearBadgeLabel[tire.wearLevel]}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                  <p>Km recorridos: {tire.kmOnTire.toLocaleString('es-AR')}</p>
                  <p>Km instalación: {tire.installedKm.toLocaleString('es-AR')}</p>
                  <p>Costo: {formatCurrency(tire.costBase, tire.currency)}</p>
                  <p>Últ. rotación: {tire.lastRotationKm != null ? `${tire.lastRotationKm.toLocaleString('es-AR')} km` : '-'}</p>
                </div>

                {tire.notes ? <p className="mt-2 text-xs text-slate-600">{tire.notes}</p> : null}

                {tire.isActive ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => handleRegisterRotation(tire.id, tire.installedKm + tire.kmOnTire)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Registrar rotación
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMarkRemoved(tire.id)}
                      className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100"
                    >
                      Dar de baja
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(tire.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                ) : (
                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(tire.id)}
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
        title="Eliminar cubierta"
        message="¿Eliminar este registro de cubierta? Esta acción no se puede deshacer."
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
