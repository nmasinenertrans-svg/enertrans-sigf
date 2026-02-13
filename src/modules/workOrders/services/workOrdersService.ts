import type { FleetUnit, InventoryItem, WorkOrder, WorkOrderDeviation, WorkOrderStatus } from '../../../types/domain'
import type { WorkOrderFormData, WorkOrderFormErrors, WorkOrderViewItem } from '../types'
import { getNextSequenceCode } from '../../../services/sequence'

const MIN_TASK_ITEMS = 1
const MAX_LABOR_DETAIL_LENGTH = 300

const fallbackWorkOrderStatus: WorkOrderStatus = 'OPEN'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `work-order-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const parseListInput = (rawInput: string): string[] =>
  rawInput
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

const serializeList = (items: string[]): string => items.join('\n')

const buildLegacyTaskId = (section: string, item: string, observation: string): string => {
  const raw = `${section}|${item}|${observation}`.toLowerCase().trim()
  if (!raw) {
    return createId()
  }
  const compact = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `legacy-${compact.slice(0, 60) || createId()}`
}

export const normalizeTaskList = (taskList: WorkOrder['taskList']): WorkOrderDeviation[] =>
  (Array.isArray(taskList) ? taskList : []).map((task: any) => {
    const section = task?.section ?? 'GENERAL'
    const item = task?.item ?? (typeof task === 'string' ? task : 'Desvio')
    const observation = task?.observation ?? ''
    const id = task?.id ?? buildLegacyTaskId(section, item, observation)

    return {
      id,
      section,
      item,
      observation,
      status: task?.status ?? 'PENDING',
      resolutionNote: task?.resolutionNote ?? '',
      resolutionPhotoBase64: task?.resolutionPhotoBase64 ?? '',
      resolutionPhotoUrl: task?.resolutionPhotoUrl ?? '',
      resolvedAt: task?.resolvedAt,
    }
  })

const buildTaskListFromInput = (tasksInput: string): WorkOrderDeviation[] =>
  parseListInput(tasksInput).map((line) => ({
    id: createId(),
    section: 'GENERAL',
    item: line,
    observation: '',
    status: 'PENDING',
    resolutionNote: '',
    resolutionPhotoBase64: '',
    resolutionPhotoUrl: '',
  }))

export const workOrderStatusLabelMap: Record<WorkOrderStatus, string> = {
  OPEN: 'ABIERTA',
  IN_PROGRESS: 'EN PROCESO',
  CLOSED: 'CERRADA',
}

export const workOrderStatusClassMap: Record<WorkOrderStatus, string> = {
  OPEN: 'border-sky-300 bg-sky-50 text-sky-700',
  IN_PROGRESS: 'border-amber-300 bg-amber-50 text-amber-700',
  CLOSED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
}

export const createEmptyWorkOrderFormData = (unitId: string): WorkOrderFormData => ({
  unitId,
  status: fallbackWorkOrderStatus,
  tasksInput: '',
  sparePartsInput: '',
  laborDetail: '',
  linkedInventorySkuList: [],
})

export const toWorkOrderFormData = (workOrder: WorkOrder): WorkOrderFormData => ({
  unitId: workOrder.unitId,
  status: workOrder.status,
  tasksInput: serializeList(normalizeTaskList(workOrder.taskList).map((task) => task.item)),
  sparePartsInput: serializeList(workOrder.spareParts),
  laborDetail: workOrder.laborDetail,
  linkedInventorySkuList: workOrder.linkedInventorySkuList,
})

export const validateWorkOrderFormData = (
  formData: WorkOrderFormData,
  fleetUnits: FleetUnit[],
): WorkOrderFormErrors => {
  const validationErrors: WorkOrderFormErrors = {}

  if (!formData.unitId) {
    validationErrors.unitId = 'Debes seleccionar una unidad.'
  } else if (!fleetUnits.some((unit) => unit.id === formData.unitId)) {
    validationErrors.unitId = 'La unidad seleccionada no existe.'
  }

  if (parseListInput(formData.tasksInput).length < MIN_TASK_ITEMS) {
    validationErrors.tasksInput = 'Debes ingresar al menos un desvio.'
  }

  if (!formData.laborDetail.trim()) {
    validationErrors.laborDetail = 'La mano de obra es obligatoria.'
  } else if (formData.laborDetail.length > MAX_LABOR_DETAIL_LENGTH) {
    validationErrors.laborDetail = 'La mano de obra supera el largo maximo permitido.'
  }

  return validationErrors
}

export const toWorkOrder = (formData: WorkOrderFormData, unitCode: string): WorkOrder => ({
  id: createId(),
  unitId: formData.unitId,
  status: formData.status,
  createdAt: new Date().toISOString(),
  taskList: buildTaskListFromInput(formData.tasksInput),
  spareParts: parseListInput(formData.sparePartsInput),
  laborDetail: formData.laborDetail.trim(),
  linkedInventorySkuList: formData.linkedInventorySkuList,
  code: getNextSequenceCode('workOrder', 'OT', unitCode),
  pendingReaudit: false,
})

export const mergeWorkOrderFromForm = (workOrder: WorkOrder, formData: WorkOrderFormData): WorkOrder => ({
  ...workOrder,
  unitId: formData.unitId,
  status: formData.status,
  taskList: buildTaskListFromInput(formData.tasksInput),
  spareParts: parseListInput(formData.sparePartsInput),
  laborDetail: formData.laborDetail.trim(),
  linkedInventorySkuList: formData.linkedInventorySkuList,
})

export const buildWorkOrderView = (workOrders: WorkOrder[], fleetUnits: FleetUnit[]): WorkOrderViewItem[] =>
  workOrders.map((workOrder) => {
    const unit = fleetUnits.find((fleetUnit) => fleetUnit.id === workOrder.unitId)

    return {
      id: workOrder.id,
      code: workOrder.code ?? 'OT-LEGACY',
      pendingReaudit: workOrder.pendingReaudit ?? false,
      unitId: workOrder.unitId,
      unitLabel: unit ? `${unit.internalCode} - ${unit.ownerCompany}` : 'Unidad no disponible',
      status: workOrder.status,
      statusLabel: workOrderStatusLabelMap[workOrder.status],
      taskList: normalizeTaskList(workOrder.taskList),
      spareParts: workOrder.spareParts,
      laborDetail: workOrder.laborDetail,
      linkedInventorySkuList: workOrder.linkedInventorySkuList,
    }
  })

export const updateInventoryLinks = (
  inventoryItems: InventoryItem[],
  workOrderId: string,
  previousSkuList: string[],
  nextSkuList: string[],
): InventoryItem[] => {
  const previousSkuSet = new Set(previousSkuList)
  const nextSkuSet = new Set(nextSkuList)

  return inventoryItems.map((item) => {
    const hadLink = previousSkuSet.has(item.sku)
    const shouldHaveLink = nextSkuSet.has(item.sku)

    if (!hadLink && !shouldHaveLink) {
      return item
    }

    const linkedIds = new Set(item.linkedWorkOrderIds)

    if (shouldHaveLink) {
      linkedIds.add(workOrderId)
    } else {
      linkedIds.delete(workOrderId)
    }

    return {
      ...item,
      linkedWorkOrderIds: Array.from(linkedIds),
    }
  })
}

export const removeWorkOrderFromInventoryLinks = (
  inventoryItems: InventoryItem[],
  workOrderId: string,
): InventoryItem[] =>
  inventoryItems.map((item) => ({
    ...item,
    linkedWorkOrderIds: item.linkedWorkOrderIds.filter((linkedId) => linkedId !== workOrderId),
  }))
