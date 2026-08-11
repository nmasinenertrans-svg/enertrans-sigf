import type { FleetUnit, MaintenanceMeasurementUnit, MaintenancePlan, MaintenanceType, VisualStatus } from '../../types/domain'

export interface MaintenanceSettings {
  dueSoonKilometersThreshold: number
  dueSoonHoursThreshold: number
  defaultOilList: string[]
  defaultFilterList: string[]
}

export interface MaintenancePlanFormData {
  unitId: string
  maintenanceType: MaintenanceType
  currentKilometers: number
  currentHours: number
  serviceIntervalKilometers: number
  serviceIntervalHours: number
  nextServiceByKilometers: number
  nextServiceByHours: number
  oilsInput: string
  filtersInput: string
  notes: string
}

export type MaintenanceFormField = keyof MaintenancePlanFormData

export type MaintenanceFormErrors = Partial<Record<MaintenanceFormField, string>>

export interface MaintenancePlanViewModel {
  plan: MaintenancePlan
  unit?: FleetUnit
  measurementUnit: MaintenanceMeasurementUnit
  remainingKilometers: number
  remainingHours: number
  calculatedStatus: VisualStatus
}
