import type { ExternalRequest, ExternalRequestPartItem, FleetUnit } from '../../../types/domain'
import { getNextSequenceCode, normalizeUnitCode } from '../../../services/sequence'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `external-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

export interface ExternalRequestPartItemFormData {
  id: string
  description: string
  quantityInput: string
  unitPriceInput: string
}

export interface ExternalRequestFormData {
  unitId: string
  companyName: string
  description: string
  tasksInput: string
  currency: 'ARS' | 'USD'
  partsItems: ExternalRequestPartItemFormData[]
  providerFileName: string
  providerFileBase64: string
  providerFileUrl: string
}

export type ExternalRequestFormErrors = Partial<Record<keyof ExternalRequestFormData, string>>
export interface ExternalRequestViewItem extends ExternalRequest {
  unitLabel: string
  unitCode: string
  tasks: string[]
  partsItems: ExternalRequestPartItem[]
  partsTotal: number
  currency: 'ARS' | 'USD'
  eligibilityStatus: 'PENDING_ATTACHMENT' | 'READY_FOR_REPAIR'
  linkedRepairId: string | null
}

const parseTasks = (raw: string): string[] =>
  raw
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

const parseMoney = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

const normalizeQuantity = (value: string): number => {
  const parsed = Number(value.replace(',', '.'))
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0
  }
  return Number(parsed.toFixed(2))
}

const createPartItemId = () => `part-${Date.now()}-${Math.round(Math.random() * 10000)}`

export const createEmptyPartItemFormData = (): ExternalRequestPartItemFormData => ({
  id: createPartItemId(),
  description: '',
  quantityInput: '',
  unitPriceInput: '',
})

export const normalizePartItems = (partsItems: ExternalRequestPartItemFormData[]): ExternalRequestPartItem[] =>
  partsItems
    .map((item) => {
      const quantity = normalizeQuantity(item.quantityInput)
      const unitPrice = parseMoney(item.unitPriceInput)
      const lineTotal = Number((quantity * unitPrice).toFixed(2))
      return {
        description: item.description.trim(),
        quantity,
        unitPrice: Number(unitPrice.toFixed(2)),
        lineTotal,
      }
    })
    .filter((item) => item.description && item.quantity > 0 && item.unitPrice >= 0)

export const calculatePartsTotal = (partsItems: ExternalRequestPartItemFormData[]): number =>
  Number(
    normalizePartItems(partsItems)
      .reduce((total, item) => total + item.lineTotal, 0)
      .toFixed(2),
  )

export const createEmptyExternalRequestFormData = (unitId: string): ExternalRequestFormData => ({
  unitId,
  companyName: '',
  description: '',
  tasksInput: '',
  currency: 'ARS',
  partsItems: [createEmptyPartItemFormData()],
  providerFileName: '',
  providerFileBase64: '',
  providerFileUrl: '',
})

export const validateExternalRequestFormData = (
  formData: ExternalRequestFormData,
  fleetUnits: FleetUnit[],
): ExternalRequestFormErrors => {
  const errors: ExternalRequestFormErrors = {}

  if (!formData.unitId) {
    errors.unitId = 'Debes seleccionar una unidad.'
  } else if (!fleetUnits.some((unit) => unit.id === formData.unitId)) {
    errors.unitId = 'La unidad seleccionada no existe.'
  }

  if (!formData.description.trim()) {
    errors.description = 'La descripcion del pedido es obligatoria.'
  }

  if (!formData.companyName.trim()) {
    errors.companyName = 'La empresa es obligatoria.'
  }

  if (parseTasks(formData.tasksInput).length === 0) {
    errors.tasksInput = 'Debes ingresar al menos un trabajo solicitado.'
  }

  const normalizedParts = normalizePartItems(formData.partsItems)
  if (normalizedParts.length === 0) {
    errors.partsItems = 'Debes cargar al menos un repuesto con descripcion, cantidad y precio unitario.'
  }

  if (formData.currency !== 'ARS' && formData.currency !== 'USD') {
    errors.currency = 'Moneda invalida.'
  }

  return errors
}

export const toExternalRequest = (formData: ExternalRequestFormData, unitCode: string, existingRequests?: ExternalRequest[]): ExternalRequest => {
  const partsItems = normalizePartItems(formData.partsItems)
  const partsTotal = Number(partsItems.reduce((total, item) => total + item.lineTotal, 0).toFixed(2))
  const hasAttachment = Boolean(formData.providerFileUrl?.trim())
  const existingCodes = existingRequests?.map((r) => r.code).filter(Boolean) as string[] | undefined

  return {
    id: createId(),
    unitId: formData.unitId,
    companyName: formData.companyName.trim(),
    description: formData.description.trim(),
    tasks: parseTasks(formData.tasksInput),
    createdAt: new Date().toISOString(),
    code: getNextSequenceCode('externalRequest', 'NDP', normalizeUnitCode(unitCode), existingCodes),
    currency: formData.currency,
    partsItems,
    partsTotal,
    eligibilityStatus: hasAttachment ? 'READY_FOR_REPAIR' : 'PENDING_ATTACHMENT',
    linkedRepairId: null,
    providerFileName: formData.providerFileName || undefined,
    providerFileBase64: formData.providerFileBase64 || undefined,
    providerFileUrl: formData.providerFileUrl || undefined,
  }
}

export const toExternalRequestFormData = (request: ExternalRequest): ExternalRequestFormData => ({
  unitId: request.unitId,
  companyName: request.companyName ?? '',
  description: request.description,
  tasksInput: Array.isArray(request.tasks) ? request.tasks.join('\n') : '',
  currency: request.currency === 'USD' ? 'USD' : 'ARS',
  partsItems:
    Array.isArray(request.partsItems) && request.partsItems.length > 0
      ? request.partsItems.map((item) => ({
          id: createPartItemId(),
          description: item.description,
          quantityInput: String(item.quantity),
          unitPriceInput: String(item.unitPrice),
        }))
      : [createEmptyPartItemFormData()],
  providerFileName: request.providerFileName ?? '',
  providerFileBase64: request.providerFileBase64 ?? '',
  providerFileUrl: request.providerFileUrl ?? '',
})

export const buildExternalRequestView = (
  requests: ExternalRequest[],
  fleetUnits: FleetUnit[],
): ExternalRequestViewItem[] =>
  requests.map((request) => {
    const unit = fleetUnits.find((item) => item.id === request.unitId)
    const partsItems = Array.isArray(request.partsItems) ? request.partsItems : []
    const partsTotal = Number.isFinite(request.partsTotal) ? Number(request.partsTotal) : 0
    return {
      ...request,
      unitLabel: unit ? `${unit.internalCode} - ${unit.ownerCompany}` : 'Unidad no disponible',
      unitCode: unit?.internalCode ?? '',
      tasks: Array.isArray(request.tasks) ? request.tasks : [],
      partsItems,
      partsTotal,
      currency: request.currency === 'USD' ? 'USD' : 'ARS',
      eligibilityStatus: request.eligibilityStatus === 'READY_FOR_REPAIR' ? 'READY_FOR_REPAIR' : 'PENDING_ATTACHMENT',
      linkedRepairId: request.linkedRepairId ?? null,
    }
  })
