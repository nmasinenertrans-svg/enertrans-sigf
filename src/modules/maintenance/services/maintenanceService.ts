import type { FleetUnit, MaintenancePlan, MaintenanceServiceSchedule, VisualStatus } from '../../../types/domain'
import { readLocalStorage, writeLocalStorage } from '../../../services/storage/localStorageService'
import type {
  MaintenanceFormErrors,
  MaintenancePlanFormData,
  MaintenanceSettings,
  MaintenancePlanViewModel,
} from '../types'

const MAINTENANCE_SETTINGS_STORAGE_KEY = 'enertrans.sigf.maintenance.settings.v1'

const DEFAULT_DUE_SOON_KILOMETERS = 1500
const DEFAULT_DUE_SOON_HOURS = 50

const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  dueSoonKilometersThreshold: DEFAULT_DUE_SOON_KILOMETERS,
  dueSoonHoursThreshold: DEFAULT_DUE_SOON_HOURS,
  defaultOilList: ['Motor 15W40', 'Hidráulico ISO 46'],
  defaultFilterList: ['Filtro de aceite', 'Filtro de aire'],
}

const MIN_VALUE = 0
const MAX_TEXT_LENGTH = 240

const createMaintenancePlanId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `maintenance-plan-${Date.now()}`
}

const parseDelimitedList = (rawText: string): string[] =>
  rawText
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const serializeList = (itemList: string[]): string => itemList.join(', ')

