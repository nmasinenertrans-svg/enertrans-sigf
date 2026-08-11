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
  currentKilometersInput: string
  currentHoursInput: string
  serviceIntervalKilometersInput: string
  serviceIntervalHoursInput: string
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
