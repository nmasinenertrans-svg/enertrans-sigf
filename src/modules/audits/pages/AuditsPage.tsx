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
import { exportAuditPdf, exportBlankAuditChecklistPdf } from '../services/auditPdfService'
import {
  buildAuditHistoryView,
  CAMION_ITEMS,
  createChecklistFromDeviations,
  createEmptyAuditFormData,
  HIDROGUA_SECTIONS,
  createWorkOrderFromAudit,
  readImageAsCompressedDataUrl,
  readFileAsDataUrl,
  resultLabelMap,
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
const AUDIT_SUBMIT_TIMEOUT_MS = 25000
const MAX_AUDIT_PHOTOS = 30

export const AuditsPage = () => {
  const navigate = useNavigate()
  const { can } = usePermissions()
  const [searchParams] = useSearchParams()
  const {
    state: { currentUser, fleetUnits, audits, workOrders, externalRequests, featureFlags },
    actions: { setAudits, setGlobalLoading, setAppError, setWorkOrders, setFleetUnits },
  } = useAppContext()
  const manualAuditMode = featureFlags.manualAuditMode

  const canCreate = can('AUDITS', 'create')
  const canDelete = can('AUDITS', 'delete')
  const isHighHierarchy = currentUser?.role === 'DEV' || currentUser?.role === 'GERENTE'

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

  const pendingReauditOrders = useMemo(
    () => (manualAuditMode ? [] : workOrders.filter((order) => order.pendingReaudit)),
    [workOrders, manualAuditMode],
  )
  const isReauditMode = manualAuditMode ? false : Boolean(pendingWorkOrder)

  const [formData, setFormData] = useState<AuditFormData>(() => createEmptyAuditFormData(preferredUnitId))
  const [errors, setErrors] = useState<AuditFormErrors>({})
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [unitFilter, setUnitFilter] = useState<string>(allUnitsFilter)
  const [searchTerm, setSearchTerm] = useState('')
  const [resultFilter, setResultFilter] = useState<'ALL' | 'APPROVED' | 'REJECTED'>('ALL')
  const [auditIdPendingDelete, setAuditIdPendingDelete] = useState<string | null>(null)
  const [auditIdPendingView, setAuditIdPendingView] = useState<string | null>(null)
  const [draftChecked, setDraftChecked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isScanningSheet, setIsScanningSheet] = useState(false)

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
      auditMode: manualAuditMode ? 'INDEPENDENT' : previousFormData.auditMode,
      externalRequestId: manualAuditMode ? '' : previousFormData.externalRequestId,
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
  }, [preferredUnitId, fleetUnits, manualAuditMode])

  useEffect(() => {
    if (!manualAuditMode) {
      return
    }
    setFormData((previousFormData) => ({
      ...previousFormData,
      auditMode: 'INDEPENDENT',
      externalRequestId: '',
    }))
  }, [manualAuditMode])

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

    const defaults = createEmptyAuditFormData(draft.formData.unitId ?? '')
    setFormData({ ...defaults, ...draft.formData })
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
    if (manualAuditMode || !pendingWorkOrder) {
      return
    }

    setFormData((previousFormData) => ({
      ...previousFormData,
      unitId: pendingWorkOrder.unitId,
      auditMode: 'INDEPENDENT',
      externalRequestId: '',
      checklistSections: createChecklistFromDeviations(pendingWorkOrder.taskList ?? []),
    }))
    setUnitFilter(pendingWorkOrder.unitId ?? '')
  }, [pendingWorkOrder, manualAuditMode])

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

  const mapScanStatusToCheckStatus = (status: 'OK' | 'BAD' | 'NA'): string =>
    status === 'OK' ? 'B' : status === 'NA' ? 'NA' : 'O'

  const handleScanInspectionSheet = async (file: File) => {
    setIsScanningSheet(true)
    try {
      const dataUrl = await readImageAsCompressedDataUrl(file, {
        maxWidth: 1800,
        maxHeight: 1800,
        quality: 0.9,
        outputType: 'image/jpeg',
      })
      const result = await apiRequest<{
        header: { dominio: string; km: number | null; hidrogrua: string }
        checklistType: 'CAMION' | 'HIDROGUA'
        matchedItems: { itemCode: string; status: 'OK' | 'BAD' | 'NA'; observation: string }[]
        unmatchedNotes: { label: string; status: 'OK' | 'BAD' | 'NA' }[]
        overallConfidence: 'HIGH' | 'LOW'
      }>('/inspection-scan', { method: 'POST', body: { dataUrl }, timeoutMs: 45000 })

      const matchedUnit = result.header.dominio
        ? fleetUnits.find(
            (unit) => unit.internalCode.replace(/\s/g, '').toUpperCase() === result.header.dominio.replace(/\s/g, '').toUpperCase(),
          )
        : undefined

      setFormData((previous) => ({
        ...previous,
        checklistType: result.checklistType,
        vehicleMode: matchedUnit ? 'fleet' : previous.vehicleMode,
        unitId: matchedUnit ? matchedUnit.id : previous.unitId,
        unitKilometers: result.header.km ?? previous.unitKilometers,
        newChecklistItems: {
          ...previous.newChecklistItems,
          ...Object.fromEntries(
            result.matchedItems.map((item) => [
              item.itemCode,
              { estado: mapScanStatusToCheckStatus(item.status), obs: item.observation },
            ]),
          ),
        },
        scanUnmatchedNotes: result.unmatchedNotes.map((note) => ({ label: note.label, status: note.status })),
      }))

      const confidenceNote =
        result.overallConfidence === 'LOW'
          ? ' La IA no tuvo mucha confianza mapeando esta planilla — revisá con cuidado antes de guardar.'
          : ''
      setAppError(
        `Se completaron ${result.matchedItems.length} items automáticamente${matchedUnit ? ` para la unidad ${matchedUnit.internalCode}` : ''}` +
          `${result.unmatchedNotes.length > 0 ? ` y quedaron ${result.unmatchedNotes.length} notas sin poder mapear (se agregan igual, en una sección aparte)` : ''}.` +
          ` Revisá el checklist antes de guardar.${confidenceNote}`,
      )
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo leer la planilla.'))
    } finally {
      setIsScanningSheet(false)
    }
  }

  const handleAddPhotoFiles = async (fileList: FileList) => {
    const remainingSlots = MAX_AUDIT_PHOTOS - formData.photoBase64List.length
    if (remainingSlots <= 0) {
      setAppError(`Limite alcanzado: maximo ${MAX_AUDIT_PHOTOS} fotos por inspeccion.`)
      return
    }

    const filesToProcess = Array.from(fileList).slice(0, remainingSlots)
    if (filesToProcess.length < fileList.length) {
      setAppError(`Solo se agregaron ${filesToProcess.length} fotos. Limite: ${MAX_AUDIT_PHOTOS}.`)
    }

    try {
      setGlobalLoading(true)
      const photoDataList = await Promise.all(
        filesToProcess.map((file) =>
          readImageAsCompressedDataUrl(file, {
            maxWidth: 1280,
            maxHeight: 1280,
            quality: 0.65,
            outputType: 'image/jpeg',
          }),
        ),
      )

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

  const handleManualPdfFileChange = async (file: File | null) => {
    if (!file) {
      setFormData((previousFormData) => ({
        ...previousFormData,
        reportPdfFileName: '',
        reportPdfFileBase64: '',
        reportPdfFileUrl: '',
      }))
      setErrors((previousErrors) => ({ ...previousErrors, reportPdfFileBase64: undefined }))
      return
    }

    if (file.type !== 'application/pdf') {
      setErrors((previousErrors) => ({ ...previousErrors, reportPdfFileBase64: 'Solo se permite archivo PDF.' }))
      return
    }

    try {
      setGlobalLoading(true)
      const pdfData = await readFileAsDataUrl(file)
      setFormData((previousFormData) => ({
        ...previousFormData,
        reportPdfFileName: file.name,
        reportPdfFileBase64: pdfData,
        reportPdfFileUrl: '',
      }))
      setErrors((previousErrors) => ({ ...previousErrors, reportPdfFileBase64: undefined }))
    } catch {
      setErrors((previousErrors) => ({
        ...previousErrors,
        reportPdfFileBase64: 'No se pudo leer el PDF. Intenta nuevamente.',
      }))
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

  const mapServerAuditToClient = (audit: any) => ({
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
    reportPdfFileName:
      typeof audit.checklist?.meta?.reportPdfFileName === 'string'
        ? audit.checklist.meta.reportPdfFileName
        : undefined,
    reportPdfFileUrl:
      typeof audit.checklist?.meta?.reportPdfFileUrl === 'string'
        ? audit.checklist.meta.reportPdfFileUrl
        : undefined,
    checklistSections: Array.isArray(audit.checklist?.sections) ? audit.checklist.sections : [],
    unitKilometers: audit.unitKilometers ?? 0,
    engineHours: audit.engineHours ?? 0,
    hydroHours: audit.hydroHours ?? 0,
    syncState: 'SYNCED' as const,
  })

  const refreshAuditsFromServer = async () => {
    if (typeof navigator === 'undefined' || !navigator.onLine) {
      return
    }

    try {
      const auditsResponse = await apiRequest<any[]>('/audits', { timeoutMs: AUDIT_SUBMIT_TIMEOUT_MS })
      const mappedAudits = (auditsResponse ?? []).map((audit) => mapServerAuditToClient(audit))
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

  const uploadAuditPhotos = async (auditId: string, photos: string[]): Promise<string[]> => {
    const urls: string[] = []
    for (let index = 0; index < photos.length; index += 1) {
      const dataUrl = photos[index]
      const upload = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: {
          fileName: `audit-${auditId}-${index + 1}.jpg`,
          contentType: 'image/jpeg',
          dataUrl,
          folder: 'audits',
        },
        timeoutMs: AUDIT_SUBMIT_TIMEOUT_MS,
      })
      urls.push(upload.url)
    }
    return urls
  }

  const isLikelyUnstableNetwork = (error: unknown): boolean => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return true
    }
    const message = String((error as Error)?.message ?? '').toLowerCase()
    return (
      message.includes('timeout') ||
      message.includes('failed to fetch') ||
      message.includes('network') ||
      message.includes('abort')
    )
  }

  const withNetworkHint = (message: string, error: unknown): string =>
    isLikelyUnstableNetwork(error)
      ? `Red inestable detectada. ${message} Evita reenviar varias veces; el sistema reintentara sincronizar.`
      : message

  const handleSubmitAudit = async () => {
    if (isSubmitting) {
      return
    }
    if (!canCreate) {
      return
    }

    setIsSubmitting(true)
    try {
      const validationErrors = validateAuditFormData(formData, fleetUnits)
      if (manualAuditMode && !formData.reportPdfFileBase64) {
        validationErrors.reportPdfFileBase64 = 'Debes adjuntar el PDF de la inspeccion manual.'
      }

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
      const createdAuditBase = toAuditRecord(
        formData,
        auditorId,
        auditorName,
        workOrders,
        unitCode,
        externalRequestCode,
        { manualAuditMode },
      )
      let createdAudit = {
        ...createdAuditBase,
        syncState:
          typeof navigator !== 'undefined' && navigator.onLine
            ? ('PENDING' as const)
            : ('LOCAL_ONLY' as const),
      }

    if (manualAuditMode && createdAudit.reportPdfFileBase64 && typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        setGlobalLoading(true)
        const upload = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: createdAudit.reportPdfFileName || `audit-${createdAudit.id}.pdf`,
            contentType: 'application/pdf',
            dataUrl: createdAudit.reportPdfFileBase64,
            folder: 'audits',
          },
        })
        createdAudit = {
          ...createdAudit,
          reportPdfFileUrl: upload.url,
          reportPdfFileBase64: '',
        }
      } catch (error) {
        setAppError(withNetworkHint('No se pudo subir el PDF de la inspeccion manual.', error))
        return
      } finally {
        setGlobalLoading(false)
      }
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
          body: {
            currentKilometers: unitPayload.currentKilometers,
            currentEngineHours: unitPayload.currentEngineHours,
            currentHydroHours: unitPayload.currentHydroHours,
          },
        })
      } catch {
        return
      }
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void ensureRemoteUnit()
    }

    const workOrderPayload = !manualAuditMode && pendingWorkOrder
      ? { workOrderId: pendingWorkOrder.id, workOrderCode: pendingWorkOrder.code }
      : {}

    const isOnlineNow = typeof navigator !== 'undefined' && navigator.onLine
    let forceQueueFallback = false
    let onlinePhotoUrls = createdAudit.photoBase64List
    let usePreUploadedPhotoUrlsInQueue = false

    if (isOnlineNow && createdAudit.photoBase64List.length > 0) {
      try {
        setGlobalLoading(true)
        onlinePhotoUrls = await uploadAuditPhotos(createdAudit.id, createdAudit.photoBase64List)
      } catch (error) {
        forceQueueFallback = true
        setAppError(
          withNetworkHint(
            'No se pudieron subir las fotos de la inspeccion. Se guardara localmente y reintentara en segundo plano.',
            error,
          ),
        )
      } finally {
        setGlobalLoading(false)
      }
    }

    if (isOnlineNow && !forceQueueFallback) {
      const onlinePayload = {
        id: createdAudit.id,
        auditKind: createdAudit.auditKind,
        unitId: createdAudit.unitId,
        externalVehicle: createdAudit.externalVehicle ?? null,
        auditorUserId: createdAudit.auditorUserId,
        auditorName: createdAudit.auditorName,
        performedAt: createdAudit.performedAt,
        result: createdAudit.result,
        observations: createdAudit.observations,
        photoUrls: onlinePhotoUrls,
        checklist: {
          sections: createdAudit.checklistSections,
          meta: createdAudit.reportPdfFileUrl
            ? {
                reportPdfFileName: createdAudit.reportPdfFileName,
                reportPdfFileUrl: createdAudit.reportPdfFileUrl,
              }
            : undefined,
        },
        unitKilometers: createdAudit.unitKilometers,
        engineHours: createdAudit.engineHours,
        hydroHours: createdAudit.hydroHours,
        ...workOrderPayload,
      }

      try {
        const persistedAudit = await apiRequest<any>('/audits', {
          method: 'POST',
          body: onlinePayload,
          timeoutMs: AUDIT_SUBMIT_TIMEOUT_MS,
        })

        const syncedAudit = mapServerAuditToClient(persistedAudit)
        setAudits((previousAudits) => [syncedAudit, ...previousAudits.filter((audit) => audit.id !== syncedAudit.id)])
        clearDraft()
        if (isFormOpen) {
          setIsFormOpen(false)
          navigate(ROUTE_PATHS.audits, { replace: true })
        }
        resetAuditForm()
        await refreshAuditsFromServer()
        return
      } catch (error) {
        setAppError(
          withNetworkHint('No se pudo confirmar la inspeccion en servidor. Se guardara localmente hasta reintentar.', error),
        )
        if (onlinePhotoUrls.length > 0) {
          usePreUploadedPhotoUrlsInQueue = true
        }
      }
    }

    if (!manualAuditMode && createdAudit.result === 'REJECTED') {
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
        payload: {
          ...createdAudit,
          workOrderId: createdWorkOrder.id,
          workOrderCode: createdWorkOrder.code,
          photoUrls: usePreUploadedPhotoUrlsInQueue ? onlinePhotoUrls : undefined,
        },
        createdAt: new Date().toISOString(),
      }).then(async () => {
        const queueItems = await getQueueItems().catch(() => [])
        const stillQueued = queueItems.some((item) => item.id === `audit.create.${createdAudit.id}`)
        const onlineNow = typeof navigator !== 'undefined' && navigator.onLine
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: stillQueued ? (onlineNow ? ('ERROR' as const) : ('PENDING' as const)) : ('SYNCED' as const),
                  syncError: stillQueued && onlineNow ? 'No confirmada en servidor.' : undefined,
                }
              : audit,
          ),
        )
        if (stillQueued) {
          setAppError(
            onlineNow
              ? 'Inspeccion NO confirmada en servidor. Quedo local en este dispositivo.'
              : 'Inspeccion guardada localmente. Pendiente de sincronizacion.',
          )
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
        setAppError('No se pudo sincronizar la inspeccion. Quedo guardada localmente.')
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

      if (!manualAuditMode) {
        setWorkOrders(
          workOrders.map((order) =>
            order.unitId === createdAudit.unitId && order.pendingReaudit
              ? { ...order, pendingReaudit: false }
              : order,
          ),
        )
      }

      void enqueueAndSync({
        id: `audit.create.${createdAudit.id}`,
        type: 'audit.create',
        payload: {
          ...createdAudit,
          ...workOrderPayload,
          photoUrls: usePreUploadedPhotoUrlsInQueue ? onlinePhotoUrls : undefined,
        },
        createdAt: new Date().toISOString(),
      }).then(async () => {
        const queueItems = await getQueueItems().catch(() => [])
        const stillQueued = queueItems.some((item) => item.id === `audit.create.${createdAudit.id}`)
        const onlineNow = typeof navigator !== 'undefined' && navigator.onLine
        setAudits((previousAudits) =>
          previousAudits.map((audit) =>
            audit.id === createdAudit.id
              ? {
                  ...audit,
                  syncState: stillQueued ? (onlineNow ? ('ERROR' as const) : ('PENDING' as const)) : ('SYNCED' as const),
                  syncError: stillQueued && onlineNow ? 'No confirmada en servidor.' : undefined,
                }
              : audit,
          ),
        )
        if (stillQueued) {
          setAppError(
            onlineNow
              ? 'Inspeccion NO confirmada en servidor. Quedo local en este dispositivo.'
              : 'Inspeccion guardada localmente. Pendiente de sincronizacion.',
          )
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
        setAppError('No se pudo sincronizar la inspeccion. Quedo guardada localmente.')
      })

      if (!manualAuditMode && pendingWorkOrder && typeof navigator !== 'undefined' && navigator.onLine) {
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
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleExportPdf = async (auditId: string) => {
    const audit = audits.find((auditRecord) => auditRecord.id === auditId)

    if (!audit) {
      setAppError('No se encontro la inspeccion para exportar el PDF.')
      return
    }

    const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === audit.unitId)
    try {
      await exportAuditPdf({ audit, unit })
    } catch {
      setAppError('No se pudo generar el PDF de la inspeccion.')
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

  const handleBulkDismissReaudits = () => {
    if (pendingReauditOrders.length === 0) return

    setWorkOrders(
      workOrders.map((order) => (order.pendingReaudit ? { ...order, pendingReaudit: false } : order)),
    )

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      for (const order of pendingReauditOrders) {
        apiRequest(`/work-orders/${order.id}`, { method: 'PATCH', body: { pendingReaudit: false } }).catch(() => null)
      }
    }

    setAppError(`${pendingReauditOrders.length} re-inspeccion(es) cerradas forzosamente.`)
  }

  if (fleetUnits.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Inspecciones</h2>
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
        <h2 className="text-2xl font-bold text-slate-900">Inspecciones</h2>
        <p className="text-sm text-slate-600">
          {manualAuditMode
            ? 'Modo manual activo: PDF obligatorio, sin OT automatica y sin re-inspecciones automaticas.'
            : 'Checklist dinamico, observaciones, fotos y trazabilidad por unidad.'}
        </p>
      </header>

      {!isFormOpen && pendingReauditOrders.length > 0 ? (
        <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Re-inspecciones pendientes</p>
              <p className="mt-1 text-sm text-slate-700">Selecciona una OT cerrada para auditar solo los desvios corregidos.</p>
            </div>
            <div className="flex items-center gap-2">
              {isHighHierarchy ? (
                <button
                  type="button"
                  onClick={handleBulkDismissReaudits}
                  className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                >
                  Cerrar todas
                </button>
              ) : null}
              <span className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs font-semibold text-sky-700">
                {pendingReauditOrders.length} pendientes
              </span>
            </div>
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
                <span className="font-semibold">Realizar re-inspeccion</span>
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
                  {isReauditMode ? 'Re-inspeccion pendiente' : 'Nueva inspeccion'}
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

                <div className="mt-4 flex flex-col gap-2">
                  <span className="text-sm font-semibold text-slate-700">Vehículo</span>
                  {!isReauditMode && (
                    <div className="flex gap-1">
                      {(['fleet', 'external'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => setFormData((prev) => ({ ...prev, vehicleMode: mode, unitId: '', externalVehicle: '' }))}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${formData.vehicleMode === mode ? 'border-amber-400 bg-amber-400 text-slate-900' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-100'}`}
                        >
                          {mode === 'fleet' ? 'Flota' : 'Externo'}
                        </button>
                      ))}
                    </div>
                  )}
                  {formData.vehicleMode === 'fleet' ? (
                    <select
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.unitId ?? ''}
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
                  ) : (
                    <input
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={formData.externalVehicle}
                      onChange={(event) => {
                        setFormData((prev) => ({ ...prev, externalVehicle: event.target.value }))
                        setErrors((prev) => ({ ...prev, unitId: undefined }))
                      }}
                      placeholder="Ej: Ford F-100 — dominio ABC123"
                    />
                  )}
                  {errors.unitId ? <span className="text-xs font-semibold text-rose-700">{errors.unitId}</span> : null}
                </div>

                {!isReauditMode && !manualAuditMode ? (
                  <>
                    <label className="mt-4 flex flex-col gap-2">
                      <span className="text-sm font-semibold text-slate-700">Tipo de inspeccion</span>
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
                        <option value="INDEPENDENT">Inspeccion independiente</option>
                        <option value="EXTERNAL_REQUEST">Nota de pedido externo</option>
                      </select>
                    </label>
                    {formData.auditMode === 'INDEPENDENT' && (
                      <div className="mt-4">
                        <span className="text-sm font-semibold text-slate-700">Tipo de vehículo</span>
                        <div className="mt-2 flex gap-2">
                          {(['CAMION', 'HIDROGUA'] as const).map((t) => (
                            <button
                              key={t}
                              type="button"
                              onClick={() => setFormData((prev) => ({ ...prev, checklistType: t }))}
                              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${formData.checklistType === t ? 'border-amber-400 bg-amber-400 text-slate-900' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
                            >
                              {t === 'CAMION' ? 'Camión' : 'Hidrogrúa'}
                            </button>
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            if (formData.checklistType) {
                              void exportBlankAuditChecklistPdf(formData.checklistType)
                            }
                          }}
                          disabled={!formData.checklistType}
                          className="mt-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                        >
                          Imprimir checklist en blanco
                        </button>

                        <label className="mt-2 inline-flex cursor-pointer items-center rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-100">
                          {isScanningSheet ? 'Leyendo planilla con IA...' : 'Cargar desde planilla de papel (IA)'}
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={isScanningSheet}
                            onChange={(event) => {
                              const file = event.target.files?.[0]
                              if (file) {
                                void handleScanInspectionSheet(file)
                              }
                              event.target.value = ''
                            }}
                          />
                        </label>
                        <p className="mt-1 text-[11px] text-slate-500">
                          Sube una foto de la hoja de inspección manuscrita y la IA precompleta el checklist. Revisá
                          siempre antes de guardar.
                        </p>
                      </div>
                    )}
                  </>
                ) : null}

                {!isReauditMode && !manualAuditMode && formData.auditMode === 'EXTERNAL_REQUEST' ? (
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

                {manualAuditMode ? (
                  <>
                    <label className="mt-4 flex flex-col gap-2">
                      <span className="text-sm font-semibold text-slate-700">Resultado de la inspeccion manual</span>
                      <select
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                        value={formData.manualResult}
                        onChange={(event) =>
                          setFormData((previousFormData) => ({
                            ...previousFormData,
                            manualResult: event.target.value as 'APPROVED' | 'REJECTED',
                          }))
                        }
                      >
                        <option value="APPROVED">Aprobada</option>
                        <option value="REJECTED">Rechazada</option>
                      </select>
                    </label>

                    <label className="mt-4 flex flex-col gap-2">
                      <span className="text-sm font-semibold text-slate-700">PDF de inspeccion manual</span>
                      <input
                        type="file"
                        accept="application/pdf"
                        className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
                        onChange={(event) => void handleManualPdfFileChange(event.target.files?.[0] ?? null)}
                      />
                      {formData.reportPdfFileName ? (
                        <span className="text-xs text-slate-600">Archivo cargado: {formData.reportPdfFileName}</span>
                      ) : null}
                      {errors.reportPdfFileBase64 ? (
                        <span className="text-xs font-semibold text-rose-700">{errors.reportPdfFileBase64}</span>
                      ) : null}
                    </label>
                  </>
                ) : null}

                {formData.scanUnmatchedNotes.length > 0 ? (
                  <div className="mt-4 rounded-lg border border-sky-200 bg-sky-50 p-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-sky-800">
                      Notas de la planilla sin item correspondiente ({formData.scanUnmatchedNotes.length})
                    </p>
                    <p className="mt-1 text-[11px] text-sky-700">
                      Se van a guardar igual, en una sección aparte llamada "Inspección de campo (papel, sin
                      mapear)". Revisalas y sacá las que no correspondan.
                    </p>
                    <div className="mt-2 space-y-1.5">
                      {formData.scanUnmatchedNotes.map((note, index) => (
                        <div
                          key={`${note.label}-${index}`}
                          className="flex items-center justify-between gap-2 rounded-md border border-sky-200 bg-white px-2 py-1.5 text-xs text-slate-700"
                        >
                          <span>
                            <span
                              className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${note.status === 'BAD' ? 'bg-rose-100 text-rose-700' : note.status === 'NA' ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-700'}`}
                            >
                              {note.status}
                            </span>
                            {note.label}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setFormData((previous) => ({
                                ...previous,
                                scanUnmatchedNotes: previous.scanUnmatchedNotes.filter((_, i) => i !== index),
                              }))
                            }
                            className="font-semibold text-rose-600 hover:underline"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

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
                  disabled={isSubmitting}
                  className="mt-5 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting
                    ? 'Enviando...'
                    : isReauditMode
                      ? 'Cerrar re-inspeccion'
                      : manualAuditMode
                        ? 'Guardar inspeccion manual'
                        : 'Crear inspeccion'}
                </button>
              </section>

              {!manualAuditMode ? (
                <AuditPhotoPicker
                  photoBase64List={formData.photoBase64List}
                  onAddPhotoFiles={handleAddPhotoFiles}
                  onRemovePhoto={handleRemovePhoto}
                />
              ) : null}
            </>
          ) : !isFormOpen ? (
            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Historial de inspecciones</h3>
                  <p className="text-sm text-slate-600">Buscador por dominio y resultados.</p>
                </div>
                {canCreate ? (
                  <button
                    type="button"
                    onClick={() => setIsFormOpen(true)}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                  >
                    Crear nueva inspeccion
                  </button>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear inspecciones.
            </section>
          )}
        </div>

        <div className="space-y-4 xl:col-span-2">
          {canCreate && isFormOpen && formData.auditMode === 'INDEPENDENT' && !manualAuditMode ? (
            <>
              {formData.checklistType ? (
                <NewChecklistTable
                  checklistType={formData.checklistType}
                  items={formData.newChecklistItems}
                  certEnteCert={formData.certEnteCert}
                  certNro={formData.certNro}
                  certVenc={formData.certVenc}
                  certCapacidad={formData.certCapacidad}
                  cedulaVenc={formData.cedulaVenc}
                  tituloVenc={formData.tituloVenc}
                  vtvVenc={formData.vtvVenc}
                  seguroNroPol={formData.seguroNroPol}
                  seguroVenc={formData.seguroVenc}
                  onItemChange={(code, field, val) =>
                    setFormData((prev) => ({
                      ...prev,
                      newChecklistItems: { ...prev.newChecklistItems, [code]: { ...prev.newChecklistItems[code], [field]: val } },
                    }))
                  }
                  onFieldChange={(field, val) => setFormData((prev) => ({ ...prev, [field]: val }))}
                />
              ) : (
                <AuditChecklistEditor
                  sections={formData.checklistSections}
                  onItemStatusChange={handleItemStatusChange}
                  onItemObservationChange={handleItemObservationChange}
                />
              )}
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
          title="Eliminar inspeccion"
          message="Deseas eliminar esta inspeccion? Esta accion no se puede deshacer."
          onCancel={() => setAuditIdPendingDelete(null)}
          onConfirm={handleConfirmDeleteAudit}
        />
      ) : null}

      {viewAudit ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Inspeccion</p>
                <h3 className="text-lg font-bold text-slate-900">{viewAuditSummary?.code ?? viewAudit.id}</h3>
                <p className="text-sm text-slate-600">{viewAuditSummary?.unitLabel ?? viewAudit.unitId}</p>
                <p className="text-sm text-slate-600">
                  {new Date(viewAudit.performedAt).toLocaleString()} • {viewAudit.auditorName}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${viewAuditSummary?.resultClassName ?? ''}`}>
                  {viewAuditSummary?.resultLabel ?? resultLabelMap[viewAudit.result]}
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
            <div className="mt-3 grid gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 md:grid-cols-3">
              <p>
                <span className="font-semibold">KM motor:</span> {viewAudit.unitKilometers ?? 0}
              </p>
              <p>
                <span className="font-semibold">Horas motor:</span> {viewAudit.engineHours ?? 0}
              </p>
              <p>
                <span className="font-semibold">Horas hidrogrua:</span> {viewAudit.hydroHours ?? 0}
              </p>
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
              {viewAudit.reportPdfFileUrl ? (
                <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <span className="font-semibold">Informe PDF:</span>{' '}
                  <a
                    href={viewAudit.reportPdfFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="font-semibold text-amber-700 underline"
                  >
                    {viewAudit.reportPdfFileName || 'Ver archivo'}
                  </a>
                </div>
              ) : null}
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

// ─── NewChecklistTable ────────────────────────────────────────────────────────

type CheckStatus = 'B' | 'O' | 'NA' | ''

const STATUS_OPTIONS: { value: CheckStatus; label: string; color: string }[] = [
  { value: 'B', label: 'B', color: 'bg-emerald-500 text-white' },
  { value: 'O', label: 'O', color: 'bg-sky-500 text-white' },
  { value: 'NA', label: 'NA', color: 'bg-slate-400 text-white' },
]
const STATUS_LABEL: Record<string, string> = {
  B: 'Bien', O: 'Observación', NA: 'No Aplica',
}

function StatusPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {STATUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(value === opt.value ? '' : opt.value)}
          title={STATUS_LABEL[opt.value]}
          className={`rounded px-1.5 py-0.5 text-xs font-bold transition-opacity ${opt.color} ${value === opt.value ? 'opacity-100 ring-2 ring-offset-1 ring-slate-400' : 'opacity-40 hover:opacity-80'}`}
        >
          {opt.value}
        </button>
      ))}
    </div>
  )
}

function DocField({ label, vencValue, onVencChange, extraValue, extraLabel, onExtraChange }: {
  label: string; vencValue: string; onVencChange: (v: string) => void
  extraValue?: string; extraLabel?: string; onExtraChange?: (v: string) => void
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold uppercase text-slate-600">{label}</p>
      {extraLabel && onExtraChange && (
        <div>
          <label className="text-xs text-slate-500">{extraLabel}</label>
          <input value={extraValue ?? ''} onChange={(e) => onExtraChange(e.target.value)}
            className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-amber-400" />
        </div>
      )}
      <div>
        <label className="text-xs text-slate-500">Vencimiento</label>
        <input type="date" value={vencValue} onChange={(e) => onVencChange(e.target.value)}
          className="mt-0.5 w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-amber-400" />
      </div>
    </div>
  )
}

function NewChecklistTable({
  checklistType, items, onItemChange, onFieldChange,
  certEnteCert, certNro, certVenc, certCapacidad,
  cedulaVenc, tituloVenc, vtvVenc, seguroNroPol, seguroVenc,
}: {
  checklistType: 'HIDROGUA' | 'CAMION'
  items: Record<string, { estado: string; obs: string }>
  onItemChange: (code: string, field: 'estado' | 'obs', val: string) => void
  onFieldChange: (field: string, val: string) => void
  certEnteCert: string; certNro: string; certVenc: string; certCapacidad: string
  cedulaVenc: string; tituloVenc: string; vtvVenc: string; seguroNroPol: string; seguroVenc: string
}) {
  const safeItems = items ?? {}
  const allSections = checklistType === 'HIDROGUA' ? HIDROGUA_SECTIONS : null
  const flatItems = checklistType === 'CAMION' ? CAMION_ITEMS : null

  return (
    <div className="space-y-4">
      {/* Cert / Docs */}
      {checklistType === 'HIDROGUA' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-bold text-slate-900">Certificado</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Ente Certificador', certEnteCert, 'certEnteCert'],
              ['Nº Certificado', certNro, 'certNro'],
              ['Vencimiento', certVenc, 'certVenc'],
              ['Capacidad Certificada', certCapacidad, 'certCapacidad'],
            ].map(([label, val, key]) => (
              <div key={key} className="flex flex-col gap-0.5">
                <label className="text-xs font-semibold text-slate-500">{label}</label>
                <input value={val} onChange={(e) => onFieldChange(key, e.target.value)}
                  className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-amber-400" />
              </div>
            ))}
          </div>
        </div>
      )}
      {checklistType === 'CAMION' && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="mb-3 text-sm font-bold text-slate-900">Documentación</p>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <DocField label="Cédula" vencValue={cedulaVenc} onVencChange={(v) => onFieldChange('cedulaVenc', v)} />
            <DocField label="Título" vencValue={tituloVenc} onVencChange={(v) => onFieldChange('tituloVenc', v)} />
            <DocField label="VTV / RTO" vencValue={vtvVenc} onVencChange={(v) => onFieldChange('vtvVenc', v)} />
            <DocField label="Seguro" vencValue={seguroVenc} onVencChange={(v) => onFieldChange('seguroVenc', v)}
              extraLabel="Nº Póliza" extraValue={seguroNroPol} onExtraChange={(v) => onFieldChange('seguroNroPol', v)} />
          </div>
        </div>
      )}

      {/* Checklist table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-700 px-4 py-2.5">
          <p className="font-bold text-white text-sm">
            {checklistType === 'HIDROGUA' ? 'Inspección Técnica de Componentes' : 'Inspección Técnica del Vehículo'}
          </p>
        </div>
        <div className="grid grid-cols-[52px_1fr_200px_200px] border-b border-slate-200 bg-amber-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          <span>Cód.</span><span>Descripción</span><span className="text-center">Estado</span><span>Observaciones</span>
        </div>

        {allSections ? allSections.map((section) => (
          <div key={section.name}>
            <div className="bg-slate-100 px-3 py-1.5">
              <span className="text-xs font-bold uppercase tracking-wide text-slate-600">{section.name}</span>
            </div>
            {section.items.map((item) => (
              <div key={item.code} className="grid grid-cols-[52px_1fr_200px_200px] items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
                <span className="font-mono text-xs font-semibold text-slate-400">{item.code}</span>
                <span className="pr-3 text-sm text-slate-700">{item.desc}</span>
                <div className="flex justify-center">
                  <StatusPicker value={safeItems[item.code]?.estado ?? ''} onChange={(v) => onItemChange(item.code, 'estado', v)} />
                </div>
                <input value={safeItems[item.code]?.obs ?? ''} onChange={(e) => onItemChange(item.code, 'obs', e.target.value)}
                  placeholder="Obs..." className="rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400" />
              </div>
            ))}
          </div>
        )) : flatItems?.map((item) => (
          <div key={item.code} className="grid grid-cols-[52px_1fr_200px_200px] items-center border-b border-slate-100 px-3 py-2 hover:bg-slate-50">
            <span className="font-mono text-xs font-semibold text-slate-400">{item.code}</span>
            <span className="pr-3 text-sm text-slate-700">{item.desc}</span>
            <div className="flex justify-center">
              <StatusPicker value={safeItems[item.code]?.estado ?? ''} onChange={(v) => onItemChange(item.code, 'estado', v)} />
            </div>
            <input value={safeItems[item.code]?.obs ?? ''} onChange={(e) => onItemChange(item.code, 'obs', e.target.value)}
              placeholder="Obs..." className="rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-amber-400" />
          </div>
        ))}

        {/* Referencias */}
        <div className="flex flex-wrap gap-1.5 px-3 py-3 bg-slate-50 border-t border-slate-200">
          {STATUS_OPTIONS.map((opt) => (
            <span key={opt.value} className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${opt.color}`}>
              {opt.value} <span className="font-normal opacity-90">{STATUS_LABEL[opt.value]}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}