const parseOptionalNumber = (value: string): number | null => {
  const trimmed = value.trim()
  if (!trimmed) {
    return null
  }
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

const formatOptionalNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : ''

const createEmptyServiceScheduleFormData = (): Pick<
  MaintenancePlanFormData,
  | 'serviceMotorHours'
  | 'serviceMotorKilometers'
  | 'serviceDistributionHours'
  | 'serviceDistributionKilometers'
  | 'serviceGearboxHours'
  | 'serviceGearboxKilometers'
  | 'serviceCoolingHours'
  | 'serviceCoolingKilometers'
  | 'serviceDifferentialHours'
  | 'serviceDifferentialKilometers'
  | 'serviceSteeringHours'
  | 'serviceSteeringKilometers'
  | 'serviceClutchHours'
  | 'serviceClutchKilometers'
  | 'serviceBrakesHours'
  | 'serviceBrakesKilometers'
  | 'serviceHydroCraneHours'
> => ({
  serviceMotorHours: '',
  serviceMotorKilometers: '',
  serviceDistributionHours: '',
  serviceDistributionKilometers: '',
  serviceGearboxHours: '',
  serviceGearboxKilometers: '',
  serviceCoolingHours: '',
  serviceCoolingKilometers: '',
  serviceDifferentialHours: '',
  serviceDifferentialKilometers: '',
  serviceSteeringHours: '',
  serviceSteeringKilometers: '',
  serviceClutchHours: '',
  serviceClutchKilometers: '',
  serviceBrakesHours: '',
  serviceBrakesKilometers: '',
  serviceHydroCraneHours: '',
})

const createEmptyServiceSchedule = (): MaintenanceServiceSchedule => ({
  motorHours: null,
  motorKilometers: null,
  distributionHours: null,
  distributionKilometers: null,
  gearboxHours: null,
  gearboxKilometers: null,
  coolingHours: null,
  coolingKilometers: null,
  differentialHours: null,
  differentialKilometers: null,
  steeringHours: null,
  steeringKilometers: null,
  clutchHours: null,
  clutchKilometers: null,
  brakesHours: null,
  brakesKilometers: null,
  hydroCraneHours: null,
})

const normalizeServiceSchedule = (schedule?: MaintenanceServiceSchedule): MaintenanceServiceSchedule => ({
  ...createEmptyServiceSchedule(),
  ...(schedule ?? {}),
})

export const getDefaultMaintenanceSettings = (): MaintenanceSettings => DEFAULT_MAINTENANCE_SETTINGS

export const readMaintenanceSettings = (): MaintenanceSettings => {
  const settings = readLocalStorage<MaintenanceSettings>(
    MAINTENANCE_SETTINGS_STORAGE_KEY,
    DEFAULT_MAINTENANCE_SETTINGS,
  )

  return {
    dueSoonKilometersThreshold:
      typeof settings.dueSoonKilometersThreshold === 'number'
        ? settings.dueSoonKilometersThreshold
        : DEFAULT_DUE_SOON_KILOMETERS,
    dueSoonHoursThreshold:
      typeof settings.dueSoonHoursThreshold === 'number' ? settings.dueSoonHoursThreshold : DEFAULT_DUE_SOON_HOURS,
    defaultOilList:
      Array.isArray(settings.defaultOilList) && settings.defaultOilList.length > 0
        ? settings.defaultOilList
        : DEFAULT_MAINTENANCE_SETTINGS.defaultOilList,
    defaultFilterList:
      Array.isArray(settings.defaultFilterList) && settings.defaultFilterList.length > 0
        ? settings.defaultFilterList
        : DEFAULT_MAINTENANCE_SETTINGS.defaultFilterList,
  }
}

export const writeMaintenanceSettings = (settings: MaintenanceSettings): void => {
  writeLocalStorage(MAINTENANCE_SETTINGS_STORAGE_KEY, settings)
}

export const calculateMaintenanceStatus = (
  currentKilometers: number,
  nextServiceByKilometers: number,
  currentHours: number,
  nextServiceByHours: number,
  settings: MaintenanceSettings,
): VisualStatus => {
  const remainingKilometers = nextServiceByKilometers - currentKilometers
  const remainingHours = nextServiceByHours - currentHours

  if (remainingKilometers <= 0 || remainingHours <= 0) {
    return 'OVERDUE'
  }

  if (
    remainingKilometers <= settings.dueSoonKilometersThreshold ||
    remainingHours <= settings.dueSoonHoursThreshold
  ) {
    return 'DUE_SOON'
  }

  return 'OK'
}

export const createEmptyMaintenancePlanFormData = (
  unitId: string,
  settings: MaintenanceSettings,
): MaintenancePlanFormData => ({
  unitId,
  currentKilometers: 0,
  currentHours: 0,
  nextServiceByKilometers: 10000,
  nextServiceByHours: 400,
  oilsInput: serializeList(settings.defaultOilList),
  filtersInput: serializeList(settings.defaultFilterList),
  notes: '',
  ...createEmptyServiceScheduleFormData(),
})

export const toMaintenancePlanFormData = (plan: MaintenancePlan): MaintenancePlanFormData => {
  const schedule = normalizeServiceSchedule(plan.serviceSchedule)

  return {
    unitId: plan.unitId,
    currentKilometers: plan.currentKilometers,
    currentHours: plan.currentHours,
    nextServiceByKilometers: plan.nextServiceByKilometers,
    nextServiceByHours: plan.nextServiceByHours,
    oilsInput: serializeList(plan.oils),
    filtersInput: serializeList(plan.filters),
    notes: plan.notes,
    serviceMotorHours: formatOptionalNumber(schedule.motorHours),
    serviceMotorKilometers: formatOptionalNumber(schedule.motorKilometers),
    serviceDistributionHours: formatOptionalNumber(schedule.distributionHours),
    serviceDistributionKilometers: formatOptionalNumber(schedule.distributionKilometers),
    serviceGearboxHours: formatOptionalNumber(schedule.gearboxHours),
    serviceGearboxKilometers: formatOptionalNumber(schedule.gearboxKilometers),
    serviceCoolingHours: formatOptionalNumber(schedule.coolingHours),
    serviceCoolingKilometers: formatOptionalNumber(schedule.coolingKilometers),
    serviceDifferentialHours: formatOptionalNumber(schedule.differentialHours),
    serviceDifferentialKilometers: formatOptionalNumber(schedule.differentialKilometers),
    serviceSteeringHours: formatOptionalNumber(schedule.steeringHours),
    serviceSteeringKilometers: formatOptionalNumber(schedule.steeringKilometers),
    serviceClutchHours: formatOptionalNumber(schedule.clutchHours),
    serviceClutchKilometers: formatOptionalNumber(schedule.clutchKilometers),
    serviceBrakesHours: formatOptionalNumber(schedule.brakesHours),
    serviceBrakesKilometers: formatOptionalNumber(schedule.brakesKilometers),
    serviceHydroCraneHours: formatOptionalNumber(schedule.hydroCraneHours),
  }
}

export const validateMaintenancePlanFormData = (
  formData: MaintenancePlanFormData,
  fleetUnits: FleetUnit[],
): MaintenanceFormErrors => {
  const validationErrors: MaintenanceFormErrors = {}

  if (!formData.unitId) {
    validationErrors.unitId = 'Debés seleccionar una unidad.'
  }

  if (!fleetUnits.some((unit) => unit.id === formData.unitId)) {
    validationErrors.unitId = 'La unidad seleccionada no existe.'
  }

  if (formData.currentKilometers < MIN_VALUE) {
    validationErrors.currentKilometers = 'Los kilómetros actuales no pueden ser negativos.'
  }

  if (formData.currentHours < MIN_VALUE) {
    validationErrors.currentHours = 'Las horas actuales no pueden ser negativas.'
  }

  if (formData.nextServiceByKilometers <= MIN_VALUE) {
    validationErrors.nextServiceByKilometers = 'El próximo service por KM debe ser mayor a cero.'
  }

  if (formData.nextServiceByHours <= MIN_VALUE) {
    validationErrors.nextServiceByHours = 'El próximo service por horas debe ser mayor a cero.'
  }

  if (parseDelimitedList(formData.oilsInput).length === 0) {
    validationErrors.oilsInput = 'Ingresá al menos un aceite.'
  }

  if (parseDelimitedList(formData.filtersInput).length === 0) {
    validationErrors.filtersInput = 'Ingresá al menos un filtro.'
  }

  if (formData.notes.length > MAX_TEXT_LENGTH) {
    validationErrors.notes = 'Las observaciones superan el largo máximo permitido.'
  }

  return validationErrors
}

export const toMaintenancePlan = (
  formData: MaintenancePlanFormData,
  settings: MaintenanceSettings,
): MaintenancePlan => ({
  id: createMaintenancePlanId(),
  unitId: formData.unitId,
  currentKilometers: formData.currentKilometers,
  currentHours: formData.currentHours,
  nextServiceByKilometers: formData.nextServiceByKilometers,
  nextServiceByHours: formData.nextServiceByHours,
  oils: parseDelimitedList(formData.oilsInput),
  filters: parseDelimitedList(formData.filtersInput),
  notes: formData.notes.trim(),
  status: calculateMaintenanceStatus(
    formData.currentKilometers,
    formData.nextServiceByKilometers,
    formData.currentHours,
    formData.nextServiceByHours,
    settings,
  ),
  serviceSchedule: {
    motorHours: parseOptionalNumber(formData.serviceMotorHours),
    motorKilometers: parseOptionalNumber(formData.serviceMotorKilometers),
    distributionHours: parseOptionalNumber(formData.serviceDistributionHours),
    distributionKilometers: parseOptionalNumber(formData.serviceDistributionKilometers),
    gearboxHours: parseOptionalNumber(formData.serviceGearboxHours),
    gearboxKilometers: parseOptionalNumber(formData.serviceGearboxKilometers),
    coolingHours: parseOptionalNumber(formData.serviceCoolingHours),
    coolingKilometers: parseOptionalNumber(formData.serviceCoolingKilometers),
    differentialHours: parseOptionalNumber(formData.serviceDifferentialHours),
    differentialKilometers: parseOptionalNumber(formData.serviceDifferentialKilometers),
    steeringHours: parseOptionalNumber(formData.serviceSteeringHours),
    steeringKilometers: parseOptionalNumber(formData.serviceSteeringKilometers),
    clutchHours: parseOptionalNumber(formData.serviceClutchHours),
    clutchKilometers: parseOptionalNumber(formData.serviceClutchKilometers),
    brakesHours: parseOptionalNumber(formData.serviceBrakesHours),
    brakesKilometers: parseOptionalNumber(formData.serviceBrakesKilometers),
    hydroCraneHours: parseOptionalNumber(formData.serviceHydroCraneHours),
  },
})

export const mergeMaintenancePlanFromForm = (
  plan: MaintenancePlan,
  formData: MaintenancePlanFormData,
  settings: MaintenanceSettings,
): MaintenancePlan => ({
  ...plan,
  unitId: formData.unitId,
  currentKilometers: formData.currentKilometers,
  currentHours: formData.currentHours,
  nextServiceByKilometers: formData.nextServiceByKilometers,
  nextServiceByHours: formData.nextServiceByHours,
  oils: parseDelimitedList(formData.oilsInput),
  filters: parseDelimitedList(formData.filtersInput),
  notes: formData.notes.trim(),
  status: calculateMaintenanceStatus(
    formData.currentKilometers,
    formData.nextServiceByKilometers,
    formData.currentHours,
    formData.nextServiceByHours,
    settings,
  ),
  serviceSchedule: {
    motorHours: parseOptionalNumber(formData.serviceMotorHours),
    motorKilometers: parseOptionalNumber(formData.serviceMotorKilometers),
    distributionHours: parseOptionalNumber(formData.serviceDistributionHours),
    distributionKilometers: parseOptionalNumber(formData.serviceDistributionKilometers),
    gearboxHours: parseOptionalNumber(formData.serviceGearboxHours),
    gearboxKilometers: parseOptionalNumber(formData.serviceGearboxKilometers),
    coolingHours: parseOptionalNumber(formData.serviceCoolingHours),
    coolingKilometers: parseOptionalNumber(formData.serviceCoolingKilometers),
    differentialHours: parseOptionalNumber(formData.serviceDifferentialHours),
    differentialKilometers: parseOptionalNumber(formData.serviceDifferentialKilometers),
    steeringHours: parseOptionalNumber(formData.serviceSteeringHours),
    steeringKilometers: parseOptionalNumber(formData.serviceSteeringKilometers),
    clutchHours: parseOptionalNumber(formData.serviceClutchHours),
    clutchKilometers: parseOptionalNumber(formData.serviceClutchKilometers),
    brakesHours: parseOptionalNumber(formData.serviceBrakesHours),
    brakesKilometers: parseOptionalNumber(formData.serviceBrakesKilometers),
    hydroCraneHours: parseOptionalNumber(formData.serviceHydroCraneHours),
  },
})

export const normalizeMaintenancePlan = (
  plan: MaintenancePlan,
  settings: MaintenanceSettings,
): MaintenancePlan => {
  const currentKilometers = typeof plan.currentKilometers === 'number' ? plan.currentKilometers : 0
  const currentHours = typeof plan.currentHours === 'number' ? plan.currentHours : 0
  const serviceSchedule = normalizeServiceSchedule(plan.serviceSchedule)

  return {
    ...plan,
    currentKilometers,
    currentHours,
    serviceSchedule,
    status: calculateMaintenanceStatus(
      currentKilometers,
      plan.nextServiceByKilometers,
      currentHours,
      plan.nextServiceByHours,
      settings,
    ),
  }
}

export const buildMaintenanceViewModel = (
  maintenancePlanList: MaintenancePlan[],
  fleetUnits: FleetUnit[],
  settings: MaintenanceSettings,
): MaintenancePlanViewModel[] =>
  maintenancePlanList.map((plan) => {
    const normalizedPlan = normalizeMaintenancePlan(plan, settings)
    const remainingKilometers = normalizedPlan.nextServiceByKilometers - normalizedPlan.currentKilometers
    const remainingHours = normalizedPlan.nextServiceByHours - normalizedPlan.currentHours

    return {
      plan: normalizedPlan,
      unit: fleetUnits.find((unit) => unit.id === normalizedPlan.unitId),
      remainingKilometers,
      remainingHours,
      calculatedStatus: normalizedPlan.status,
    }
  })
