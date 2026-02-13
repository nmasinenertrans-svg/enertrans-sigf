import type { ExternalRequest, FleetUnit } from '../../../types/domain'
import { getNextSequenceCode, normalizeUnitCode } from '../../../services/sequence'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `external-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

export interface ExternalRequestFormData {
  unitId: string
  companyName: string
  description: string
  tasksInput: string
  providerFileName: string
  providerFileBase64: string
  providerFileUrl: string
}

export type ExternalRequestFormErrors = Partial<Record<keyof ExternalRequestFormData, string>>

const parseTasks = (raw: string): string[] =>
  raw
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)

export const createEmptyExternalRequestFormData = (unitId: string): ExternalRequestFormData => ({
  unitId,
  companyName: '',
  description: '',
  tasksInput: '',
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

  return errors
}

export const toExternalRequest = (formData: ExternalRequestFormData, unitCode: string): ExternalRequest => ({
  id: createId(),
  unitId: formData.unitId,
  companyName: formData.companyName.trim(),
  description: formData.description.trim(),
  tasks: parseTasks(formData.tasksInput),
  createdAt: new Date().toISOString(),
  code: getNextSequenceCode('externalRequest', 'NDP', normalizeUnitCode(unitCode)),
  providerFileName: formData.providerFileName || undefined,
  providerFileBase64: formData.providerFileBase64 || undefined,
  providerFileUrl: formData.providerFileUrl || undefined,
})

export const toExternalRequestFormData = (request: ExternalRequest): ExternalRequestFormData => ({
  unitId: request.unitId,
  companyName: request.companyName ?? '',
  description: request.description,
  tasksInput: Array.isArray(request.tasks) ? request.tasks.join('\n') : '',
  providerFileName: request.providerFileName ?? '',
  providerFileBase64: request.providerFileBase64 ?? '',
  providerFileUrl: request.providerFileUrl ?? '',
})

export const buildExternalRequestView = (requests: ExternalRequest[], fleetUnits: FleetUnit[]) =>
  requests.map((request) => {
    const unit = fleetUnits.find((item) => item.id === request.unitId)
    return {
      ...request,
      unitLabel: unit ? `${unit.internalCode} - ${unit.ownerCompany}` : 'Unidad no disponible',
      unitCode: unit?.internalCode ?? '',
      tasks: Array.isArray(request.tasks) ? request.tasks : [],
    }
  })
