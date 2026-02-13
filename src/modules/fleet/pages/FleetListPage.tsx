import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { usePermissions } from '../../../core/auth/usePermissions'
import { FleetUnitCard } from '../components/FleetUnitCard'
import { createEmptyFleetFormData, getOperationalStatusLabel, normalizeFleetUnits, toFleetUnit } from '../services/fleetService'
import type { FleetUnit } from '../../../types/domain'
import { apiRequest } from '../../../services/api/apiClient'

export const FleetListPage = () => {
  const [searchParams] = useSearchParams()
  const {
    state: { fleetUnits },
    actions: { setFleetUnits },
  } = useAppContext()
  const {
    state: { currentUser },
  } = useAppContext()
  const { can } = usePermissions()
  const canEdit = can('FLEET', 'edit')
  const canDelete = can('FLEET', 'delete')
  const isDev = currentUser?.role === 'DEV'

  const normalizedUnits = useMemo(() => normalizeFleetUnits(fleetUnits), [fleetUnits])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE'>('ALL')
  const [unitPendingDelete, setUnitPendingDelete] = useState<FleetUnit | null>(null)

  const summary = useMemo(
    () => ({
      totalUnits: normalizedUnits.length,
      operationalUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OPERATIONAL').length,
      maintenanceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'MAINTENANCE').length,
      outOfServiceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OUT_OF_SERVICE').length,
    }),
    [normalizedUnits],
  )

  const filteredUnits = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    return normalizedUnits.filter((unit) => {
      if (statusFilter !== 'ALL' && unit.operationalStatus !== statusFilter) {
        return false
      }
      if (!normalizedSearch) {
        return true
      }
      const haystack = [
        unit.internalCode,
        unit.ownerCompany,
        unit.chassisNumber,
        unit.engineNumber,
        unit.brand ?? '',
        unit.model ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [normalizedUnits, searchTerm, statusFilter])

  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (!statusParam) {
      return
    }
    if (
      statusParam === 'ALL' ||
      statusParam === 'OPERATIONAL' ||
      statusParam === 'MAINTENANCE' ||
      statusParam === 'OUT_OF_SERVICE'
    ) {
      setStatusFilter(statusParam)
    }
  }, [searchParams])

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!unitPendingDelete) {
      return
    }

    const nextUnitList = normalizedUnits.filter((unit) => unit.id !== unitPendingDelete.id)
    setFleetUnits(nextUnitList)
    setUnitPendingDelete(null)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/fleet/${unitPendingDelete.id}`, { method: 'DELETE' }).catch(() => null)
    }
  }

  const handleQuickSeed = () => {
    const formData = createEmptyFleetFormData()
    const stamp = Date.now().toString().slice(-4)
    formData.internalCode = `TEST-${stamp}`
    formData.brand = 'Mercedes-Benz'
    formData.model = 'Atego 1729'
    formData.year = 2021
    formData.clientName = 'Cliente Demo'
    formData.location = 'Neuquen'
    formData.ownerCompany = 'Enertrans'
    formData.unitType = 'TRACTOR_WITH_HYDROCRANE'
    formData.configurationNotes = 'Unidad de prueba para flujo completo.'
    formData.chassisNumber = `CHS-${stamp}`
    formData.engineNumber = `MTR-${stamp}`
    formData.tareWeightKg = 5000
    formData.maxLoadKg = 12000
    formData.hasHydroCrane = true
    formData.hydroCraneBrand = 'Palfinger'
    formData.hydroCraneModel = 'PK 10000'
    formData.hydroCraneSerialNumber = `HG-${stamp}`

    const unit = toFleetUnit(formData)
    setFleetUnits([unit, ...normalizedUnits])

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest('/fleet', { method: 'POST', body: unit }).catch(() => null)
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
          <h2 className="text-2xl font-bold text-slate-900">Flota</h2>
          <p className="text-sm text-slate-600">Gestión central de unidades operativas.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDev ? (
            <button
              type="button"
              onClick={handleQuickSeed}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Cargar unidad demo
            </button>
          ) : null}
          {can('FLEET', 'create') ? (
            <Link
              to={ROUTE_PATHS.fleet.create}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Crear unidad
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalUnits}</p>
        </article>
        <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {getOperationalStatusLabel('OPERATIONAL')}
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-800">{summary.operationalUnits}</p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {getOperationalStatusLabel('MAINTENANCE')}
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-800">{summary.maintenanceUnits}</p>
        </article>
        <article className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            {getOperationalStatusLabel('OUT_OF_SERVICE')}
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-800">{summary.outOfServiceUnits}</p>
        </article>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Buscar
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Dominio, cliente, marca, modelo..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Estado
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              <option value="OPERATIONAL">{getOperationalStatusLabel('OPERATIONAL')}</option>
              <option value="MAINTENANCE">{getOperationalStatusLabel('MAINTENANCE')}</option>
              <option value="OUT_OF_SERVICE">{getOperationalStatusLabel('OUT_OF_SERVICE')}</option>
            </select>
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Resultados: {filteredUnits.length} de {normalizedUnits.length}
        </p>
      </section>

      {normalizedUnits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No hay unidades registradas. Creá tu primera unidad para iniciar la operación.
        </div>
      ) : (
        <>
          {filteredUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No hay unidades que coincidan con los filtros.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredUnits.map((unit) => (
                <FleetUnitCard
                  key={unit.id}
                  unit={unit}
                  onRequestDelete={setUnitPendingDelete}
                  canEdit={canEdit}
                  canDelete={canDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(unitPendingDelete)}
          title="Eliminar unidad"
          message={`¿Deseás eliminar la unidad ${unitPendingDelete?.internalCode ?? ''}? Esta acción no se puede deshacer.`}
          onCancel={() => setUnitPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  )
}
