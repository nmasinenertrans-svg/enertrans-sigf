import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { WorkOrderBoard } from '../components/WorkOrderBoard'
import { WorkOrderCard } from '../components/WorkOrderCard'
import { WorkOrderForm } from '../components/WorkOrderForm'
import {
  buildWorkOrderView,
  createEmptyWorkOrderFormData,
  mergeWorkOrderFromForm,
  normalizeTaskList,
  removeWorkOrderFromInventoryLinks,
  toWorkOrder,
  toWorkOrderFormData,
  updateInventoryLinks,
  validateWorkOrderFormData,
} from '../services/workOrdersService'
import type { WorkOrderFormData, WorkOrderFormErrors, WorkOrderFormField } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { apiRequest } from '../../../services/api/apiClient'
import { exportWorkOrderPdf } from '../services/workOrderPdfService'
import type { WorkOrder, WorkOrderDeviation, WorkOrderDeviationStatus, WorkOrderStatus } from '../../../types/domain'
import { BackLink } from '../../../components/shared/BackLink'

const allStatusesFilter = 'ALL'
const WORK_ORDER_DRAFT_KEY = 'enertrans.workOrderDraft'
const WORK_ORDER_RESOLUTION_DRAFT_KEY = 'enertrans.workOrderResolutionDraft'
const WORK_ORDER_DRAFT_TTL_MS = 24 * 60 * 60 * 1000

const hasResolutionEvidence = (task: WorkOrderDeviation): boolean =>
  Boolean((task.resolutionPhotoUrl ?? '').trim() || (task.resolutionPhotoBase64 ?? '').trim())

