import { checklistItemKeys } from '../../../types/domain'
import type { ChecklistItems, FleetUnit, HandoverChecklist } from '../../../types/domain'
import type { HandoverChecklistFormData, HandoverChecklistFormErrors } from '../types'

const parseMoney = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const parseInt0 = (value: string): number => {
  const parsed = Number(value.replace(/\D/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export const checklistItemLabels: Record<(typeof checklistItemKeys)[number], string> = {
  documentacion: 'Documentación',
  luces: 'Luces',
  cubiertas: 'Cubiertas',
  frenos: 'Frenos',
  cabina: 'Cabina',
  carroceria: 'Carrocería',
  accesorios: 'Accesorios',
  kitSeguridad: 'Kit de seguridad',
}

export const createEmptyChecklistItems = (): ChecklistItems =>
  checklistItemKeys.reduce((accumulator, key) => {
    accumulator[key] = { status: 'OK', notes: '' }
    return accumulator
  }, {} as ChecklistItems)

const toDateTimeInput = (isoDate: string): string => {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 16)
  return parsed.toISOString().slice(0, 16)
}

const toIsoFromDateTimeInput = (dateTimeInput: string): string => {
  const parsed = new Date(dateTimeInput)
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString()
}

export const createEmptyHandoverChecklistFormData = (): HandoverChecklistFormData => ({
  code: '',
  type: 'DELIVERY',
  unitId: '',
  clientId: '',
  clientName: '',
  contractId: '',
  responsibleName: '',
  performedAt: new Date().toISOString().slice(0, 16),
  unitKilometersInput: '',
  engineHoursInput: '',
  fuelLevelPctInput: '',
  checklist: createEmptyChecklistItems(),
  damagesFound: '',
  chargeToClientUsdInput: '',
  photoUrls: [],
  signedActUrl: '',
  observations: '',
})

export const toHandoverChecklistFormData = (item: HandoverChecklist): HandoverChecklistFormData => ({
  code: item.code,
  type: item.type,
  unitId: item.unitId,
  clientId: item.clientId ?? '',
  clientName: item.clientName,
  contractId: item.contractId ?? '',
  responsibleName: item.responsibleName,
  performedAt: toDateTimeInput(item.performedAt),
  unitKilometersInput: String(item.unitKilometers),
  engineHoursInput: String(item.engineHours),
  fuelLevelPctInput: String(item.fuelLevelPct),
  checklist: { ...createEmptyChecklistItems(), ...item.checklist },
  damagesFound: item.damagesFound,
  chargeToClientUsdInput: String(item.chargeToClientUsd),
  photoUrls: item.photoUrls,
  signedActUrl: item.signedActUrl,
  observations: item.observations,
})

export const validateHandoverChecklistFormData = (formData: HandoverChecklistFormData): HandoverChecklistFormErrors => {
  const errors: HandoverChecklistFormErrors = {}
  if (!formData.unitId) errors.unitId = 'Debes seleccionar una unidad.'
  if (!formData.performedAt) errors.performedAt = 'La fecha es obligatoria.'
  return errors
}

export const toHandoverChecklistPayload = (formData: HandoverChecklistFormData) => ({
  code: formData.code.trim(),
  type: formData.type,
  unitId: formData.unitId,
  clientId: formData.clientId || null,
  clientName: formData.clientName.trim(),
  contractId: formData.contractId || null,
  responsibleName: formData.responsibleName.trim(),
  performedAt: toIsoFromDateTimeInput(formData.performedAt),
  unitKilometers: parseInt0(formData.unitKilometersInput),
  engineHours: parseInt0(formData.engineHoursInput),
  fuelLevelPct: Math.min(100, parseInt0(formData.fuelLevelPctInput)),
  checklist: formData.checklist,
  damagesFound: formData.damagesFound.trim(),
  chargeToClientUsd: parseMoney(formData.chargeToClientUsdInput),
  photoUrls: formData.photoUrls,
  signedActUrl: formData.signedActUrl,
  observations: formData.observations.trim(),
})

export const computeCompliance = (checklist: ChecklistItems): { percent: number; semaforo: 'VERDE' | 'AMARILLO' | 'ROJO' } => {
  const weights = { OK: 100, REGULAR: 50, MALO: 0 }
  const values = checklistItemKeys.map((key) => weights[checklist[key]?.status ?? 'OK'])
  const percent = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
  const semaforo = percent >= 90 ? 'VERDE' : percent >= 60 ? 'AMARILLO' : 'ROJO'
  return { percent, semaforo }
}

export interface HandoverChecklistViewItem extends HandoverChecklist {
  unitLabel: string
  compliancePercent: number
  semaforo: 'VERDE' | 'AMARILLO' | 'ROJO'
}

export const buildHandoverChecklistView = (
  items: HandoverChecklist[],
  fleetUnits: FleetUnit[],
): HandoverChecklistViewItem[] => {
  const unitById = new Map(fleetUnits.map((unit) => [unit.id, unit]))
  return items
    .map((item) => {
      const unit = unitById.get(item.unitId)
      const unitLabel = unit ? `${unit.internalCode} - ${unit.brand} ${unit.model}` : 'Unidad no disponible'
      const { percent, semaforo } = computeCompliance(item.checklist)
      return { ...item, unitLabel, compliancePercent: percent, semaforo }
    })
    .sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())
}
