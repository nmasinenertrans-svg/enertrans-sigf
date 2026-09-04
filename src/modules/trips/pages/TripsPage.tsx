import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { TripRecord } from '../../../types/domain'
import { LocationPicker } from '../components/LocationPicker'
import {
  createEmptyLegFormData,
  createEmptyTripFormData,
  defaultLegLabel,
  hasValidationErrors,
  toTripPayload,
  validateTripFormData,
} from '../services/tripsService'
import type { TripFormData, TripLegFormData, TripLegFormErrors } from '../types'

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
  const [legErrors, setLegErrors] = useState<TripLegFormErrors[]>([])
  const [driverError, setDriverError] = useState<string | undefined>(undefined)
  const [isSaving, setIsSaving] = useState(false)
  const [driverSearch, setDriverSearch] = useState('')
  const [unitSearchByLeg, setUnitSearchByLeg] = useState<Record<number, string>>({})
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [editingTripId, setEditingTripId] = useState<string | null>(null)
  const [expandedTripId, setExpandedTripId] = useState<string | null>(null)

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

  const updateLeg = (index: number, patch: Partial<TripLegFormData>) => {
    setFormData((previous) => ({
      ...previous,
      legs: previous.legs.map((leg, legIndex) => (legIndex === index ? { ...leg, ...patch } : leg)),
    }))
    setLegErrors((previous) => {
      if (!previous[index]) {
        return previous
      }
      const next = [...previous]
      next[index] = {}
      return next
    })
  }

  const addLeg = () => {
    setFormData((previous) => ({ ...previous, legs: [...previous.legs, createEmptyLegFormData()] }))
  }

  const removeLeg = (index: number) => {
    setFormData((previous) => ({ ...previous, legs: previous.legs.filter((_, legIndex) => legIndex !== index) }))
    setLegErrors((previous) => previous.filter((_, legIndex) => legIndex !== index))
    setUnitSearchByLeg((previous) => {
      const next = { ...previous }
      delete next[index]
      return next
    })
  }

  const resetForm = () => {
    setFormData(createEmptyTripFormData())
    setLegErrors([])
    setDriverError(undefined)
    setDriverSearch('')
    setUnitSearchByLeg({})
    setEditingTripId(null)
  }

  const startEdit = (trip: TripRecord) => {
    setEditingTripId(trip.id)
    setFormData({
      driverUserId: trip.driverUserId ?? '',
      driverExternalName: trip.driverExternalName,
      notes: trip.notes,
      legs: [...trip.legs]
        .sort((a, b) => a.order - b.order)
        .map((leg) => ({
          label: leg.label,
          unitId: leg.unitId ?? '',
          startDate: leg.startDate.slice(0, 10),
          endDate: leg.endDate.slice(0, 10),
          originLabel: leg.originLabel,
          originLat: leg.originLat,
          originLng: leg.originLng,
          destinationLabel: leg.destinationLabel,
          destinationLat: leg.destinationLat,
          destinationLng: leg.destinationLng,
        })),
    })
    setLegErrors([])
    setDriverError(undefined)
    setDriverSearch('')
    setUnitSearchByLeg({})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSubmit = async () => {
    const validation = validateTripFormData(formData)
    if (hasValidationErrors(validation)) {
      setDriverError(validation.driverExternalName)
      setLegErrors(validation.legs)
      return
    }

    setIsSaving(true)
    try {
      if (editingTripId) {
        const updated = await apiRequest<TripRecord>(`/trips/${editingTripId}`, {
          method: 'PATCH',
          body: toTripPayload(formData),
        })
        setTrips(trips.map((trip) => (trip.id === updated.id ? updated : trip)))
      } else {
        const created = await apiRequest<TripRecord>('/trips', {
          method: 'POST',
          body: toTripPayload(formData),
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
          Registrá los viajes de los choferes en tramos (ida, vuelta, o más paradas) — cada tramo puede tener su
          propia unidad, ya que a veces se vuelve con un camión distinto al que se fue. El sistema calcula los km
          por ruta de cada tramo y el total del viaje.
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
                    onClick={() => setFormData((previous) => ({ ...previous, driverUserId: '' }))}
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
                            setFormData((previous) => ({ ...previous, driverUserId: user.id }))
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
                    onChange={(event) =>
                      setFormData((previous) => ({ ...previous, driverExternalName: event.target.value }))
                    }
                    placeholder="...o escribí el nombre del chofer"
                  />
                </>
              )}
              {driverError ? <p className="mt-1 text-xs text-rose-600">{driverError}</p> : null}
            </div>

            <div className="space-y-3">
              {formData.legs.map((leg, index) => {
                const errors = legErrors[index] ?? {}
                const selectedUnit = fleetUnits.find((unit) => unit.id === leg.unitId)
                const unitSearch = unitSearchByLeg[index] ?? ''
                const filteredUnits = unitSearch.trim()
                  ? fleetUnits
                      .filter((unit) =>
                        `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(unitSearch.trim().toLowerCase()),
                      )
                      .slice(0, 8)
                  : fleetUnits.slice(0, 8)

                return (
                  <div key={index} className="rounded-xl border border-slate-300 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <input
                        value={leg.label}
                        onChange={(event) => updateLeg(index, { label: event.target.value })}
                        placeholder={defaultLegLabel(index)}
                        className="w-40 rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm font-semibold text-slate-800 outline-none focus:border-amber-400"
                      />
                      {formData.legs.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => removeLeg(index)}
                          className="text-xs font-semibold text-rose-600 hover:underline"
                        >
                          Quitar tramo
                        </button>
                      ) : null}
                    </div>

                    <div className="mt-2">
                      <label className="text-xs font-semibold text-slate-600">Unidad (opcional)</label>
                      {selectedUnit ? (
                        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800">
                          <span>
                            {selectedUnit.internalCode} · {selectedUnit.brand} {selectedUnit.model}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateLeg(index, { unitId: '' })}
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
                            onChange={(event) =>
                              setUnitSearchByLeg((previous) => ({ ...previous, [index]: event.target.value }))
                            }
                            placeholder="Buscar por dominio, marca o modelo..."
                          />
                          {unitSearch.trim() ? (
                            <div className="mt-1 max-h-24 space-y-1 overflow-y-auto">
                              {filteredUnits.map((unit) => (
                                <button
                                  key={unit.id}
                                  type="button"
                                  onClick={() => {
                                    updateLeg(index, { unitId: unit.id })
                                    setUnitSearchByLeg((previous) => ({ ...previous, [index]: '' }))
                                  }}
                                  className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                                >
                                  {unit.internalCode} · {unit.brand} {unit.model}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs font-semibold text-slate-600">Desde</label>
                        <input
                          type="date"
                          className={`${inputClassName} mt-1`}
                          value={leg.startDate}
                          onChange={(event) => updateLeg(index, { startDate: event.target.value })}
                        />
                        {errors.startDate ? <p className="mt-1 text-xs text-rose-600">{errors.startDate}</p> : null}
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-600">Hasta</label>
                        <input
                          type="date"
                          className={`${inputClassName} mt-1`}
                          value={leg.endDate}
                          onChange={(event) => updateLeg(index, { endDate: event.target.value })}
                        />
                        {errors.endDate ? <p className="mt-1 text-xs text-rose-600">{errors.endDate}</p> : null}
                      </div>
                    </div>

                    <div className="mt-2">
                      <LocationPicker
                        label="Origen"
                        lat={leg.originLat}
                        lng={leg.originLng}
                        addressLabel={leg.originLabel}
                        errorMessage={errors.originLabel}
                        onChange={({ label, lat, lng }) => updateLeg(index, { originLabel: label, originLat: lat, originLng: lng })}
                      />
                    </div>

                    <div className="mt-2">
                      <LocationPicker
                        label="Destino"
                        lat={leg.destinationLat}
                        lng={leg.destinationLng}
                        addressLabel={leg.destinationLabel}
                        errorMessage={errors.destinationLabel}
                        onChange={({ label, lat, lng }) =>
                          updateLeg(index, { destinationLabel: label, destinationLat: lat, destinationLng: lng })
                        }
                      />
                    </div>
                  </div>
                )
              })}

              <button
                type="button"
                onClick={addLeg}
                className="w-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                + Agregar tramo
              </button>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Notas (opcional)</label>
              <textarea
                className={`${inputClassName} mt-1`}
                rows={2}
                value={formData.notes}
                onChange={(event) => setFormData((previous) => ({ ...previous, notes: event.target.value }))}
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
            sortedTrips.map((trip) => {
              const isExpanded = expandedTripId === trip.id
              return (
                <article key={trip.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{trip.code}</p>
                      <h3 className="mt-0.5 text-base font-bold text-slate-900">
                        {trip.driverName || trip.driverExternalName || 'Sin chofer'}
                      </h3>
                      <p className="text-xs text-slate-500">
                        {formatDateOnly(trip.startDate)} — {formatDateOnly(trip.endDate)} · {trip.legs.length} tramo
                        {trip.legs.length === 1 ? '' : 's'}
                      </p>
                    </div>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      Total: {trip.totalDistanceKm.toLocaleString('es-AR')} km
                    </span>
                  </div>

                  {trip.notes ? <p className="mt-2 text-xs text-slate-600">{trip.notes}</p> : null}

                  <button
                    type="button"
                    onClick={() => setExpandedTripId(isExpanded ? null : trip.id)}
                    className="mt-3 text-xs font-semibold text-amber-700 hover:underline"
                  >
                    {isExpanded ? 'Ocultar tramos' : 'Ver tramos'}
                  </button>

                  {isExpanded ? (
                    <div className="mt-2 space-y-2">
                      {[...trip.legs]
                        .sort((a, b) => a.order - b.order)
                        .map((leg) => (
                          <div key={leg.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-bold text-slate-800">{leg.label}</span>
                              <span className="font-semibold text-emerald-700">
                                {leg.distanceKm.toLocaleString('es-AR')} km
                                {leg.distanceSource === 'STRAIGHT_LINE' ? (
                                  <span className="ml-1 font-normal text-amber-700">(aproximado)</span>
                                ) : null}
                              </span>
                            </div>
                            <p className="mt-1 text-slate-600">
                              {formatDateOnly(leg.startDate)} — {formatDateOnly(leg.endDate)}
                              {leg.unitLabel ? ` · ${leg.unitLabel}` : ''}
                            </p>
                            <p className="mt-1 text-slate-600">
                              <span className="font-semibold">Origen: </span>
                              {leg.originLabel || `${leg.originLat.toFixed(5)}, ${leg.originLng.toFixed(5)}`}
                            </p>
                            <p className="mt-1 text-slate-600">
                              <span className="font-semibold">Destino: </span>
                              {leg.destinationLabel || `${leg.destinationLat.toFixed(5)}, ${leg.destinationLng.toFixed(5)}`}
                            </p>
                          </div>
                        ))}
                    </div>
                  ) : null}

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
              )
            })
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(pendingDeleteId)}
        title="Eliminar viaje"
        message="¿Eliminar este registro de viaje (con todos sus tramos)? Esta acción no se puede deshacer."
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDeleteId(null)}
      />
    </section>
  )
}
