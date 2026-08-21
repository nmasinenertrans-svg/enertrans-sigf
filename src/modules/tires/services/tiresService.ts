import type { FleetUnit, Tire } from '../../../types/domain'
import type { TireFormData, TireFormErrors } from '../types'

const REPLACEMENT_KM_THRESHOLD = 90000
const HIGH_WEAR_KM_THRESHOLD = 70000

const parseMoney = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const parseInt0 = (value: string): number => {
  const parsed = Number(value.replace(/\D/g, ''))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export const createEmptyTireFormData = (): TireFormData => ({
  unitId: '',
  position: '',
  brand: '',
  model: '',
  installedAt: new Date().toISOString().slice(0, 10),
  installedKmInput: '',
  costBaseInput: '',
  currency: 'ARS',
  notes: '',
})

export const validateTireFormData = (formData: TireFormData): TireFormErrors => {
  const errors: TireFormErrors = {}
  if (!formData.unitId) errors.unitId = 'Debes seleccionar una unidad.'
  if (!formData.position.trim()) errors.position = 'Indicá la posición (ej: Eje 1 Izq.).'
  return errors
}

export const toTirePayload = (formData: TireFormData) => ({
  unitId: formData.unitId,
  position: formData.position.trim(),
  brand: formData.brand.trim(),
  model: formData.model.trim(),
  installedAt: formData.installedAt ? new Date(`${formData.installedAt}T12:00:00.000Z`).toISOString() : null,
  installedKm: parseInt0(formData.installedKmInput),
  costBase: parseMoney(formData.costBaseInput),
  currency: formData.currency,
  notes: formData.notes.trim(),
})

export interface TireViewItem extends Tire {
  unitLabel: string
  kmOnTire: number
  wearLevel: 'OK' | 'ALTO' | 'CAMBIO'
}

export const buildTireView = (tires: Tire[], fleetUnits: FleetUnit[]): TireViewItem[] => {
  const unitById = new Map(fleetUnits.map((unit) => [unit.id, unit]))
  return tires
    .map((tire) => {
      const unit = unitById.get(tire.unitId)
      const unitLabel = unit ? `${unit.internalCode} - ${unit.brand} ${unit.model}` : 'Unidad no disponible'
      const kmOnTire = Math.max(0, (unit?.currentKilometers ?? 0) - tire.installedKm)
      const wearLevel: TireViewItem['wearLevel'] =
        kmOnTire >= REPLACEMENT_KM_THRESHOLD ? 'CAMBIO' : kmOnTire >= HIGH_WEAR_KM_THRESHOLD ? 'ALTO' : 'OK'
      return { ...tire, unitLabel, kmOnTire, wearLevel }
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return b.kmOnTire - a.kmOnTire
    })
}
