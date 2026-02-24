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

const readParsedField = (parsed: Record<string, unknown>, key: string): string => {
  const raw = parsed[key]
  return typeof raw === 'string' ? raw.trim() : ''
}

const extractFromRawText = (rawText: string, pattern: RegExp): string => {
  const match = rawText.match(pattern)
  return match?.[1]?.trim() ?? ''
}

const extractDetectedUnitCodes = (parsed: Record<string, unknown>, rawText: string): string[] => {
  const codes = new Set<string>()

  const parsedCode = readParsedField(parsed, 'unitCode') || readParsedField(parsed, 'internalCode') || readParsedField(parsed, 'domain')
  if (parsedCode) {
    codes.add(parsedCode.toUpperCase().replace(/\s+/g, ''))
  }

  const dominioRegex = /dominio\s*[:\-]?\s*([A-Z0-9]{6,8})/gi
  let match: RegExpExecArray | null
  while ((match = dominioRegex.exec(rawText)) !== null) {
    if (match[1]) {
      codes.add(match[1].toUpperCase().replace(/\s+/g, ''))
    }
  }

  return [...codes]
}

export const applyParsedPayload = (
  formData: MovementFormData,
  parsed: Record<string, unknown>,
  fleetUnits: FleetUnit[] = [],
): MovementFormData => {
  const next = { ...formData, parsedPayload: parsed }
  const rawText = readParsedField(parsed, 'rawText')

  const remitoNumber =
    readParsedField(parsed, 'remitoNumber') ||
    extractFromRawText(rawText, /remit[oó]\s*n[°ºo]?\s*[:\-]?\s*([0-9]{1,6}\s*-\s*[0-9]{1,12}|[0-9-]+)/i)
  const remitoDate =
    readParsedField(parsed, 'remitoDate') ||
    extractFromRawText(rawText, /fecha\s*[:\-]?\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i)
  const clientName =
    readParsedField(parsed, 'clientName') ||
    extractFromRawText(rawText, /cliente\s*[:\-]?\s*(.+)/i)
  const workLocation =
    readParsedField(parsed, 'workLocation') ||
    extractFromRawText(rawText, /lugar\s+de\s+trabajo\s*[:\-]?\s*(.+)/i)
  const equipmentDescription =
    readParsedField(parsed, 'equipmentDescription') ||
    extractFromRawText(rawText, /equipo\s*[:\-]?\s*(.+)/i)
  const observations =
    readParsedField(parsed, 'observations') ||
    extractFromRawText(rawText, /observaciones\s*[:\-]?\s*(.+)/i)

  const detectedUnitIds = extractDetectedUnitCodes(parsed, rawText)
    .map((code) => fleetUnits.find((unit) => unit.internalCode.toUpperCase() === code)?.id)
    .filter((id): id is string => Boolean(id))

  const mergedUnitIds = detectedUnitIds.length
    ? Array.from(new Set([...next.unitIds, ...detectedUnitIds]))
    : next.unitIds

  return {
    ...next,
    remitoNumber: remitoNumber || next.remitoNumber,
    remitoDate: remitoDate || next.remitoDate,
    clientName: clientName || next.clientName,
    workLocation: workLocation || next.workLocation,
    equipmentDescription: equipmentDescription || next.equipmentDescription,
    observations: observations || next.observations,
    unitIds: mergedUnitIds,
  }
}
