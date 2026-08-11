import { maintenanceTypes } from '../../../types/domain'
import type {
  FleetUnit,
  MaintenanceMeasurementUnit,
  MaintenancePlan,
  MaintenanceType,
  VisualStatus,
} from '../../../types/domain'
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
const DEFAULT_SERVICE_INTERVAL_KILOMETERS = 10000
const DEFAULT_SERVICE_INTERVAL_HOURS = 300

const DEFAULT_MAINTENANCE_SETTINGS: MaintenanceSettings = {
  dueSoonKilometersThreshold: DEFAULT_DUE_SOON_KILOMETERS,
  dueSoonHoursThreshold: DEFAULT_DUE_SOON_HOURS,
  defaultOilList: ['Motor 15W40', 'Hidráulico ISO 46'],
  defaultFilterList: ['Filtro de aceite', 'Filtro de aire'],
}

const MIN_VALUE = 0
const MAX_TEXT_LENGTH = 240

export const maintenanceTypeLabels: Record<MaintenanceType, string> = {
  MOTOR: 'Motor',
  DISTRIBUTION: 'Distribución',
  GEARBOX: 'Caja',
  COOLING: 'Refrigeración',
  DIFFERENTIAL: 'Diferencial',
  STEERING: 'Dirección',
  CLUTCH: 'Embrague',
  BRAKES: 'Frenos',
  HYDRO_CRANE: 'Hidrogrúa',
}

const HOUR_BASED_UNIT_TYPES = new Set<FleetUnit['unitType']>([
  'CHASSIS',
  'CHASSIS_WITH_HYDROCRANE',
  'TRACTOR',
  'TRACTOR_WITH_HYDROCRANE',
])

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

/** Camiones/tractores se miden por horas de motor; autos/camionetas/furgones por KM. La hidrogrúa siempre es por horas. */
export const getMeasurementUnit = (
  unitType: FleetUnit['unitType'] | undefined,
  maintenanceType: MaintenanceType,
): MaintenanceMeasurementUnit => {
  if (maintenanceType === 'HYDRO_CRANE') {
    return 'HOURS'
  }
  return unitType && HOUR_BASED_UNIT_TYPES.has(unitType) ? 'HOURS' : 'KILOMETERS'
}

export const getAvailableMaintenanceTypes = (unit?: FleetUnit): MaintenanceType[] =>
  maintenanceTypes.filter((type) => type !== 'HYDRO_CRANE' || Boolean(unit?.hasHydroCrane))

export const calculateMaintenanceStatus = (
  measurementUnit: MaintenanceMeasurementUnit,
  current: number,
  nextServiceBy: number,
  settings: MaintenanceSettings,
): VisualStatus => {
  const remaining = nextServiceBy - current
  const threshold =
    measurementUnit === 'KILOMETERS' ? settings.dueSoonKilometersThreshold : settings.dueSoonHoursThreshold

  if (remaining <= 0) {
    return 'OVERDUE'
  }

  if (remaining <= threshold) {
    return 'DUE_SOON'
  }

  return 'OK'
}

export const createEmptyMaintenancePlanFormData = (
  unitId: string,
  settings: MaintenanceSettings,
): MaintenancePlanFormData => ({
  unitId,
  maintenanceType: 'MOTOR',
  currentKilometers: 0,
  currentHours: 0,
  serviceIntervalKilometers: DEFAULT_SERVICE_INTERVAL_KILOMETERS,
  serviceIntervalHours: DEFAULT_SERVICE_INTERVAL_HOURS,
  nextServiceByKilometers: 0,
  nextServiceByHours: 0,
  oilsInput: serializeList(settings.defaultOilList),
  filtersInput: serializeList(settings.defaultFilterList),
  notes: '',
})

