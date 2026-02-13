import type { FleetUnit, MaintenancePlan, VisualStatus } from '../../types/domain'

export interface MaintenanceSettings {
  dueSoonKilometersThreshold: number
  dueSoonHoursThreshold: number
  defaultOilList: string[]
  defaultFilterList: string[]
}

export interface MaintenancePlanFormData {
  unitId: string
  currentKilometers: number
  currentHours: number
  nextServiceByKilometers: number
  nextServiceByHours: number
  oilsInput: string
  filtersInput: string
  notes: string
  serviceMotorHours: string
  serviceMotorKilometers: string
  serviceDistributionHours: string
  serviceDistributionKilometers: string
  serviceGearboxHours: string
  serviceGearboxKilometers: string
  serviceCoolingHours: string
  serviceCoolingKilometers: string
  serviceDifferentialHours: string
  serviceDifferentialKilometers: string
  serviceSteeringHours: string
  serviceSteeringKilometers: string
  serviceClutchHours: string
  serviceClutchKilometers: string
  serviceBrakesHours: string
  serviceBrakesKilometers: string
  serviceHydroCraneHours: string
}

export type MaintenanceFormField = keyof MaintenancePlanFormData

export type MaintenanceFormErrors = Partial<Record<MaintenanceFormField, string>>

export interface MaintenancePlanViewModel {
  plan: MaintenancePlan
  unit?: FleetUnit
  remainingKilometers: number
  remainingHours: number
  calculatedStatus: VisualStatus
}
