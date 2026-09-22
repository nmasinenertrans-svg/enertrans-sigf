import type { FleetUnit, Tire } from '../../../types/domain'
import type { TireFormData, TireFormErrors } from '../types'

const REPLACEMENT_KM_THRESHOLD = 90000
const HIGH_WEAR_KM_THRESHOLD = 70000

export const wearTypeValues = ['', 'PAREJO', 'BORDES', 'CENTRO', 'IRREGULAR'] as const
export type WearTypeValue = (typeof wearTypeValues)[number]

export const wearTypeLabels: Record<WearTypeValue, string> = {
  '': 'Sin definir',
  PAREJO: 'Parejo',
  BORDES: 'Desgaste en bordes',
  CENTRO: 'Desgaste en el centro',
  IRREGULAR: 'Irregular / cocada',
}

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
  wearType: '',
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
  wearType: formData.wearType,
  installedAt: formData.installedAt ? new Date(`${formData.installedAt}T12:00:00.000Z`).toISOString() : null,
  installedKm: parseInt0(formData.installedKmInput),
  costBase: parseMoney(formData.costBaseInput),
  currency: formData.currency,
  notes: formData.notes.trim(),
})

export type WearLevel = 'OK' | 'ALTO' | 'CAMBIO'

export interface TireViewItem extends Tire {
  unitLabel: string
  kmOnTire: number
  wearLevel: WearLevel
  wearPercent: number
}

// Colores del diagrama interactivo: verde/amarillo/rojo segun el mismo umbral
// que ya se usaba para el badge de desgaste (70.000 / 90.000 km).
export const wearLevelColor: Record<WearLevel, string> = {
  OK: '#10b981',
  ALTO: '#f59e0b',
  CAMBIO: '#ef4444',
}

export const buildTireView = (tires: Tire[], fleetUnits: FleetUnit[]): TireViewItem[] => {
  const unitById = new Map(fleetUnits.map((unit) => [unit.id, unit]))
  return tires
    .map((tire) => {
      const unit = unitById.get(tire.unitId)
      const unitLabel = unit ? `${unit.internalCode} - ${unit.brand} ${unit.model}` : 'Unidad no disponible'
      const kmOnTire = Math.max(0, (unit?.currentKilometers ?? 0) - tire.installedKm)
      const wearLevel: WearLevel =
        kmOnTire >= REPLACEMENT_KM_THRESHOLD ? 'CAMBIO' : kmOnTire >= HIGH_WEAR_KM_THRESHOLD ? 'ALTO' : 'OK'
      const wearPercent = Math.min(100, Math.round((kmOnTire / REPLACEMENT_KM_THRESHOLD) * 100))
      return { ...tire, unitLabel, kmOnTire, wearLevel, wearPercent }
    })
    .sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
      return b.kmOnTire - a.kmOnTire
    })
}
