import type { ExternalRequest, FleetUnit, RepairRecord, WorkOrder } from '../../../types/domain'
import type { RepairFormData, RepairFormErrors, RepairViewItem } from '../types'

const MAX_SUPPLIER_LENGTH = 120

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `repair-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

export const calculateMargin = (realCost: number, invoicedToClient: number): number => {
  const normalizedRealCost = Number.isFinite(realCost) ? realCost : 0
  const normalizedInvoiced = Number.isFinite(invoicedToClient) ? invoicedToClient : 0

  return Number((normalizedInvoiced - normalizedRealCost).toFixed(2))
}

const parseNumber = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

export const calculateInvoicedFromSurcharge = (realCost: number, surchargePercent: number): number => {
  const normalized = Number.isFinite(realCost) ? realCost : 0
  const percent = Number.isFinite(surchargePercent) ? surchargePercent : 0
  return Number((normalized * (1 + percent / 100)).toFixed(2))
}

export const createEmptyRepairFormData = (workOrderId: string): RepairFormData => ({
  sourceType: 'WORK_ORDER',
  workOrderId,
  externalRequestId: '',
  supplierName: '',
  realCostInput: '',
  surchargePercentInput: '',
  invoiceFileName: '',
  invoiceFileBase64: '',
  invoiceFileUrl: '',
})

export const toRepairFormData = (repair: RepairRecord): RepairFormData => ({
  sourceType: repair.sourceType ?? 'WORK_ORDER',
  workOrderId: repair.workOrderId ?? '',
  externalRequestId: repair.externalRequestId ?? '',
  supplierName: repair.supplierName,
  realCostInput: Number.isFinite(repair.realCost) ? String(repair.realCost) : '',
  surchargePercentInput: '',
  invoiceFileName: repair.invoiceFileName ?? '',
  invoiceFileBase64: repair.invoiceFileBase64 ?? '',
  invoiceFileUrl: repair.invoiceFileUrl ?? '',
})

export const validateRepairFormData = (
  formData: RepairFormData,
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
): RepairFormErrors => {
  const validationErrors: RepairFormErrors = {}

  if (formData.sourceType === 'WORK_ORDER') {
    if (!formData.workOrderId) {
      validationErrors.workOrderId = 'Debes seleccionar una OT.'
    } else if (!workOrders.some((workOrder) => workOrder.id === formData.workOrderId)) {
      validationErrors.workOrderId = 'La OT seleccionada no existe.'
    }
  } else {
    if (!formData.externalRequestId) {
      validationErrors.externalRequestId = 'Debes seleccionar una nota externa.'
    } else if (!externalRequests.some((request) => request.id === formData.externalRequestId)) {
      validationErrors.externalRequestId = 'La nota seleccionada no existe.'
    }
  }

  if (!formData.supplierName.trim()) {
    validationErrors.supplierName = 'El proveedor es obligatorio.'
  } else if (formData.supplierName.length > MAX_SUPPLIER_LENGTH) {
    validationErrors.supplierName = 'El proveedor supera el largo maximo permitido.'
  }

  const realCost = parseNumber(formData.realCostInput)
  if (realCost < 0) {
    validationErrors.realCostInput = 'El costo real no puede ser negativo.'
  }

  const surcharge = parseNumber(formData.surchargePercentInput)
  if (surcharge < 0) {
    validationErrors.surchargePercentInput = 'El porcentaje no puede ser negativo.'
  }

  return validationErrors
}

export const toRepairRecord = (
  formData: RepairFormData,
  workOrders: WorkOrder[],
  externalRequests: ExternalRequest[],
): RepairRecord => {
  const linkedWorkOrder = workOrders.find((workOrder) => workOrder.id === formData.workOrderId)
  const linkedExternalRequest = externalRequests.find((request) => request.id === formData.externalRequestId)
  const realCost = parseNumber(formData.realCostInput)
  const surchargePercent = parseNumber(formData.surchargePercentInput)
  const invoicedToClient = calculateInvoicedFromSurcharge(realCost, surchargePercent)

  return {
    id: createId(),
    unitId: formData.sourceType === 'EXTERNAL_REQUEST' ? linkedExternalRequest?.unitId ?? '' : linkedWorkOrder?.unitId ?? '',
    workOrderId: formData.sourceType === 'WORK_ORDER' ? formData.workOrderId : '',
    externalRequestId: formData.externalRequestId || undefined,
    sourceType: formData.sourceType,
    supplierName: formData.supplierName.trim(),
    createdAt: new Date().toISOString(),
    realCost: Number(realCost.toFixed(2)),
    invoicedToClient: Number(invoicedToClient.toFixed(2)),
    margin: calculateMargin(realCost, invoicedToClient),
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
  const linkedExternalRequest = externalRequests.find((request) => request.id === formData.externalRequestId)
  const realCost = parseNumber(formData.realCostInput)
  const surchargePercent = parseNumber(formData.surchargePercentInput)
  const invoicedToClient = calculateInvoicedFromSurcharge(realCost, surchargePercent)

  return {
    ...repair,
    unitId:
      formData.sourceType === 'EXTERNAL_REQUEST'
        ? linkedExternalRequest?.unitId ?? repair.unitId
        : linkedWorkOrder?.unitId ?? repair.unitId,
    workOrderId: formData.sourceType === 'WORK_ORDER' ? formData.workOrderId : '',
    externalRequestId: formData.externalRequestId || undefined,
    sourceType: formData.sourceType,
    supplierName: formData.supplierName.trim(),
    createdAt: repair.createdAt ?? new Date().toISOString(),
    realCost: Number(realCost.toFixed(2)),
    invoicedToClient: Number(invoicedToClient.toFixed(2)),
    margin: calculateMargin(realCost, invoicedToClient),
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
    const linkedExternalRequest = externalRequests.find((request) => request.id === repair.externalRequestId)
    const linkedUnit = fleetUnits.find((unit) => unit.id === repair.unitId)

    return {
      id: repair.id,
      unitId: repair.unitId,
      unitLabel: linkedUnit ? `${linkedUnit.internalCode} - ${linkedUnit.ownerCompany}` : 'Unidad no disponible',
      sourceType: repair.sourceType ?? 'WORK_ORDER',
      workOrderId: repair.workOrderId,
      workOrderLabel: linkedWorkOrder
        ? `${linkedWorkOrder.code ?? linkedWorkOrder.id.slice(0, 8)} - ${linkedWorkOrder.status}`
        : 'OT no disponible',
      externalRequestId: repair.externalRequestId ?? '',
      externalRequestLabel: linkedExternalRequest
        ? `${linkedExternalRequest.code ?? linkedExternalRequest.id.slice(0, 8)}`
        : 'Nota externa no disponible',
      supplierName: repair.supplierName,
      realCost: repair.realCost,
      invoicedToClient: repair.invoicedToClient,
      margin: repair.margin,
      invoiceFileName: repair.invoiceFileName,
      invoiceFileUrl: repair.invoiceFileUrl,
    }
  })
