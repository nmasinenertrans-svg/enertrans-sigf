import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { TripRecord } from '../../../types/domain'
import { LocationPicker } from '../components/LocationPicker'
import { createEmptyTripFormData, toTripCreatePayload, validateTripFormData } from '../services/tripsService'
import type { TripFormData, TripFormErrors, TripFormField } from '../types'

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const formatDateOnly = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-AR')
}

export const TripsPage = () => {
  const {
    state: { trips, users, fleetUnits },
    actions: { setTrips, setAppError },
  } = useAppContext()

  const [formData, setFormData] = useState<TripFormData>(createEmptyTripFormData)
  const [errors, setErrors] = useState<TripFormErrors>({})
  const [isSaving, setIsSaving] = useState(false)
  const [driverSearch, setDriverSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)

  const sortedTrips = useMemo(
    () => [...trips].sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime()),
    [trips],
  )

  const selectedDriver = users.find((user) => user.id === formData.driverUserId)
  const filteredDrivers = useMemo(() => {
    const query = driverSearch.trim().toLowerCase()
    if (!query) {
      return users.slice(0, 8)
    }
    return users.filter((user) => user.fullName.toLowerCase().includes(query)).slice(0, 8)
  }, [users, driverSearch])

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)
  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) {
      return fleetUnits.slice(0, 8)
    }
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const handleFieldChange = <TField extends TripFormField>(field: TField, value: TripFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const resetForm = () => {
    setFormData(createEmptyTripFormData())
    setErrors({})
    setDriverSearch('')
    setUnitSearch('')
    setEditingTripId(null)
  }

  const startEdit = (trip: TripRecord) => {
    setEditingTripId(trip.id)
    setFormData({
      driverUserId: trip.driverUserId ?? '',
      driverExternalName: trip.driverExternalName,
      unitId: trip.unitId ?? '',
      startDate: trip.startDate.slice(0, 10),
      endDate: trip.endDate.slice(0, 10),
      originLabel: trip.originLabel,
      originLat: trip.originLat,
      originLng: trip.originLng,
      destinationLabel: trip.destinationLabel,
      destinationLat: trip.destinationLat,
      destinationLng: trip.destinationLng,
      notes: trip.notes,
    })
    setErrors({})
    setDriverSearch('')
    setUnitSearch('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async () => {
    const validationErrors = validateTripFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      if (editingTripId) {
        const updated = await apiRequest<TripRecord>(`/trips/${editingTripId}`, {
          method: 'PATCH',
          body: toTripCreatePayload(formData),
        })
        setTrips(trips.map((trip) => (trip.id === updated.id ? updated : trip)))
      } else {
        const created = await apiRequest<TripRecord>('/trips', {
          method: 'POST',
          body: toTripCreatePayload(formData),
        })
        setTrips([created, ...trips])
      }
      resetForm()
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo guardar el viaje.'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!pendingDeleteId) {
      return
    }
    const idToDelete = pendingDeleteId
    setPendingDeleteId(null)
    try {
      await apiRequest(`/trips/${idToDelete}`, { method: 'DELETE' })
      setTrips(trips.filter((trip) => trip.id !== idToDelete))
    } catch {
      setAppError('No se pudo eliminar el viaje.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Viajes / Traslados</h2>
        <p className="text-sm text-slate-600">
          Registrá los viajes de los choferes: desde qué fecha, hasta qué fecha y a dónde. Marcá el origen y el
          destino en el mapa y el sistema calcula los km por ruta automáticamente.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">{editingTripId ? 'Editar viaje' : 'Nuevo viaje'}</h3>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div>
              <label className="text-sm font-semibold text-slate-700">Chofer</label>
              {selectedDriver ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span>{selectedDriver.fullName}</span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange('driverUserId', '')}
                    className="font-semibold text-amber-700 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={`${inputClassName} mt-1`}
                    value={driverSearch}
                    onChange={(event) => setDriverSearch(event.target.value)}
                    placeholder="Buscar usuario del sistema..."
                    disabled={Boolean(formData.driverExternalName.trim())}
                  />
                  {driverSearch.trim() ? (
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                      {filteredDrivers.map((user) => (
                        <button
                          key={user.id}
                          type="button"
                          onClick={() => {
                            handleFieldChange('driverUserId', user.id)
                            setDriverSearch('')
                          }}
                          className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                        >
                          {user.fullName}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <input
                    className={`${inputClassName} mt-2`}
                    value={formData.driverExternalName}
                    onChange={(event) => handleFieldChange('driverExternalName', event.target.value)}
                    placeholder="...o escribí el nombre del chofer"
                  />
                </>
              )}
              {errors.driverExternalName ? <p className="mt-1 text-xs text-rose-600">{errors.driverExternalName}</p> : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Unidad (opcional)</label>
              {selectedUnit ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span>
                    {selectedUnit.internalCode} · {selectedUnit.brand} {selectedUnit.model}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange('unitId', '')}
                    className="font-semibold text-amber-700 hover:underline"
                  >
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
                  {unitSearch.trim() ? (
                    <div className="mt-2 max-h-28 space-y-1 overflow-y-auto">
                      {filteredUnits.map((unit) => (
                        <button
                          key={unit.id}
                          type="button"
                          onClick={() => {
                            handleFieldChange('unitId', unit.id)
                            setUnitSearch('')
                          }}
                          className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                        >
                          {unit.internalCode} · {unit.brand} {unit.model}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Desde</label>
                <input
                  type="date"
                  className={`${inputClassName} mt-1`}
                  value={formData.startDate}
                  onChange={(event) => handleFieldChange('startDate', event.target.value)}
                />
                {errors.startDate ? <p className="mt-1 text-xs text-rose-600">{errors.startDate}</p> : null}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Hasta</label>
                <input
                  type="date"
                  className={`${inputClassName} mt-1`}
                  value={formData.endDate}
                  onChange={(event) => handleFieldChange('endDate', event.target.value)}
                />
                {errors.endDate ? <p className="mt-1 text-xs text-rose-600">{errors.endDate}</p> : null}
              </div>
            </div>

            <LocationPicker
              label="Origen"
              lat={formData.originLat}
              lng={formData.originLng}
              addressLabel={formData.originLabel}
              errorMessage={errors.originLabel}
              onChange={({ label, lat, lng }) => {
                setFormData((previous) => ({ ...previous, originLabel: label, originLat: lat, originLng: lng }))
                setErrors((previous) => ({ ...previous, originLabel: undefined }))
              }}
            />

            <LocationPicker
              label="Destino"
              lat={formData.destinationLat}
              lng={formData.destinationLng}
              addressLabel={formData.destinationLabel}
              errorMessage={errors.destinationLabel}
              onChange={({ label, lat, lng }) => {
                setFormData((previous) => ({
                  ...previous,
                  destinationLabel: label,
                  destinationLat: lat,
                  destinationLng: lng,
                }))
                setErrors((previous) => ({ ...previous, destinationLabel: undefined }))
              }}
            />

            <div>
              <label className="text-sm font-semibold text-slate-700">Notas (opcional)</label>
              <textarea
                className={`${inputClassName} mt-1`}
                rows={2}
                value={formData.notes}
                onChange={(event) => handleFieldChange('notes', event.target.value)}
              />
            </div>

            <div className="flex justify-end gap-2">
              {editingTripId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Cancelar
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
              >
                {isSaving
                  ? 'Calculando km y guardando...'
                  : editingTripId
                    ? 'Guardar cambios'
                    : 'Registrar viaje'}
              </button>
            </div>
          </form>
        </article>

        <div className="space-y-3 xl:col-span-2">
          {sortedTrips.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Todavía no hay viajes registrados.
            </div>
          ) : (
            sortedTrips.map((trip) => (
              <article key={trip.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{trip.code}</p>
                    <h3 className="mt-0.5 text-base font-bold text-slate-900">
                      {trip.driverName || trip.driverExternalName || 'Sin chofer'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {formatDateOnly(trip.startDate)} — {formatDateOnly(trip.endDate)}
                      {trip.unitLabel ? ` · ${trip.unitLabel}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      {trip.distanceKm.toLocaleString('es-AR')} km
                    </span>
                    {trip.distanceSource === 'STRAIGHT_LINE' ? (
                      <span className="text-[10px] font-semibold text-amber-700">Aproximado (línea recta)</span>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <p>
                    <span className="font-semibold text-slate-700">Origen: </span>
                    {trip.originLabel || `${trip.originLat.toFixed(5)}, ${trip.originLng.toFixed(5)}`}
                  </p>
                  <p>
                    <span className="font-semibold text-slate-700">Destino: </span>
                    {trip.destinationLabel || `${trip.destinationLat.toFixed(5)}, ${trip.destinationLng.toFixed(5)}`}
                  </p>
                </div>

                {trip.notes ? <p className="mt-2 text-xs text-slate-600">{trip.notes}</p> : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">Cargado por {trip.createdByUserName || '-'}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => startEdit(trip)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeleteId(trip.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        title="Eliminar viaje"
        message="¿Eliminar este registro de viaje? Esta acción no se puede deshacer."
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
