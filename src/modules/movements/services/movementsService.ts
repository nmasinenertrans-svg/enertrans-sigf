import type { FleetMovement, FleetMovementType, FleetUnit } from '../../../types/domain'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `movement-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

export interface MovementFormData {
  unitIds: string[]
  movementType: FleetMovementType
  remitoNumber: string
  remitoDate: string
  clientName: string
  workLocation: string
  equipmentDescription: string
  observations: string
  pdfFileName: string
  pdfFileBase64: string
  pdfFileUrl: string
  parsedPayload?: Record<string, unknown>
}

export type MovementFormErrors = Partial<Record<keyof MovementFormData, string>>

export const createEmptyMovementFormData = (unitId?: string): MovementFormData => ({
  unitIds: unitId ? [unitId] : [],
  movementType: 'ENTRY',
  remitoNumber: '',
  remitoDate: '',
  clientName: '',
  workLocation: '',
  equipmentDescription: '',
  observations: '',
  pdfFileName: '',
  pdfFileBase64: '',
  pdfFileUrl: '',
  parsedPayload: undefined,
})

export const validateMovementFormData = (formData: MovementFormData, fleetUnits: FleetUnit[]): MovementFormErrors => {
  const errors: MovementFormErrors = {}

  if (!formData.unitIds.length) {
    errors.unitIds = 'Selecciona al menos una unidad.'
  } else if (!formData.unitIds.every((unitId) => fleetUnits.some((unit) => unit.id === unitId))) {
    errors.unitIds = 'Alguna unidad seleccionada no existe.'
  }

  if (!formData.remitoNumber.trim()) {
    errors.remitoNumber = 'El número de remito es obligatorio.'
  }

  if (!formData.remitoDate.trim()) {
    errors.remitoDate = 'La fecha del remito es obligatoria.'
  }

  if (!formData.clientName.trim()) {
    errors.clientName = 'El cliente es obligatorio.'
  }

  if (!formData.workLocation.trim()) {
    errors.workLocation = 'El lugar de trabajo es obligatorio.'
  }

  return errors
}

export const toFleetMovement = (formData: MovementFormData): FleetMovement => ({
  id: createId(),
  unitIds: formData.unitIds,
  movementType: formData.movementType,
  remitoNumber: formData.remitoNumber.trim(),
  remitoDate: formData.remitoDate.trim(),
  clientName: formData.clientName.trim(),
  workLocation: formData.workLocation.trim(),
  equipmentDescription: formData.equipmentDescription.trim(),
  observations: formData.observations.trim(),
  pdfFileName: formData.pdfFileName || undefined,
  pdfFileUrl: formData.pdfFileUrl || undefined,
  parsedPayload: formData.parsedPayload,
  createdAt: new Date().toISOString(),
})

export const applyParsedPayload = (formData: MovementFormData, parsed: Record<string, unknown>): MovementFormData => {
  const next = { ...formData, parsedPayload: parsed }
  const getField = (key: string) => {
    const raw = parsed[key]
    return typeof raw === 'string' ? raw.trim() : ''
  }

  const remitoNumber = getField('remitoNumber')
  const remitoDate = getField('remitoDate')
  const clientName = getField('clientName')
  const workLocation = getField('workLocation')
  const equipmentDescription = getField('equipmentDescription')
  const observations = getField('observations')

  return {
    ...next,
    remitoNumber: remitoNumber || next.remitoNumber,
    remitoDate: remitoDate || next.remitoDate,
    clientName: clientName || next.clientName,
    workLocation: workLocation || next.workLocation,
    equipmentDescription: equipmentDescription || next.equipmentDescription,
    observations: observations || next.observations,
  }
}
