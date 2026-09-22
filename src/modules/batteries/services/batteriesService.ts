import type { Battery, FleetUnit, FleetUnitType } from '../../../types/domain'
import type { BatteryFormData, BatteryFormErrors } from '../types'

const DUE_SOON_DAYS = 30
const DEFAULT_LIFESPAN_MONTHS = 18

const TRUCK_UNIT_TYPES = new Set<FleetUnitType>(['CHASSIS', 'CHASSIS_WITH_HYDROCRANE', 'TRACTOR', 'TRACTOR_WITH_HYDROCRANE'])
const CAR_UNIT_TYPES = new Set<FleetUnitType>(['AUTOMOBILE', 'VAN', 'PICKUP'])

// Los camiones/tractores llevan dos baterias, los autos/utilitarios una. Son
// sugerencias para precargar el campo posicion, no una restriccion dura.
export const getSuggestedBatteryPositions = (unitType: FleetUnitType | undefined | null): string[] => {
  if (!unitType) return []
  if (TRUCK_UNIT_TYPES.has(unitType)) return ['1', '2']
  if (CAR_UNIT_TYPES.has(unitType)) return ['Única']
  return []
}

const parseInt0 = (value: string, fallback: number): number => {
  const parsed = Number(value.replace(/\D/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export const createEmptyBatteryFormData = (): BatteryFormData => ({
  unitId: '',
  position: '',
  brand: '',
  model: '',
  serialNumber: '',
  installedAt: new Date().toISOString().slice(0, 10),
  lifespanMonthsInput: String(DEFAULT_LIFESPAN_MONTHS),
  notes: '',
})

export const validateBatteryFormData = (formData: BatteryFormData): BatteryFormErrors => {
  const errors: BatteryFormErrors = {}
  if (!formData.unitId) errors.unitId = 'Debes seleccionar una unidad.'
  if (!formData.position.trim()) errors.position = 'Indicá la posición (ej: 1, 2, Única).'
  return errors
}

export const toBatteryPayload = (formData: BatteryFormData) => ({
  unitId: formData.unitId,
  position: formData.position.trim(),
  brand: formData.brand.trim(),
  model: formData.model.trim(),
  serialNumber: formData.serialNumber.trim(),
  installedAt: formData.installedAt ? new Date(`${formData.installedAt}T12:00:00.000Z`).toISOString() : null,
  lifespanMonths: parseInt0(formData.lifespanMonthsInput, DEFAULT_LIFESPAN_MONTHS),
  notes: formData.notes.trim(),
})

const addMonths = (date: Date, months: number): Date => {
  const result = new Date(date.getTime())
  result.setMonth(result.getMonth() + months)
  return result
}

export type BatteryStatus = 'SIN_FECHA' | 'OK' | 'DUE_SOON' | 'VENCIDA'

export interface BatteryViewItem extends Battery {
  unitLabel: string
  expiresAt: Date | null
  daysRemaining: number | null
  status: BatteryStatus
}

export const buildBatteryView = (batteries: Battery[], fleetUnits: FleetUnit[]): BatteryViewItem[] => {
  const unitById = new Map(fleetUnits.map((unit) => [unit.id, unit]))
  const now = new Date()
  return batteries
    .map((battery) => {
      const unit = unitById.get(battery.unitId)
      const unitLabel = unit ? `${unit.internalCode} - ${unit.brand} ${unit.model}` : 'Unidad no disponible'
      const expiresAt = battery.installedAt ? addMonths(new Date(battery.installedAt), battery.lifespanMonths) : null
      const daysRemaining = expiresAt ? Math.ceil((expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)) : null
      const status: BatteryStatus =
        daysRemaining === null ? 'SIN_FECHA' : daysRemaining <= 0 ? 'VENCIDA' : daysRemaining <= DUE_SOON_DAYS ? 'DUE_SOON' : 'OK'
      return { ...battery, unitLabel, expiresAt, daysRemaining, status }
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      if (a.expiresAt && b.expiresAt) return a.expiresAt.getTime() - b.expiresAt.getTime()
      if (a.expiresAt) return -1
      if (b.expiresAt) return 1
      return 0
    })
}
