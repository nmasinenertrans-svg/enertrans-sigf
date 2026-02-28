import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
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
import { getQueueItems } from '../../../services/offline/queue'
import { BackLink } from '../../../components/shared/BackLink'
import { apiRequest } from '../../../services/api/apiClient'

const allUnitsFilter = 'ALL_UNITS'
const AUDIT_DRAFT_KEY = 'enertrans.auditDraft'
const AUDIT_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export const AuditsPage = () => {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const [searchParams] = useSearchParams()
  const {
    state: { currentUser, fleetUnits, audits, workOrders, externalRequests },
    actions: { setAudits, setGlobalLoading, setAppError, setWorkOrders, setFleetUnits },
  } = useAppContext()

  const canCreate = can('AUDITS', 'create')
  const canDelete = can('AUDITS', 'delete')

  const pendingReauditParam = searchParams.get('pendingReaudit')
  const createParam = searchParams.get('create')
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
  const isReauditMode = Boolean(pendingWorkOrder)

  const [formData, setFormData] = useState<AuditFormData>(() => createEmptyAuditFormData(preferredUnitId))
  const [errors, setErrors] = useState<AuditFormErrors>({})
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [unitFilter, setUnitFilter] = useState<string>(allUnitsFilter)
  const [searchTerm, setSearchTerm] = useState('')
  const [resultFilter, setResultFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL')
  const [auditIdPendingDelete, setAuditIdPendingDelete] = useState<string | null>(null)
  const [auditIdPendingView, setAuditIdPendingView] = useState<string | null>(null)
  const [draftChecked, setDraftChecked] = useState(false)

  const auditHistory = useMemo(() => buildAuditHistoryView(audits, fleetUnits), [audits, fleetUnits])
  const viewAudit = useMemo(() => audits.find((audit) => audit.id === auditIdPendingView) ?? null, [audits, auditIdPendingView])
  const viewAuditSummary = useMemo(
    () => auditHistory.find((item) => item.id === auditIdPendingView) ?? null,
    [auditHistory, auditIdPendingView],
  )
  const viewChecklistSections = useMemo(() => {
    if (!viewAudit) {
      return []
    }
    return viewAudit.checklistSections.map((section) => ({
      id: section.id,
      title: section.title,
      items: section.items.map((item) => ({
        id: item.id,
        label: item.label,
        status: item.status,
        observation: item.observation,
      })),
    }))
  }, [viewAudit])

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

  const saveDraft = (data: AuditFormData) => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(
        AUDIT_DRAFT_KEY,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          formData: data,
        }),
      )
    } catch {
      // ignore storage errors
    }
  }

  const loadDraft = (): { updatedAt: string; formData: AuditFormData } | null => {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      const raw = window.localStorage.getItem(AUDIT_DRAFT_KEY)
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw) as { updatedAt?: string; formData?: AuditFormData }
      if (!parsed?.updatedAt || !parsed?.formData) {
        return null
      }
      return { updatedAt: parsed.updatedAt, formData: parsed.formData }
    } catch {
      return null
    }
  }

  const clearDraft = () => {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.removeItem(AUDIT_DRAFT_KEY)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    if (!preferredUnitId) {
      return
    }

    const selectedUnit = fleetUnits.find((unit) => unit.id === preferredUnitId)

    setFormData((previousFormData) => ({
      ...previousFormData,
      unitId: preferredUnitId,
      auditMode: 'INDEPENDENT',
      externalRequestId: '',
      unitKilometers: selectedUnit?.currentKilometers ?? 0,
      engineHours: selectedUnit?.currentEngineHours ?? 0,
      hydroHours: selectedUnit?.currentHydroHours ?? 0,
    }))
    setUnitFilter((previousFilter) => {
      if (previousFilter === allUnitsFilter) {
        return previousFilter
      }

      if (fleetUnits.some((unit) => unit.id === previousFilter)) {
        return previousFilter
      }

      return preferredUnitId || allUnitsFilter
    })
  }, [preferredUnitId, fleetUnits])

  useEffect(() => {
    if (pendingWorkOrder || createParam === '1') {
      setIsFormOpen(true)
    } else if (!pendingWorkOrder) {
      setIsFormOpen(false)
    }
  }, [pendingWorkOrder, createParam])

  useEffect(() => {
    if (!isFormOpen || isReauditMode || draftChecked) {
      return
    }

    const draft = loadDraft()
    if (!draft) {
      setDraftChecked(true)
      return
    }

    const draftAge = Date.now() - new Date(draft.updatedAt).getTime()
    if (Number.isNaN(draftAge) || draftAge > AUDIT_DRAFT_TTL_MS) {
      clearDraft()
      setDraftChecked(true)
      return
    }

    setFormData(draft.formData)
    setDraftChecked(true)
  }, [isFormOpen, isReauditMode, draftChecked])

  useEffect(() => {
    if (!isFormOpen || isReauditMode) {
      return
    }

    const handler = window.setTimeout(() => {
      saveDraft(formData)
    }, 800)

    return () => window.clearTimeout(handler)
  }, [formData, isFormOpen, isReauditMode])

  useEffect(() => {
    if (!pendingWorkOrder) {
      return
    }

    setFormData((previousFormData) => ({
      ...previousFormData,
      unitId: pendingWorkOrder.unitId,
      auditMode: 'INDEPENDENT',
      externalRequestId: '',
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

  const refreshAuditsFromServer = async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return
    }

    try {
      const auditsResponse = await apiRequest<any[]>('/audits')
      const mappedAudits = (auditsResponse ?? []).map((audit) => ({
        id: audit.id,
        code: audit.code,
        auditKind: audit.auditKind ?? 'AUDIT',
        unitId: audit.unitId,
        auditorUserId: audit.auditorUserId,
        auditorName: audit.auditorName,
        performedAt: audit.performedAt,
        result: audit.result,
        observations: audit.observations ?? '',
        photoBase64List: Array.isArray(audit.photoUrls) ? audit.photoUrls : [],
        checklistSections: Array.isArray(audit.checklist?.sections) ? audit.checklist.sections : [],
        unitKilometers: audit.unitKilometers ?? 0,
        engineHours: audit.engineHours ?? 0,
        hydroHours: audit.hydroHours ?? 0,
        syncState: 'SYNCED' as const,
      }))
      const remoteIds = new Set(mappedAudits.map((audit) => audit.id))
      setAudits((previousAudits) => {
        const localPendingOrError = previousAudits.filter(
          (audit) =>
            audit.id &&
            !remoteIds.has(audit.id) &&
            (audit.syncState === 'PENDING' ||
              audit.syncState === 'ERROR' ||
              audit.syncState === 'LOCAL_ONLY'),
        )

        return [...mappedAudits, ...localPendingOrError].sort(
          (left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime(),
        )
      })
    } catch {
      // keep local state on refresh failures
    }
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
    const selectedExternalRequest = externalRequests.find((item) => item.id === formData.externalRequestId)
    const externalRequestCode = selectedExternalRequest?.code
    const createdAuditBase = toAuditRecord(formData, auditorId, auditorName, workOrders, unitCode, externalRequestCode)
    const createdAudit = {
      ...createdAuditBase,
      syncState:
        typeof navigator !== 'undefined' && navigator.onLine
          ? ('PENDING' as const)
          : ('LOCAL_ONLY' as const),
    }

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

    const ensureRemoteUnit = async () => {
      if (typeof navigator === 'undefined' || !navigator.onLine || !selectedUnit) {
        return
      }

      const unitPayload = {
        ...selectedUnit,
        currentKilometers: createdAudit.unitKilometers,
        currentEngineHours: createdAudit.engineHours,
        currentHydroHours: createdAudit.hydroHours,
      }

      try {
        await apiRequest(`/fleet/${createdAudit.unitId}`, {
          method: 'PATCH',
          body: unitPayload,
        })
      } catch (error) {
        const message = String((error as Error)?.message ?? '')
        if (message.startsWith('404')) {
          await apiRequest('/fleet', { method: 'POST', body: unitPayload })
          return
        }
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void ensureRemoteUnit()
    }

    const workOrderPayload = pendingWorkOrder
      ? { workOrderId: pendingWorkOrder.id, workOrderCode: pendingWorkOrder.code }
      : {}

    if (createdAudit.result === 'REJECTED') {
      const createdWorkOrder = createWorkOrderFromAudit(createdAudit, unitCode)
      setWorkOrders([createdWorkOrder, ...workOrders])
      setFleetUnits(
        updatedFleetUnits.map((unit) =>
          unit.id === createdAudit.unitId ? { ...unit, operationalStatus: 'OUT_OF_SERVICE' } : unit,
        ),
      )

      void enqueueAndSync({
        id: `audit.create.${createdAudit.id}`,
        type: 'audit.create',
        payload: { ...createdAudit, workOrderId: createdWorkOrder.id, workOrderCode: createdWorkOrder.code },
        createdAt: new Date().toISOString(),
      }).then(async () => {
        const queueItems = await getQueueItems().catch(() => [])
        const stillQueued = queueItems.some((item) => item.id === `audit.create.${createdAudit.id}`)
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: stillQueued ? ('PENDING' as const) : ('SYNCED' as const),
                }
              : audit,
          ),
        )
        if (stillQueued) {
          setAppError('Auditoria guardada localmente. Pendiente de sincronizacion.')
        } else {
          await refreshAuditsFromServer()
        }
      }).catch(() => {
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: 'ERROR',
                  syncError: 'No se pudo sincronizar.',
                }
              : audit,
          ),
        )
        setAppError('No se pudo sincronizar la auditoria. Quedo guardada localmente.')
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

      void enqueueAndSync({
        id: `audit.create.${createdAudit.id}`,
        type: 'audit.create',
        payload: { ...createdAudit, ...workOrderPayload },
        createdAt: new Date().toISOString(),
      }).then(async () => {
        const queueItems = await getQueueItems().catch(() => [])
        const stillQueued = queueItems.some((item) => item.id === `audit.create.${createdAudit.id}`)
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: stillQueued ? ('PENDING' as const) : ('SYNCED' as const),
                }
              : audit,
          ),
        )
        if (stillQueued) {
          setAppError('Auditoria guardada localmente. Pendiente de sincronizacion.')
        } else {
          await refreshAuditsFromServer()
        }
      }).catch(() => {
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: 'ERROR',
                  syncError: 'No se pudo sincronizar.',
                }
              : audit,
          ),
        )
        setAppError('No se pudo sincronizar la auditoria. Quedo guardada localmente.')
      })

      if (pendingWorkOrder && typeof navigator !== 'undefined' && navigator.onLine) {
        apiRequest(`/work-orders/${pendingWorkOrder.id}`, {
          method: 'PATCH',
          body: { pendingReaudit: false },
        }).catch(() => null)
      }
    }

    setAudits((previousAudits) => [createdAudit, ...previousAudits.filter((audit) => audit.id !== createdAudit.id)])
    resetAuditForm()
    clearDraft()
    if (isFormOpen) {
      setIsFormOpen(false)
      navigate(ROUTE_PATHS.audits, { replace: true })
    }
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

    setAudits((previousAudits) => previousAudits.filter((audit) => audit.id !== auditIdPendingDelete))
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

      {!isFormOpen && pendingReauditOrders.length > 0 ? (
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
                to={`${ROUTE_PATHS.audits}?workOrderId=${order.id}&create=1`}
                className="flex items-center justify-between rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-sky-100"
              >
                <span className="font-semibold">Realizar re-auditoria</span>
                <span className="text-xs text-slate-500">{order.code ?? 'OT'} • {unit?.internalCode ?? order.unitId}</span>
              </Link>
              )
            })}
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          {canCreate && isFormOpen ? (
            <>
              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">
                  {isReauditMode ? 'Re-auditoria pendiente' : 'Nueva auditoria'}
                </h3>
                {isReauditMode && pendingWorkOrder ? (
                  <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-slate-700">
                    OT {pendingWorkOrder.code ?? 'OT'} • Unidad{' '}
                    {fleetUnits.find((unit) => unit.id === pendingWorkOrder.unitId)?.internalCode ?? pendingWorkOrder.unitId}
                  </div>
                ) : null}
                {!isReauditMode ? (
                  <button
                    type="button"
                    onClick={() => {
                      setIsFormOpen(false)
                      navigate(ROUTE_PATHS.audits, { replace: true })
                    }}
                    className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                  >
                    Volver al listado
                  </button>
                ) : null}

                <label className="mt-4 flex flex-col gap-2">
                  <span className="text-sm font-semibold text-slate-700">Unidad</span>
                  <select
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                    value={formData.unitId}
                    disabled={isReauditMode}
                    onChange={(event) => {
                      setFormData((previousFormData) => ({
                        ...previousFormData,
                        unitId: event.target.value,
                        auditMode: 'INDEPENDENT',
                        externalRequestId: '',
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

                {!isReauditMode ? (
                  <label className="mt-4 flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">Tipo de auditoria</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.auditMode}
                      onChange={(event) => {
                        const nextMode = event.target.value as AuditFormData['auditMode']
                        setFormData((previousFormData) => ({
                          ...previousFormData,
                          auditMode: nextMode,
                          externalRequestId: nextMode === 'EXTERNAL_REQUEST' ? previousFormData.externalRequestId : '',
                        }))
                        setErrors((previousErrors) => ({ ...previousErrors, auditMode: undefined, externalRequestId: undefined }))
                      }}
                    >
                      <option value="INDEPENDENT">Auditoria independiente</option>
                      <option value="EXTERNAL_REQUEST">Nota de pedido externo</option>
                    </select>
                  </label>
                ) : null}

                {!isReauditMode && formData.auditMode === 'EXTERNAL_REQUEST' ? (
                  <label className="mt-4 flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">Nota de pedido vinculada</span>
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.externalRequestId}
                      onChange={(event) => {
                        setFormData((previousFormData) => ({
                          ...previousFormData,
                          externalRequestId: event.target.value,
                        }))
                        setErrors((previousErrors) => ({ ...previousErrors, externalRequestId: undefined }))
                      }}
                    >
                      <option value="">Seleccionar nota de pedido</option>
                      {externalRequests
                        .filter((item) => item.unitId === formData.unitId)
                        .map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.code} - {item.companyName}
                          </option>
                        ))}
                    </select>
                    {errors.externalRequestId ? (
                      <span className="text-xs font-semibold text-rose-700">{errors.externalRequestId}</span>
                    ) : null}
                  </label>
                ) : null}

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
                  {isReauditMode ? 'Cerrar re-auditoria' : 'Crear auditoria'}
                </button>
              </section>

              <AuditPhotoPicker
                photoBase64List={formData.photoBase64List}
                onAddPhotoFiles={handleAddPhotoFiles}
                onRemovePhoto={handleRemovePhoto}
              />
            </>
          ) : !isFormOpen ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Historial de auditorias</h3>
                  <p className="text-sm text-slate-600">Buscador por dominio y resultados.</p>
                </div>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(true)}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                  >
                    Crear nueva auditoria
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear auditorias.
            </section>
          )}
        </div>

        <div className="space-y-4 xl:col-span-2">
          {canCreate && isFormOpen && formData.auditMode === 'INDEPENDENT' ? (
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

          {!isFormOpen ? (
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
                onViewAudit={setAuditIdPendingView}
                onExportPdf={handleExportPdf}
                onRequestDelete={setAuditIdPendingDelete}
                canDelete={canDelete}
              />
            </div>
            </section>
          ) : null}
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

      {viewAudit ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Auditoria</p>
                <h3 className="text-lg font-bold text-slate-900">{viewAuditSummary?.code ?? viewAudit.id}</h3>
                <p className="text-sm text-slate-600">{viewAuditSummary?.unitLabel ?? viewAudit.unitId}</p>
                <p className="text-sm text-slate-600">
                  {new Date(viewAudit.performedAt).toLocaleString()} • {viewAudit.auditorName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${viewAuditSummary?.resultClassName ?? ''}`}>
                  {viewAuditSummary?.resultLabel ?? viewAudit.result}
                </span>
                <button
                  type="button"
                  onClick={() => setAuditIdPendingView(null)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cerrar
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-semibold">Observaciones:</span> {viewAudit.observations || 'Sin observaciones.'}
            </div>

            <div className="mt-4">
              <AuditChecklistEditor
                sections={viewChecklistSections}
                onItemStatusChange={() => null}
                onItemObservationChange={() => null}
                readOnly
              />
            </div>

            <div className="mt-4">
              <h4 className="text-sm font-semibold text-slate-700">Fotos</h4>
              {viewAudit.photoBase64List.length === 0 ? (
                <p className="mt-1 text-sm text-slate-500">No se adjuntaron fotos.</p>
              ) : (
                <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
                  {viewAudit.photoBase64List.map((photo, index) => (
                    <div
                      key={`${viewAudit.id}-photo-${index}`}
                      className="overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
                    >
                      <div className="aspect-[4/3] w-full">
                        <img
                          src={photo}
                          alt={`Foto ${index + 1}`}
                          className="h-full w-full object-contain"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