export const WorkOrdersPage = () => {
  const [searchParams] = useSearchParams()
  const { can } = usePermissions()
  const {
    state: { fleetUnits, inventoryItems, workOrders, featureFlags },
    actions: { setWorkOrders, setInventoryItems, setFleetUnits, setAppError },
  } = useAppContext()
  const manualAuditMode = featureFlags.manualAuditMode

  const canCreate = can('WORK_ORDERS', 'create')
  const canEdit = can('WORK_ORDERS', 'edit')
  const canDelete = can('WORK_ORDERS', 'delete')

  const [formData, setFormData] = useState<WorkOrderFormData>(() => createEmptyWorkOrderFormData(fleetUnits[0]?.id ?? ''))
  const [errors, setErrors] = useState<WorkOrderFormErrors>({})
  const [editingWorkOrderId, setEditingWorkOrderId] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<string>(allStatusesFilter)
  const [includeInProgress, setIncludeInProgress] = useState(false)
  const [pendingReauditOnly, setPendingReauditOnly] = useState(false)
  const [unitFilter, setUnitFilter] = useState<string>('ALL_UNITS')
  const [searchTerm, setSearchTerm] = useState('')
  const [workOrderIdPendingDelete, setWorkOrderIdPendingDelete] = useState<string | null>(null)
  const [resolveTarget, setResolveTarget] = useState<{ workOrderId: string; deviation: WorkOrderDeviation } | null>(null)
  const [resolutionNote, setResolutionNote] = useState('')
  const [resolutionPhoto, setResolutionPhoto] = useState<File | null>(null)
  const [resolutionPhotoBase64, setResolutionPhotoBase64] = useState('')
  const [draftChecked, setDraftChecked] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const workOrderViewList = useMemo(() => buildWorkOrderView(workOrders, fleetUnits), [workOrders, fleetUnits])

  const filteredWorkOrders = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    return workOrderViewList.filter((item) => {
      if (pendingReauditOnly && !item.pendingReaudit) {
        return false
      }
      if (statusFilter !== allStatusesFilter) {
        if (statusFilter === 'OPEN' && includeInProgress) {
          if (item.status !== 'OPEN' && item.status !== 'IN_PROGRESS') {
            return false
          }
        } else if (item.status !== statusFilter) {
          return false
        }
      }
      if (unitFilter !== 'ALL_UNITS' && item.unitId !== unitFilter) {
        return false
      }
      if (!normalizedSearch) {
        return true
      }
      const haystack = [item.unitLabel, item.code ?? '', item.laborDetail].join(' ').toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [statusFilter, includeInProgress, pendingReauditOnly, unitFilter, searchTerm, workOrderViewList])

  const boardSummary = useMemo(
    () => ({
      total: workOrderViewList.length,
      open: workOrderViewList.filter((item) => item.status === 'OPEN').length,
      inProgress: workOrderViewList.filter((item) => item.status === 'IN_PROGRESS').length,
      closed: workOrderViewList.filter((item) => item.status === 'CLOSED').length,
    }),
    [workOrderViewList],
  )

  const resetForm = () => {
    setEditingWorkOrderId(null)
    setErrors({})
    setFormData(createEmptyWorkOrderFormData(fleetUnits[0]?.id ?? ''))
    clearDraft()
  }

  function saveResolutionDraft(workOrderId: string, deviationId: string, note: string, photoBase64: string) {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(
        WORK_ORDER_RESOLUTION_DRAFT_KEY,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          workOrderId,
          deviationId,
          note,
          photoBase64,
        }),
      )
    } catch {
      // ignore
    }
  }

  function loadResolutionDraft(): {
    updatedAt: string
    workOrderId: string
    deviationId: string
    note: string
    photoBase64: string
  } | null {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      const raw = window.localStorage.getItem(WORK_ORDER_RESOLUTION_DRAFT_KEY)
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw) as {
        updatedAt?: string
        workOrderId?: string
        deviationId?: string
        note?: string
        photoBase64?: string
      }
      if (!parsed?.updatedAt || !parsed?.workOrderId || !parsed?.deviationId) {
        return null
      }
      return {
        updatedAt: parsed.updatedAt,
        workOrderId: parsed.workOrderId,
        deviationId: parsed.deviationId,
        note: parsed.note ?? '',
        photoBase64: parsed.photoBase64 ?? '',
      }
    } catch {
      return null
    }
  }

  function clearResolutionDraft() {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.removeItem(WORK_ORDER_RESOLUTION_DRAFT_KEY)
    } catch {
      // ignore
    }
  }

  function saveDraft(data: WorkOrderFormData, editingId: string | null) {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.setItem(
        WORK_ORDER_DRAFT_KEY,
        JSON.stringify({
          updatedAt: new Date().toISOString(),
          editingWorkOrderId: editingId,
          formData: data,
        }),
      )
    } catch {
      // ignore
    }
  }

  function loadDraft(): { updatedAt: string; editingWorkOrderId: string | null; formData: WorkOrderFormData } | null {
    if (typeof window === 'undefined') {
      return null
    }
    try {
      const raw = window.localStorage.getItem(WORK_ORDER_DRAFT_KEY)
      if (!raw) {
        return null
      }
      const parsed = JSON.parse(raw) as {
        updatedAt?: string
        editingWorkOrderId?: string | null
        formData?: WorkOrderFormData
      }
      if (!parsed?.updatedAt || !parsed?.formData) {
        return null
      }
      return {
        updatedAt: parsed.updatedAt,
        editingWorkOrderId: parsed.editingWorkOrderId ?? null,
        formData: parsed.formData,
      }
    } catch {
      return null
    }
  }

  function clearDraft() {
    if (typeof window === 'undefined') {
      return
    }
    try {
      window.localStorage.removeItem(WORK_ORDER_DRAFT_KEY)
    } catch {
      // ignore
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const statusParam = searchParams.get('status')
    const pendingParam = searchParams.get('pendingReaudit')
    const includeProgressParam = searchParams.get('includeInProgress')

    if (statusParam && (statusParam === 'OPEN' || statusParam === 'IN_PROGRESS' || statusParam === 'CLOSED')) {
      setStatusFilter(statusParam)
    } else {
      setStatusFilter(allStatusesFilter)
    }

    setIncludeInProgress(includeProgressParam === '1')
    setPendingReauditOnly(pendingParam === '1')
  }, [searchParams])

  useEffect(() => {
    if (!resolveTarget) {
      return
    }
    const draft = loadResolutionDraft()
    if (!draft) {
      return
    }
    if (draft.workOrderId !== resolveTarget.workOrderId || draft.deviationId !== resolveTarget.deviation.id) {
      return
    }
    const draftAge = Date.now() - new Date(draft.updatedAt).getTime()
    if (Number.isNaN(draftAge) || draftAge > WORK_ORDER_DRAFT_TTL_MS) {
      clearResolutionDraft()
      return
    }
    if (draft.note) {
      setResolutionNote(draft.note)
    }
    if (draft.photoBase64) {
      setResolutionPhotoBase64(draft.photoBase64)
      setResolutionPhoto(null)
    }
  }, [resolveTarget])

  useEffect(() => {
    if (!resolveTarget) {
      return
    }
    const handler = window.setTimeout(() => {
      saveResolutionDraft(resolveTarget.workOrderId, resolveTarget.deviation.id, resolutionNote, resolutionPhotoBase64)
    }, 800)

    return () => window.clearTimeout(handler)
  }, [resolveTarget, resolutionNote, resolutionPhotoBase64])

  useEffect(() => {
    if (draftChecked) {
      return
    }
    const draft = loadDraft()
    if (!draft) {
      setDraftChecked(true)
      return
    }
    const draftAge = Date.now() - new Date(draft.updatedAt).getTime()
    if (Number.isNaN(draftAge) || draftAge > WORK_ORDER_DRAFT_TTL_MS) {
      clearDraft()
      setDraftChecked(true)
      return
    }
    setEditingWorkOrderId(draft.editingWorkOrderId ?? null)
    setFormData(draft.formData)
    setDraftChecked(true)
  }, [draftChecked])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const handler = window.setTimeout(() => {
      saveDraft(formData, editingWorkOrderId)
    }, 800)

    return () => window.clearTimeout(handler)
  }, [formData, editingWorkOrderId])

  const handleFieldChange = <TField extends WorkOrderFormField>(field: TField, value: WorkOrderFormData[TField]) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      [field]: value,
    }))

    setErrors((previousErrors) => ({
      ...previousErrors,
      [field]: undefined,
    }))
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

  const handleSubmit = async () => {
    if (isSubmitting) {
      return
    }
    if (editingWorkOrderId ? !canEdit : !canCreate) {
      return
    }

    setIsSubmitting(true)
    try {
      const validationErrors = validateWorkOrderFormData(formData, fleetUnits)

      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors)
        return
      }

      if (editingWorkOrderId) {
        const selectedWorkOrder = workOrders.find((workOrder) => workOrder.id === editingWorkOrderId)

        if (!selectedWorkOrder) {
          resetForm()
          return
        }

        const updatedWorkOrder = mergeWorkOrderFromForm(selectedWorkOrder, formData)
        updatedWorkOrder.status = selectedWorkOrder.status
        const nextWorkOrders = workOrders.map((workOrder) =>
          workOrder.id === editingWorkOrderId ? updatedWorkOrder : workOrder,
        )

        setWorkOrders(nextWorkOrders)
        setInventoryItems(
          updateInventoryLinks(
            inventoryItems,
            editingWorkOrderId,
            selectedWorkOrder.linkedInventorySkuList,
            updatedWorkOrder.linkedInventorySkuList,
          ),
        )
        if (typeof navigator !== 'undefined' && navigator.onLine) {
          apiRequest(`/work-orders/${editingWorkOrderId}`, { method: 'PATCH', body: updatedWorkOrder }).catch(() => null)
        }
        resetForm()
        return
      }

      const unitCode = fleetUnits.find((unit) => unit.id === formData.unitId)?.internalCode ?? ''
      const createdWorkOrder = toWorkOrder(formData, unitCode)
      setWorkOrders([createdWorkOrder, ...workOrders])
      setInventoryItems(updateInventoryLinks(inventoryItems, createdWorkOrder.id, [], createdWorkOrder.linkedInventorySkuList))
      try {
        await enqueueAndSync({
          id: `workOrder.create.${createdWorkOrder.id}`,
          type: 'workOrder.create',
          payload: createdWorkOrder,
          createdAt: new Date().toISOString(),
        })
      } catch (error) {
        const message = isLikelyUnstableNetwork(error)
          ? 'Red inestable detectada. La OT quedo guardada localmente y se sincronizara cuando haya mejor conexion.'
          : 'No se pudo confirmar la OT en servidor. Quedo en cola para reintento.'
        setAppError(message)
      }
      resetForm()
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleEdit = (workOrderId: string) => {
    if (!canEdit) {
      return
    }

    const selectedWorkOrder = workOrders.find((workOrder) => workOrder.id === workOrderId)

    if (!selectedWorkOrder) {
      return
    }

    setEditingWorkOrderId(workOrderId)
    setFormData(toWorkOrderFormData(selectedWorkOrder))
  }

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!workOrderIdPendingDelete) {
      return
    }

    setWorkOrders(workOrders.filter((workOrder) => workOrder.id !== workOrderIdPendingDelete))
    setInventoryItems(removeWorkOrderFromInventoryLinks(inventoryItems, workOrderIdPendingDelete))

    if (editingWorkOrderId === workOrderIdPendingDelete) {
      resetForm()
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/work-orders/${workOrderIdPendingDelete}`, { method: 'DELETE' }).catch(() => null)
    }

    setWorkOrderIdPendingDelete(null)
  }

  const handleExportPdf = async (workOrderId: string) => {
    const workOrder = workOrders.find((item) => item.id === workOrderId)
    if (!workOrder) {
      return
    }
    const normalizedTasks = normalizeTaskList(workOrder.taskList)
    const unit = fleetUnits.find((item) => item.id === workOrder.unitId)
    try {
      await exportWorkOrderPdf({ workOrder: { ...workOrder, taskList: normalizedTasks }, unit })
    } catch {
      setAppError('No se pudo generar el PDF de la OT.')
    }
  }

  const handleResolveDeviation = (workOrderId: string, deviation: WorkOrderDeviation) => {
    setResolveTarget({ workOrderId, deviation })
    setResolutionNote(deviation.resolutionNote ?? '')
    setResolutionPhoto(null)
    setResolutionPhotoBase64(deviation.resolutionPhotoBase64 ?? '')
  }

  const handleSaveResolution = async () => {
    if (!resolveTarget) {
      return
    }

    if (!resolutionNote.trim() || (!resolutionPhoto && !resolutionPhotoBase64)) {
      setAppError('La foto y la descripcion de la reparacion son obligatorias.')
      return
    }

    const readFileAsDataUrl = (file: File): Promise<string> =>
      new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
        reader.onerror = () => reject(new Error('No se pudo leer la imagen.'))
        reader.readAsDataURL(file)
      })

    const photoBase64 = resolutionPhoto ? await readFileAsDataUrl(resolutionPhoto) : resolutionPhotoBase64
    let photoUrl = ''

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      try {
        const response = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: resolutionPhoto?.name
              ? `${resolveTarget.workOrderId}-${resolveTarget.deviation.id}-${resolutionPhoto.name}`
              : `${resolveTarget.workOrderId}-${resolveTarget.deviation.id}.jpg`,
            contentType: resolutionPhoto?.type || 'image/jpeg',
            dataUrl: photoBase64,
            folder: 'work-orders',
          },
        })
        photoUrl = response.url
      } catch {
        photoUrl = ''
      }
    }

    const updatedWorkOrders: WorkOrder[] = workOrders.map((order) => {
      if (order.id !== resolveTarget.workOrderId) {
        return order
      }

      const normalizedTasks = normalizeTaskList(order.taskList)
      const nextTasks: WorkOrderDeviation[] = normalizedTasks.map((task) =>
        task.id === resolveTarget.deviation.id
          ? {
              ...task,
              status: 'RESOLVED' as WorkOrderDeviationStatus,
              resolutionNote: resolutionNote.trim(),
              resolutionPhotoBase64: photoUrl ? '' : photoBase64,
              resolutionPhotoUrl: photoUrl,
              resolvedAt: new Date().toISOString(),
            }
          : task,
      )

      return { ...order, taskList: nextTasks }
    })

    setWorkOrders(updatedWorkOrders)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      const updatedWorkOrder = updatedWorkOrders.find((order) => order.id === resolveTarget.workOrderId)
      if (updatedWorkOrder) {
        apiRequest(`/work-orders/${resolveTarget.workOrderId}`, { method: 'PATCH', body: updatedWorkOrder }).catch(
          async (error) => {
            const message = String((error as Error)?.message ?? '')
            if (message.startsWith('404')) {
              await apiRequest('/work-orders', { method: 'POST', body: updatedWorkOrder })
              return
            }
          },
        )
      }
    }

    setResolveTarget(null)
    setResolutionNote('')
    setResolutionPhoto(null)
    setResolutionPhotoBase64('')
    clearResolutionDraft()
  }

  const handleCloseWorkOrder = async (workOrderId: string) => {
    const workOrder = workOrders.find((order) => order.id === workOrderId)
    if (!workOrder) {
      return
    }

    const normalizedTasks = normalizeTaskList(workOrder.taskList)
    const blockingTasks = normalizedTasks.filter((task) => task.status !== 'RESOLVED' || !hasResolutionEvidence(task))
    const allResolved = blockingTasks.length === 0

    if (!allResolved) {
      const sample = blockingTasks
        .slice(0, 2)
        .map((task) => `${task.section} / ${task.item}`)
        .join(' | ')
      setAppError(
        `No podes cerrar la OT. Hay ${blockingTasks.length} desvio(s) pendiente(s) o sin evidencia fotografica.${sample ? ` Ej: ${sample}` : ''}`,
      )
      return
    }

    const updatedWorkOrder: WorkOrder = {
      ...workOrder,
      status: 'CLOSED' as WorkOrderStatus,
      pendingReaudit: manualAuditMode ? false : true,
      taskList: normalizedTasks,
    }
    const nextWorkOrders = workOrders.map((order) => (order.id === workOrderId ? updatedWorkOrder : order))
    setWorkOrders(nextWorkOrders)

    setFleetUnits(
      fleetUnits.map((unit) =>
        unit.id === updatedWorkOrder.unitId ? { ...unit, operationalStatus: 'MAINTENANCE' } : unit,
      ),
    )

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/work-orders/${workOrderId}`, { method: 'PATCH', body: updatedWorkOrder }).catch(async (error) => {
        const message = String((error as Error)?.message ?? '')
        if (message.startsWith('404')) {
          await apiRequest('/work-orders', { method: 'POST', body: updatedWorkOrder })
          return
        }
      })
      const unitPayload = fleetUnits.find((unit) => unit.id === updatedWorkOrder.unitId)
      if (unitPayload) {
        apiRequest(`/fleet/${updatedWorkOrder.unitId}`, {
          method: 'PATCH',
          body: { ...unitPayload, operationalStatus: 'MAINTENANCE' },
        }).catch((error) => {
          const message = String((error as Error)?.message ?? '')
          if (message.startsWith('404')) {
            apiRequest('/fleet', { method: 'POST', body: { ...unitPayload, operationalStatus: 'MAINTENANCE' } }).catch(() => null)
          }
        })
      }
    }

    setAppError(
      manualAuditMode
        ? 'OT cerrada en modo manual. No se genero re-inspeccion automatica.'
        : 'OT cerrada. Se genero una re-inspeccion pendiente para el inspector.',
    )
  }

  if (fleetUnits.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Ordenes de Trabajo</h2>
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
        <h2 className="text-2xl font-bold text-slate-900">Ordenes de Trabajo</h2>
        <p className="text-sm text-slate-600">Creacion de OT, tareas, repuestos, mano de obra y vinculo con inventario.</p>
      </header>

      <WorkOrderBoard
        total={boardSummary.total}
        open={boardSummary.open}
        inProgress={boardSummary.inProgress}
        closed={boardSummary.closed}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {canCreate || canEdit ? (
            <WorkOrderForm
              fleetUnits={fleetUnits}
              inventoryItems={inventoryItems}
              formData={formData}
          errors={errors}
          isEditing={Boolean(editingWorkOrderId)}
          isSubmitting={isSubmitting}
          onFieldChange={handleFieldChange}
          onSubmit={() => {
            void handleSubmit()
          }}
          onCancelEdit={resetForm}
        />
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear o editar ordenes de trabajo.
            </section>
          )}
        </div>

        <div className="xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Listado de OT</h3>
                <p className="mt-1 text-sm text-slate-600">Visualizacion por estado operativo.</p>
              </div>
            </div>

            <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_220px_220px]">
              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Buscar
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Unidad, codigo, mano de obra..."
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Filtrar estado
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                >
                  <option value={allStatusesFilter}>Todos</option>
                  <option value="OPEN">Abierta</option>
                  <option value="IN_PROGRESS">En proceso</option>
                  <option value="CLOSED">Cerrada</option>
                </select>
              </label>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Filtrar unidad
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                >
                  <option value="ALL_UNITS">Todas</option>
                  {fleetUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.internalCode} - {unit.ownerCompany}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {filteredWorkOrders.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                  No hay ordenes para el filtro seleccionado.
                </div>
              ) : (
                filteredWorkOrders.map((item) => (
                  <div key={item.id} className="space-y-2">
                    <WorkOrderCard
                      item={item}
                      onEdit={handleEdit}
                      onDelete={setWorkOrderIdPendingDelete}
                      onExportPdf={handleExportPdf}
                      onResolveDeviation={handleResolveDeviation}
                      canEdit={canEdit}
                      canDelete={canDelete}
                    />
                    {item.status !== 'CLOSED' ? (
                      <button
                        type="button"
                        onClick={() => handleCloseWorkOrder(item.id)}
                        className="w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                      >
                        {manualAuditMode ? 'Cerrar OT (sin re-inspeccion automatica)' : 'Cerrar OT y solicitar re-inspeccion'}
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(workOrderIdPendingDelete)}
          title="Eliminar orden de trabajo"
          message="Deseas eliminar esta OT? Esta accion no se puede deshacer."
          onCancel={() => setWorkOrderIdPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      {resolveTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Resolver desvio</h3>
                <p className="text-xs text-slate-500">{resolveTarget.deviation.section} - {resolveTarget.deviation.item}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setResolveTarget(null)
                  setResolutionNote('')
                  setResolutionPhoto(null)
                  setResolutionPhotoBase64('')
                  clearResolutionDraft()
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cerrar
              </button>
            </div>

            <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Descripcion de la reparacion
              <textarea
                rows={3}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                value={resolutionNote}
                onChange={(event) => setResolutionNote(event.target.value)}
              />
            </label>

            <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Foto de la reparacion (obligatoria)
              <input
                type="file"
                accept="image/*"
                className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  setResolutionPhoto(file)
                  if (!file) {
                    setResolutionPhotoBase64('')
                    return
                  }
                  const reader = new FileReader()
                  reader.onload = () => setResolutionPhotoBase64(typeof reader.result === 'string' ? reader.result : '')
                  reader.onerror = () => setResolutionPhotoBase64('')
                  reader.readAsDataURL(file)
                }}
              />
            </label>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setResolveTarget(null)
                  setResolutionNote('')
                  setResolutionPhoto(null)
                  setResolutionPhotoBase64('')
                  clearResolutionDraft()
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveResolution}
                className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
              >
                Guardar resolucion
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}


