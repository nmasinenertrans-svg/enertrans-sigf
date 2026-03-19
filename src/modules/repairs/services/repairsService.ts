import type { ExternalRequest, FleetUnit, RepairRecord, WorkOrder } from '../../../types/domain'
import type { RepairFormData, RepairFormErrors, RepairViewItem } from '../types'

const MAX_SUPPLIER_LENGTH = 120
const pad2 = (value: number) => String(value).padStart(2, '0')

const getDefaultPerformedDateTime = () => {
  const now = new Date()
  return {
    performedDate: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`,
    performedTime: `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
  }
}

const toDateAndTimeInput = (isoDate?: string) => {
  if (!isoDate) {
    return getDefaultPerformedDateTime()
  }
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) {
    return getDefaultPerformedDateTime()
  }
  return {
    performedDate: `${parsed.getFullYear()}-${pad2(parsed.getMonth() + 1)}-${pad2(parsed.getDate())}`,
    performedTime: `${pad2(parsed.getHours())}:${pad2(parsed.getMinutes())}`,
  }
}

const toPerformedAtIso = (date: string, time: string): string => {
  const parsed = new Date(`${date}T${time}:00`)
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString()
  }
  return parsed.toISOString()
}

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `repair-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const parseNumber = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeMoney = (value: number): number => Number((Number.isFinite(value) ? value : 0).toFixed(2))

const uniqueIds = (raw: string[]): string[] => Array.from(new Set(raw.map((id) => id.trim()).filter(Boolean)))

export const calculateMargin = (realCost: number, invoicedToClient: number): number => {
  const normalizedRealCost = Number.isFinite(realCost) ? realCost : 0
  const normalizedInvoiced = Number.isFinite(invoicedToClient) ? invoicedToClient : 0

  return Number((normalizedInvoiced - normalizedRealCost).toFixed(2))
}

export const calculateInvoicedFromSurcharge = (realCost: number, surchargePercent: number): number => {
  const normalized = Number.isFinite(realCost) ? realCost : 0
  const percent = Number.isFinite(surchargePercent) ? surchargePercent : 0
  return Number((normalized * (1 + percent / 100)).toFixed(2))
}

const calculatePartsCostFromRequests = (externalRequests: ExternalRequest[], linkedIds: string[]): number => {
  const byId = new Map(externalRequests.map((request) => [request.id, request]))
  const total = linkedIds.reduce((sum, id) => {
    const request = byId.get(id)
    const partsTotal = Number(request?.partsTotal ?? 0)
    return sum + (Number.isFinite(partsTotal) ? partsTotal : 0)
  }, 0)
  return normalizeMoney(total)
}

const resolveLinkedExternalRequestIds = (repair: RepairRecord): string[] => {
  if (Array.isArray(repair.linkedExternalRequestIds) && repair.linkedExternalRequestIds.length > 0) {
    return uniqueIds(repair.linkedExternalRequestIds)
  }
  if (repair.externalRequestId) {
    return [repair.externalRequestId]
  }
  return []
}

export const isExternalRequestEligibleForRepair = (request: ExternalRequest, currentRepairId?: string | null): boolean => {
  const status = request.eligibilityStatus === 'READY_FOR_REPAIR'
  const hasAttachment = Boolean((request.providerFileUrl ?? '').trim())
  const linkedRepairId = request.linkedRepairId ?? null
  const isLinkedToCurrent = Boolean(currentRepairId && linkedRepairId === currentRepairId)
  const isUnlinked = !linkedRepairId
  return status && hasAttachment && (isUnlinked || isLinkedToCurrent)
}

export const createEmptyRepairFormData = (workOrderId: string): RepairFormData => ({
  sourceType: 'WORK_ORDER',
  workOrderId,
  linkedExternalRequestIds: [],
  ...getDefaultPerformedDateTime(),
  unitKilometersInput: '',
  currency: 'ARS',
  supplierId: '',
  supplierName: '',
  laborCostInput: '',
  surchargePercentInput: '',
  invoiceFileName: '',
  invoiceFileBase64: '',
  invoiceFileUrl: '',
})

export const toRepairFormData = (repair: RepairRecord): RepairFormData => ({
  ...toDateAndTimeInput(repair.performedAt ?? repair.createdAt),
  sourceType: repair.sourceType ?? 'WORK_ORDER',
  workOrderId: repair.workOrderId ?? '',
  linkedExternalRequestIds: resolveLinkedExternalRequestIds(repair),
  unitKilometersInput: Number.isFinite(repair.unitKilometers) ? String(repair.unitKilometers) : '',
  currency: repair.currency === 'USD' ? 'USD' : 'ARS',
  supplierId: repair.supplierId ?? '',
  supplierName: repair.supplierName,
  laborCostInput: String(Number.isFinite(repair.laborCost) ? repair.laborCost : repair.realCost),
  surchargePercentInput: '',
  invoiceFileName: repair.invoiceFileName ?? '',
  invoiceFileBase64: repair.invoiceFileBase64 ?? '',
  invoiceFileUrl: repair.invoiceFileUrl ?? '',
})

export const validateRepairFormData = (
  formData: RepairFormData,
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
  currentRepairId?: string | null,
): RepairFormErrors => {
  const validationErrors: RepairFormErrors = {}

  if (formData.sourceType === 'WORK_ORDER') {
    if (!formData.workOrderId) {
      validationErrors.workOrderId = 'Debes seleccionar una OT.'
    } else if (!workOrders.some((workOrder) => workOrder.id === formData.workOrderId)) {
      validationErrors.workOrderId = 'La OT seleccionada no existe.'
    }
  } else {
    if (!Array.isArray(formData.linkedExternalRequestIds) || formData.linkedExternalRequestIds.length === 0) {
      validationErrors.linkedExternalRequestIds = 'Debes seleccionar al menos una NDP elegible.'
    } else {
      const selected = externalRequests.filter((request) => formData.linkedExternalRequestIds.includes(request.id))
      if (selected.length !== formData.linkedExternalRequestIds.length) {
        validationErrors.linkedExternalRequestIds = 'Una o mas NDP seleccionadas no existen.'
      } else {
        const currencies = new Set(selected.map((request) => (request.currency === 'USD' ? 'USD' : 'ARS')))
        if (currencies.size > 1) {
          validationErrors.linkedExternalRequestIds = 'Las NDP deben compartir la misma moneda.'
        } else if (!selected.every((request) => isExternalRequestEligibleForRepair(request, currentRepairId ?? undefined))) {
          validationErrors.linkedExternalRequestIds = 'Hay NDP sin adjunto o no elegibles para reparacion.'
        }
      }
    }
  }

  if (!formData.supplierName.trim()) {
    validationErrors.supplierName = 'El proveedor es obligatorio.'
  } else if (formData.supplierName.length > MAX_SUPPLIER_LENGTH) {
    validationErrors.supplierName = 'El proveedor supera el largo maximo permitido.'
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(formData.performedDate)) {
    validationErrors.performedDate = 'La fecha de reparacion es obligatoria.'
  }

  if (!/^\d{2}:\d{2}$/.test(formData.performedTime)) {
    validationErrors.performedTime = 'La hora de reparacion es obligatoria.'
  }

  if (!formData.unitKilometersInput.trim()) {
    validationErrors.unitKilometersInput = 'Debes informar los km de la unidad.'
  }

  const unitKilometers = Math.trunc(parseNumber(formData.unitKilometersInput))
  if (unitKilometers < 0) {
    validationErrors.unitKilometersInput = 'Los km no pueden ser negativos.'
  }

  if (formData.currency !== 'ARS' && formData.currency !== 'USD') {
    validationErrors.currency = 'Debes seleccionar una moneda valida.'
  }

  const laborCost = parseNumber(formData.laborCostInput)
  if (laborCost < 0) {
    validationErrors.laborCostInput = 'La mano de obra no puede ser negativa.'
  }

  const surcharge = parseNumber(formData.surchargePercentInput)
  if (surcharge < 0) {
    validationErrors.surchargePercentInput = 'El porcentaje no puede ser negativo.'
  }

  return validationErrors
}

const resolveRepairCosts = (formData: RepairFormData, externalRequests: ExternalRequest[]) => {
  const linkedIds = uniqueIds(formData.linkedExternalRequestIds)
  const partsCost = calculatePartsCostFromRequests(externalRequests, linkedIds)
  const laborCost = normalizeMoney(parseNumber(formData.laborCostInput))
  const realCost = normalizeMoney(laborCost + partsCost)
  const surchargePercent = parseNumber(formData.surchargePercentInput)
  const invoicedToClient = calculateInvoicedFromSurcharge(realCost, surchargePercent)
  const margin = calculateMargin(realCost, invoicedToClient)

  return {
    linkedIds,
    partsCost,
    laborCost,
    realCost,
    invoicedToClient,
    margin,
  }
}

export const toRepairRecord = (
  formData: RepairFormData,
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
): RepairRecord => {
  const linkedWorkOrder = workOrders.find((workOrder) => workOrder.id === formData.workOrderId)
  const costs = resolveRepairCosts(formData, externalRequests)
  const primaryExternalRequest = externalRequests.find((request) => request.id === costs.linkedIds[0])

  return {
    id: createId(),
    unitId: costs.linkedIds.length > 0 ? primaryExternalRequest?.unitId ?? '' : linkedWorkOrder?.unitId ?? '',
    workOrderId: formData.sourceType === 'WORK_ORDER' ? formData.workOrderId : '',
    externalRequestId: costs.linkedIds[0] || undefined,
    linkedExternalRequestIds: costs.linkedIds,
    sourceType: costs.linkedIds.length > 0 ? 'EXTERNAL_REQUEST' : formData.sourceType,
    performedAt: toPerformedAtIso(formData.performedDate, formData.performedTime),
    unitKilometers: Math.max(0, Math.trunc(parseNumber(formData.unitKilometersInput))),
    currency: formData.currency === 'USD' ? 'USD' : 'ARS',
    supplierId: formData.supplierId || undefined,
    supplierName: formData.supplierName.trim(),
    laborCost: costs.laborCost,
    partsCost: costs.partsCost,
    createdAt: new Date().toISOString(),
    realCost: costs.realCost,
    invoicedToClient: Number(costs.invoicedToClient.toFixed(2)),
    margin: costs.margin,
    invoiceFileName: formData.invoiceFileName || undefined,
    invoiceFileBase64: formData.invoiceFileBase64 || undefined,
    invoiceFileUrl: formData.invoiceFileUrl || undefined,
  }
}

export const mergeRepairFromForm = (
  repair: RepairRecord,
  formData: RepairFormData,
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
): RepairRecord => {
  const linkedWorkOrder = workOrders.find((workOrder) => workOrder.id === formData.workOrderId)
  const costs = resolveRepairCosts(formData, externalRequests)
  const primaryExternalRequest = externalRequests.find((request) => request.id === costs.linkedIds[0])

  return {
    ...repair,
    unitId:
      costs.linkedIds.length > 0 ? primaryExternalRequest?.unitId ?? repair.unitId : linkedWorkOrder?.unitId ?? repair.unitId,
    workOrderId: costs.linkedIds.length > 0 ? '' : formData.workOrderId,
    externalRequestId: costs.linkedIds[0] || undefined,
    linkedExternalRequestIds: costs.linkedIds,
    sourceType: costs.linkedIds.length > 0 ? 'EXTERNAL_REQUEST' : formData.sourceType,
    performedAt: toPerformedAtIso(formData.performedDate, formData.performedTime),
    unitKilometers: Math.max(0, Math.trunc(parseNumber(formData.unitKilometersInput))),
    currency: formData.currency === 'USD' ? 'USD' : 'ARS',
    supplierId: formData.supplierId || undefined,
    supplierName: formData.supplierName.trim(),
    laborCost: costs.laborCost,
    partsCost: costs.partsCost,
    createdAt: repair.createdAt ?? new Date().toISOString(),
    realCost: costs.realCost,
    invoicedToClient: Number(costs.invoicedToClient.toFixed(2)),
    margin: costs.margin,
    invoiceFileName: formData.invoiceFileName || undefined,
    invoiceFileBase64: formData.invoiceFileBase64 || undefined,
    invoiceFileUrl: formData.invoiceFileUrl || undefined,
  }
}

export const buildRepairView = (
  repairs: RepairRecord[],
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
  fleetUnits: FleetUnit[],
): RepairViewItem[] =>
  repairs.map((repair) => {
    const linkedWorkOrder = workOrders.find((workOrder) => workOrder.id === repair.workOrderId)
    const linkedIds = resolveLinkedExternalRequestIds(repair)
    const linkedExternalRequests = linkedIds
      .map((id) => externalRequests.find((request) => request.id === id))
      .filter(Boolean) as ExternalRequest[]
    const linkedUnit = fleetUnits.find((unit) => unit.id === repair.unitId)
    const linkedExternalRequestLabels = linkedExternalRequests.map((request) => request.code ?? request.id.slice(0, 8))
    const laborCost = Number.isFinite(repair.laborCost) ? Number(repair.laborCost) : repair.realCost
    const partsCost = Number.isFinite(repair.partsCost) ? Number(repair.partsCost) : 0

    return {
      id: repair.id,
      unitId: repair.unitId,
      unitLabel: linkedUnit ? `${linkedUnit.internalCode} - ${linkedUnit.ownerCompany}` : 'Unidad no disponible',
      sourceType: repair.sourceType ?? (linkedIds.length > 0 ? 'EXTERNAL_REQUEST' : 'WORK_ORDER'),
      workOrderId: repair.workOrderId,
      workOrderLabel: linkedWorkOrder
        ? `${linkedWorkOrder.code ?? linkedWorkOrder.id.slice(0, 8)} - ${linkedWorkOrder.status}`
        : 'OT no disponible',
      externalRequestId: linkedIds[0] ?? '',
      linkedExternalRequestIds: linkedIds,
      linkedExternalRequestLabels,
      externalRequestLabel:
        linkedExternalRequestLabels.length > 0
          ? linkedExternalRequestLabels.join(', ')
          : 'Nota externa no disponible',
      performedAt: repair.performedAt ?? repair.createdAt ?? new Date().toISOString(),
      unitKilometers: Number.isFinite(repair.unitKilometers) ? repair.unitKilometers : 0,
      currency: repair.currency === 'USD' ? 'USD' : 'ARS',
      supplierName: repair.supplierName,
      laborCost: normalizeMoney(laborCost),
      partsCost: normalizeMoney(partsCost),
      realCost: normalizeMoney(repair.realCost),
      invoicedToClient: normalizeMoney(repair.invoicedToClient),
      margin: normalizeMoney(repair.margin),
      invoiceFileName: repair.invoiceFileName,
      invoiceFileUrl: repair.invoiceFileUrl,
    }
  })
