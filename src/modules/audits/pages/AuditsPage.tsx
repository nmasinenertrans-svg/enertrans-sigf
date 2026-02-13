import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import type { AuditChecklistStatus } from '../../../types/domain'
import { AuditChecklistEditor } from '../components/AuditChecklistEditor'
import { AuditHistoryList } from '../components/AuditHistoryList'
import { AuditPhotoPicker } from '../components/AuditPhotoPicker'
import { exportAuditPdf } from '../services/auditPdfService'
import {
  buildAuditHistoryView,
  createChecklistFromDeviations,
  createEmptyAuditFormData,
  createWorkOrderFromAudit,
  readFileAsDataUrl,
  toAuditRecord,
  validateAuditFormData,
} from '../services/auditsService'
import type { AuditFormData, AuditFormErrors } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { BackLink } from '../../../components/shared/BackLink'
import { apiRequest } from '../../../services/api/apiClient'

const allUnitsFilter = 'ALL_UNITS'

export const AuditsPage = () => {
  const { can } = usePermissions()
  const [searchParams] = useSearchParams()
  const {
    state: { currentUser, fleetUnits, audits, workOrders },
    actions: { setAudits, setGlobalLoading, setAppError, setWorkOrders, setFleetUnits },
  } = useAppContext()

  const canCreate = can('AUDITS', 'create')
  const canDelete = can('AUDITS', 'delete')

  const pendingReauditParam = searchParams.get('pendingReaudit')
  const pendingReauditOrder = useMemo(() => workOrders.find((order) => order.pendingReaudit), [workOrders])

  const preferredUnitId = useMemo(() => {
    const queryUnitId = searchParams.get('unitId') ?? ''
    if (queryUnitId && fleetUnits.some((unit) => unit.id === queryUnitId)) {
      return queryUnitId
    }

    if (pendingReauditParam === '1') {
      const pendingUnitId = pendingReauditOrder?.unitId
      if (pendingUnitId && fleetUnits.some((unit) => unit.id === pendingUnitId)) {
        return pendingUnitId
      }
    }

    return fleetUnits[0]?.id ?? ''
  }, [fleetUnits, searchParams, pendingReauditParam, pendingReauditOrder])

  const pendingWorkOrder = useMemo(() => {
    const workOrderId = searchParams.get('workOrderId')
    if (workOrderId) {
      return workOrders.find((order) => order.id === workOrderId)
    }
    if (pendingReauditParam === '1') {
      return pendingReauditOrder
    }
    return undefined
  }, [searchParams, workOrders, pendingReauditOrder, pendingReauditParam])

  const pendingReauditOrders = useMemo(() => workOrders.filter((order) => order.pendingReaudit), [workOrders])

  const [formData, setFormData] = useState<AuditFormData>(() => createEmptyAuditFormData(preferredUnitId))
  const [errors, setErrors] = useState<AuditFormErrors>({})
  const [unitFilter, setUnitFilter] = useState<string>(preferredUnitId || allUnitsFilter)
  const [searchTerm, setSearchTerm] = useState('')
  const [resultFilter, setResultFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL')
  const [auditIdPendingDelete, setAuditIdPendingDelete] = useState<string | null>(null)

  const auditHistory = useMemo(() => buildAuditHistoryView(audits, fleetUnits), [audits, fleetUnits])

  const filteredAuditHistory = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    return auditHistory.filter((item) => {
      if (unitFilter !== allUnitsFilter && item.unitId !== unitFilter) {
        return false
      }
      if (resultFilter !== 'ALL') {
        const expectedLabel = resultFilter === 'APPROVED' ? 'APROBADO' : 'RECHAZADO'
        if (item.resultLabel !== expectedLabel) {
          return false
        }
      }
      if (!normalizedSearch) {
        return true
      }
      const haystack = [item.unitLabel, item.auditorName, item.resultLabel, item.code]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [auditHistory, unitFilter, resultFilter, searchTerm])

  const resetAuditForm = () => {
    setErrors({})
    setFormData(createEmptyAuditFormData(preferredUnitId))
  }

  useEffect(() => {
    if (!preferredUnitId) {
      return
    }

    const selectedUnit = fleetUnits.find((unit) => unit.id === preferredUnitId)

    setFormData((previousFormData) => ({
      ...previousFormData,
      unitId: preferredUnitId,
      unitKilometers: selectedUnit?.currentKilometers ?? 0,
      engineHours: selectedUnit?.currentEngineHours ?? 0,
      hydroHours: selectedUnit?.currentHydroHours ?? 0,
    }))
    setUnitFilter(preferredUnitId)
  }, [preferredUnitId, fleetUnits])

  useEffect(() => {
    if (!pendingWorkOrder) {
      return
    }

    setFormData((previousFormData) => ({
      ...previousFormData,
      unitId: pendingWorkOrder.unitId,
      checklistSections: createChecklistFromDeviations(pendingWorkOrder.taskList ?? []),
    }))
    setUnitFilter(pendingWorkOrder.unitId)
  }, [pendingWorkOrder])

  const handleItemStatusChange = (sectionId: string, itemId: string, status: AuditChecklistStatus) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      checklistSections: previousFormData.checklistSections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => (item.id === itemId ? { ...item, status } : item)),
            }
          : section,
      ),
    }))
  }

  const handleItemObservationChange = (sectionId: string, itemId: string, observation: string) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      checklistSections: previousFormData.checklistSections.map((section) =>
        section.id === sectionId
          ? {
              ...section,
              items: section.items.map((item) => (item.id === itemId ? { ...item, observation } : item)),
            }
          : section,
      ),
    }))
  }

  const handleAddPhotoFiles = async (fileList: FileList) => {
    try {
      setGlobalLoading(true)
      const photoDataList = await Promise.all(Array.from(fileList).map((file) => readFileAsDataUrl(file)))

      setFormData((previousFormData) => ({
        ...previousFormData,
        photoBase64List: [...previousFormData.photoBase64List, ...photoDataList],
      }))
    } catch {
      setAppError('No se pudo procesar una o mas imagenes.')
    } finally {
      setGlobalLoading(false)
    }
  }

  const handleRemovePhoto = (photoIndex: number) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      photoBase64List: previousFormData.photoBase64List.filter((_, index) => index !== photoIndex),
    }))
  }

  const handleSubmitAudit = () => {
    if (!canCreate) {
      return
    }

    const validationErrors = validateAuditFormData(formData, fleetUnits)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const auditorId = currentUser?.id ?? 'audit-user-unknown'
    const auditorName = currentUser?.fullName ?? 'Usuario no identificado'
    const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)
    const unitCode = selectedUnit?.internalCode ?? ''
    const createdAudit = toAuditRecord(formData, auditorId, auditorName, workOrders, unitCode)

    const updatedFleetUnits = fleetUnits.map((unit) =>
      unit.id === createdAudit.unitId
        ? {
            ...unit,
            currentKilometers: createdAudit.unitKilometers,
            currentEngineHours: createdAudit.engineHours,
            currentHydroHours: createdAudit.hydroHours,
          }
        : unit,
    )

    setFleetUnits(updatedFleetUnits)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/fleet/${createdAudit.unitId}`, {
        method: 'PATCH',
        body: {
          currentKilometers: createdAudit.unitKilometers,
          currentEngineHours: createdAudit.engineHours,
          currentHydroHours: createdAudit.hydroHours,
        },
      }).catch(() => null)
    }

    if (createdAudit.result === 'REJECTED') {
      const createdWorkOrder = createWorkOrderFromAudit(createdAudit, unitCode)
      setWorkOrders([createdWorkOrder, ...workOrders])
      setFleetUnits(
        updatedFleetUnits.map((unit) =>
          unit.id === createdAudit.unitId ? { ...unit, operationalStatus: 'OUT_OF_SERVICE' } : unit,
        ),
      )

      enqueueAndSync({
        id: `audit.create.${createdAudit.id}`,
        type: 'audit.create',
        payload: { ...createdAudit, workOrderId: createdWorkOrder.id, workOrderCode: createdWorkOrder.code },
        createdAt: new Date().toISOString(),
      })
    } else {
      const hasOpenWorkOrders = workOrders.some(
        (order) => order.unitId === createdAudit.unitId && order.status !== 'CLOSED',
      )

      if (!hasOpenWorkOrders) {
        setFleetUnits(
          updatedFleetUnits.map((unit) =>
            unit.id === createdAudit.unitId ? { ...unit, operationalStatus: 'OPERATIONAL' } : unit,
          ),
        )
      }

      setWorkOrders(
        workOrders.map((order) =>
          order.unitId === createdAudit.unitId && order.pendingReaudit
            ? { ...order, pendingReaudit: false }
            : order,
        ),
      )

      enqueueAndSync({
        id: `audit.create.${createdAudit.id}`,
        type: 'audit.create',
        payload: createdAudit,
        createdAt: new Date().toISOString(),
      })
    }

    setAudits([createdAudit, ...audits])
    resetAuditForm()
  }

  const handleExportPdf = async (auditId: string) => {
    const audit = audits.find((auditRecord) => auditRecord.id === auditId)

    if (!audit) {
      setAppError('No se encontro la auditoria para exportar el PDF.')
      return
    }

    const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === audit.unitId)
    try {
      await exportAuditPdf({ audit, unit })
    } catch {
      setAppError('No se pudo generar el PDF de la auditoria.')
    }
  }

  const handleConfirmDeleteAudit = () => {
    if (!canDelete) {
      return
    }

    if (!auditIdPendingDelete) {
      return
    }

    setAudits(audits.filter((audit) => audit.id !== auditIdPendingDelete))
    setAuditIdPendingDelete(null)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/audits/${auditIdPendingDelete}`, { method: 'DELETE' }).catch(() => null)
    }
  }

  if (fleetUnits.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Auditorias</h2>
        <p className="mt-2 text-sm text-slate-600">Primero necesitas registrar al menos una unidad en Flota.</p>
        <Link
          to={ROUTE_PATHS.fleet.create}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Crear unidad
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Auditorias</h2>
        <p className="text-sm text-slate-600">Checklist dinamico, observaciones, fotos y trazabilidad por unidad.</p>
      </header>

      {pendingReauditOrders.length > 0 ? (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Re-auditorias pendientes</p>
              <p className="mt-1 text-sm text-slate-700">Selecciona una OT cerrada para auditar solo los desvios corregidos.</p>
            </div>
            <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700">
              {pendingReauditOrders.length} pendientes
            </span>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {pendingReauditOrders.map((order) => {
              const unit = fleetUnits.find((item) => item.id === order.unitId)
              return (
              <Link
                key={order.id}
                to={`${ROUTE_PATHS.audits}?workOrderId=${order.id}`}
                className="flex items-center justify-between rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-sky-100"
              >
                <span className="font-semibold">{order.code ?? 'OT'}</span>
                <span className="text-xs text-slate-500">Unidad {unit?.internalCode ?? order.unitId}</span>
              </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          {canCreate ? (
            <>
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">Nueva auditoria</h3>

                <label className="mt-4 flex flex-col gap-2">
                  <span className="text-sm font-semibold text-slate-700">Unidad</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                    value={formData.unitId}
                    onChange={(event) => {
                      setFormData((previousFormData) => ({
                        ...previousFormData,
                        unitId: event.target.value,
                      }))
                      setErrors((previousErrors) => ({ ...previousErrors, unitId: undefined }))
                    }}
                  >
                    <option value="">Seleccionar unidad</option>
                    {fleetUnits.map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.internalCode} - {unit.ownerCompany}
                      </option>
                    ))}
                  </select>
                  {errors.unitId ? <span className="text-xs font-semibold text-rose-700">{errors.unitId}</span> : null}
                </label>

                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                  <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                    KM unidad
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.unitKilometers === 0 ? '' : formData.unitKilometers}
                      onChange={(event) =>
                        setFormData((previousFormData) => ({
                          ...previousFormData,
                          unitKilometers: Number(event.target.value || 0),
                        }))
                      }
                    />
                    {errors.unitKilometers ? (
                      <span className="text-xs font-semibold text-rose-700">{errors.unitKilometers}</span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                    Horas motor
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.engineHours === 0 ? '' : formData.engineHours}
                      onChange={(event) =>
                        setFormData((previousFormData) => ({
                          ...previousFormData,
                          engineHours: Number(event.target.value || 0),
                        }))
                      }
                    />
                    {errors.engineHours ? (
                      <span className="text-xs font-semibold text-rose-700">{errors.engineHours}</span>
                    ) : null}
                  </label>

                  <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                    Horas hidrogrua
                    <input
                      type="number"
                      min={0}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.hydroHours === 0 ? '' : formData.hydroHours}
                      onChange={(event) =>
                        setFormData((previousFormData) => ({
                          ...previousFormData,
                          hydroHours: Number(event.target.value || 0),
                        }))
                      }
                    />
                    {errors.hydroHours ? (
                      <span className="text-xs font-semibold text-rose-700">{errors.hydroHours}</span>
                    ) : null}
                  </label>
                </div>

                <label className="mt-4 flex flex-col gap-2">
                  <span className="text-sm font-semibold text-slate-700">Observaciones generales</span>
                  <textarea
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                    rows={4}
                    value={formData.observations}
                    onChange={(event) => {
                      setFormData((previousFormData) => ({
                        ...previousFormData,
                        observations: event.target.value,
                      }))
                      setErrors((previousErrors) => ({ ...previousErrors, observations: undefined }))
                    }}
                  />
                  {errors.observations ? (
                    <span className="text-xs font-semibold text-rose-700">{errors.observations}</span>
                  ) : null}
                </label>

                <button
                  type="button"
                  onClick={handleSubmitAudit}
                  className="mt-5 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
                >
                  Crear auditoria
                </button>
              </section>

              <AuditPhotoPicker
                photoBase64List={formData.photoBase64List}
                onAddPhotoFiles={handleAddPhotoFiles}
                onRemovePhoto={handleRemovePhoto}
              />
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear auditorias.
            </section>
          )}
        </div>

        <div className="space-y-4 xl:col-span-2">
          {canCreate ? (
            <>
              <AuditChecklistEditor
                sections={formData.checklistSections}
                onItemStatusChange={handleItemStatusChange}
                onItemObservationChange={handleItemObservationChange}
              />

              {errors.checklistSections ? (
                <p className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700">
                  {errors.checklistSections}
                </p>
              ) : null}
            </>
          ) : null}

          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial por unidad</h3>
                <p className="mt-1 text-sm text-slate-600">Resultado automatico APROBADO / RECHAZADO y exportacion PDF.</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px_220px]">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Buscar
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Unidad, auditor, codigo..."
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Resultado
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={resultFilter}
                  onChange={(event) => setResultFilter(event.target.value as typeof resultFilter)}
                >
                  <option value="ALL">Todos</option>
                  <option value="APPROVED">Aprobados</option>
                  <option value="REJECTED">Rechazados</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Filtrar unidad
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                >
                  <option value={allUnitsFilter}>Todas</option>
                  {fleetUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.internalCode} - {unit.ownerCompany}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4">
              <AuditHistoryList
                items={filteredAuditHistory}
                onExportPdf={handleExportPdf}
                onRequestDelete={setAuditIdPendingDelete}
                canDelete={canDelete}
              />
            </div>
          </section>
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(auditIdPendingDelete)}
          title="Eliminar auditoria"
          message="Deseas eliminar esta auditoria? Esta accion no se puede deshacer."
          onCancel={() => setAuditIdPendingDelete(null)}
          onConfirm={handleConfirmDeleteAudit}
        />
      ) : null}
    </section>
  )
}