export const toMaintenancePlanFormData = (plan: MaintenancePlan): MaintenancePlanFormData => ({
  unitId: plan.unitId,
  maintenanceType: plan.maintenanceType ?? 'MOTOR',
  currentKilometers: plan.currentKilometers,
  currentHours: plan.currentHours,
  serviceIntervalKilometers: plan.serviceIntervalKilometers ?? DEFAULT_SERVICE_INTERVAL_KILOMETERS,
  serviceIntervalHours: plan.serviceIntervalHours ?? DEFAULT_SERVICE_INTERVAL_HOURS,
  nextServiceByKilometers: plan.nextServiceByKilometers,
  nextServiceByHours: plan.nextServiceByHours,
  oilsInput: serializeList(plan.oils),
  filtersInput: serializeList(plan.filters),
  notes: plan.notes,
})

export const validateMaintenancePlanFormData = (
  formData: MaintenancePlanFormData,
  fleetUnits: FleetUnit[],
): MaintenanceFormErrors => {
  const validationErrors: MaintenanceFormErrors = {}

  if (!formData.unitId) {
    validationErrors.unitId = 'Debés seleccionar una unidad.'
  }

  const unit = fleetUnits.find((item) => item.id === formData.unitId)
  if (formData.unitId && !unit) {
    validationErrors.unitId = 'La unidad seleccionada no existe.'
  }

  const measurementUnit = getMeasurementUnit(unit?.unitType, formData.maintenanceType)

  if (measurementUnit === 'KILOMETERS') {
    if (formData.currentKilometers < MIN_VALUE) {
      validationErrors.currentKilometers = 'Los kilómetros actuales no pueden ser negativos.'
    }
    if (formData.serviceIntervalKilometers <= MIN_VALUE) {
      validationErrors.serviceIntervalKilometers = 'Ingresá cada cuántos KM corresponde este service.'
    }
  } else {
    if (formData.currentHours < MIN_VALUE) {
      validationErrors.currentHours = 'Las horas actuales no pueden ser negativas.'
    }
    if (formData.serviceIntervalHours <= MIN_VALUE) {
      validationErrors.serviceIntervalHours = 'Ingresá cada cuántas horas corresponde este service.'
    }
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
  fleetUnits: FleetUnit[],
): MaintenancePlan => {
  const unit = fleetUnits.find((item) => item.id === formData.unitId)
  const measurementUnit = getMeasurementUnit(unit?.unitType, formData.maintenanceType)
  const nextServiceByKilometers =
    measurementUnit === 'KILOMETERS' ? formData.currentKilometers + formData.serviceIntervalKilometers : 0
  const nextServiceByHours = measurementUnit === 'HOURS' ? formData.currentHours + formData.serviceIntervalHours : 0

  return {
    id: createMaintenancePlanId(),
    unitId: formData.unitId,
    maintenanceType: formData.maintenanceType,
    currentKilometers: formData.currentKilometers,
    currentHours: formData.currentHours,
    serviceIntervalKilometers: measurementUnit === 'KILOMETERS' ? formData.serviceIntervalKilometers : null,
    serviceIntervalHours: measurementUnit === 'HOURS' ? formData.serviceIntervalHours : null,
    nextServiceByKilometers,
    nextServiceByHours,
    oils: parseDelimitedList(formData.oilsInput),
    filters: parseDelimitedList(formData.filtersInput),
    notes: formData.notes.trim(),
    status: calculateMaintenanceStatus(
      measurementUnit,
      measurementUnit === 'KILOMETERS' ? formData.currentKilometers : formData.currentHours,
      measurementUnit === 'KILOMETERS' ? nextServiceByKilometers : nextServiceByHours,
      settings,
    ),
  }
}

export const mergeMaintenancePlanFromForm = (
  plan: MaintenancePlan,
  formData: MaintenancePlanFormData,
  settings: MaintenanceSettings,
  fleetUnits: FleetUnit[],
): MaintenancePlan => {
  const unit = fleetUnits.find((item) => item.id === formData.unitId)
  const measurementUnit = getMeasurementUnit(unit?.unitType, formData.maintenanceType)

  return {
    ...plan,
    unitId: formData.unitId,
    maintenanceType: formData.maintenanceType,
    currentKilometers: formData.currentKilometers,
    currentHours: formData.currentHours,
    serviceIntervalKilometers: measurementUnit === 'KILOMETERS' ? formData.serviceIntervalKilometers : null,
    serviceIntervalHours: measurementUnit === 'HOURS' ? formData.serviceIntervalHours : null,
    nextServiceByKilometers: formData.nextServiceByKilometers,
    nextServiceByHours: formData.nextServiceByHours,
    oils: parseDelimitedList(formData.oilsInput),
    filters: parseDelimitedList(formData.filtersInput),
    notes: formData.notes.trim(),
    status: calculateMaintenanceStatus(
      measurementUnit,
      measurementUnit === 'KILOMETERS' ? formData.currentKilometers : formData.currentHours,
      measurementUnit === 'KILOMETERS' ? formData.nextServiceByKilometers : formData.nextServiceByHours,
      settings,
    ),
  }
}

/** Recalcula el proximo service (actual + intervalo) al marcar que el service se realizo. */
export const markMaintenanceServiceDone = (
  plan: MaintenancePlan,
  measurementUnit: MaintenanceMeasurementUnit,
  settings: MaintenanceSettings,
): MaintenancePlan => {
  const nextServiceByKilometers =
    measurementUnit === 'KILOMETERS' && plan.serviceIntervalKilometers
      ? plan.currentKilometers + plan.serviceIntervalKilometers
      : plan.nextServiceByKilometers
  const nextServiceByHours =
    measurementUnit === 'HOURS' && plan.serviceIntervalHours
      ? plan.currentHours + plan.serviceIntervalHours
      : plan.nextServiceByHours

  return {
    ...plan,
    nextServiceByKilometers,
    nextServiceByHours,
    status: calculateMaintenanceStatus(
      measurementUnit,
      measurementUnit === 'KILOMETERS' ? plan.currentKilometers : plan.currentHours,
      measurementUnit === 'KILOMETERS' ? nextServiceByKilometers : nextServiceByHours,
      settings,
    ),
  }
}

export const normalizeMaintenancePlan = (
  plan: MaintenancePlan,
  fleetUnits: FleetUnit[],
  settings: MaintenanceSettings,
): MaintenancePlan => {
  const currentKilometers = typeof plan.currentKilometers === 'number' ? plan.currentKilometers : 0
  const currentHours = typeof plan.currentHours === 'number' ? plan.currentHours : 0
  const maintenanceType = plan.maintenanceType ?? 'MOTOR'
  const unit = fleetUnits.find((item) => item.id === plan.unitId)
  const measurementUnit = getMeasurementUnit(unit?.unitType, maintenanceType)

  return {
    ...plan,
    maintenanceType,
    currentKilometers,
    currentHours,
    status: calculateMaintenanceStatus(
      measurementUnit,
      measurementUnit === 'KILOMETERS' ? currentKilometers : currentHours,
      measurementUnit === 'KILOMETERS' ? plan.nextServiceByKilometers : plan.nextServiceByHours,
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
    const normalizedPlan = normalizeMaintenancePlan(plan, fleetUnits, settings)
    const unit = fleetUnits.find((item) => item.id === normalizedPlan.unitId)
    const measurementUnit = getMeasurementUnit(unit?.unitType, normalizedPlan.maintenanceType)
    const remainingKilometers = normalizedPlan.nextServiceByKilometers - normalizedPlan.currentKilometers
    const remainingHours = normalizedPlan.nextServiceByHours - normalizedPlan.currentHours

    return {
      plan: normalizedPlan,
      unit,
      measurementUnit,
      remainingKilometers,
      remainingHours,
      calculatedStatus: normalizedPlan.status,
    }
  })
