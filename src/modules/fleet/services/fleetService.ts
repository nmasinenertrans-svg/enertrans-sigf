import {
  fleetOperationalStatuses,
  fleetUnitTypes,
  type FleetOperationalStatus,
  type FleetUnit,
  type FleetUnitDocuments,
  type FleetUnitFilters,
  type FleetUnitLubricants,
  type FleetUnitType,
} from '../../../types/domain'
import type { FleetFormData, FleetFormErrors } from '../types'

const MIN_WEIGHT_KG = 1
const MAX_TEXT_LENGTH = 120

const fallbackOperationalStatus: FleetOperationalStatus = fleetOperationalStatuses[0]
const fallbackUnitType: FleetUnitType = fleetUnitTypes[0]

const unitTypesWithHydroCrane = new Set<FleetUnitType>(['CHASSIS_WITH_HYDROCRANE', 'TRACTOR_WITH_HYDROCRANE'])

export const fleetOperationalStatusLabelMap: Record<FleetOperationalStatus, string> = {
  OPERATIONAL: 'Operativo',
  MAINTENANCE: 'En mantenimiento',
  OUT_OF_SERVICE: 'Fuera de servicio',
}

export const fleetUnitTypeLabelMap: Record<FleetUnitType, string> = {
  CHASSIS: 'Chasis',
  CHASSIS_WITH_HYDROCRANE: 'Chasis con hidrogrua',
  TRACTOR: 'Tractor',
  TRACTOR_WITH_HYDROCRANE: 'Tractor con hidrogrua',
  SEMI_TRAILER: 'Semirremolque',
  AUTOMOBILE: 'Automovil',
  VAN: 'Furgon',
}

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `fleet-unit-${Date.now()}`
}

const buildQrId = (unitId: string): string => `qr-${unitId}`

const sanitizeText = (value: string): string => value.trim()

const requiresHydroCraneFromType = (unitType: FleetUnitType): boolean => unitTypesWithHydroCrane.has(unitType)

const normalizeHydroCraneFlag = (unitType: FleetUnitType, hasHydroCrane: boolean): boolean =>
  requiresHydroCraneFromType(unitType) || hasHydroCrane

const createEmptyLubricants = (): FleetUnitLubricants => ({
  engineOil: '',
  engineOilLiters: '',
  gearboxOil: '',
  gearboxOilLiters: '',
  differentialOil: '',
  differentialOilLiters: '',
  clutchFluid: '',
  clutchFluidLiters: '',
  steeringFluid: '',
  steeringFluidLiters: '',
  brakeFluid: '',
  brakeFluidLiters: '',
  coolant: '',
  coolantLiters: '',
  hydraulicOil: '',
  hydraulicOilLiters: '',
})

const createEmptyFilters = (): FleetUnitFilters => ({
  oilFilter: '',
  fuelFilter: '',
  taFilter: '',
  primaryAirFilter: '',
  secondaryAirFilter: '',
  cabinFilter: '',
})

const createEmptyDocument = (): FleetUnitDocuments['rto'] => ({
  fileName: '',
  fileBase64: '',
  fileUrl: '',
  expiresAt: '',
})

const createEmptyDocuments = (): FleetUnitDocuments => ({
  rto: createEmptyDocument(),
  insurance: createEmptyDocument(),
  hoist: createEmptyDocument(),
})

const normalizeLubricants = (lubricants?: FleetUnitLubricants): FleetUnitLubricants => ({
  ...createEmptyLubricants(),
  ...(lubricants ?? {}),
})

const normalizeFilters = (filters?: FleetUnitFilters): FleetUnitFilters => ({
  ...createEmptyFilters(),
  ...(filters ?? {}),
})

const normalizeDocument = (doc?: FleetUnitDocuments['rto']): FleetUnitDocuments['rto'] => ({
  ...createEmptyDocument(),
  ...(doc ?? {}),
  fileUrl: doc?.fileUrl ?? '',
})

const normalizeDocuments = (documents?: FleetUnitDocuments): FleetUnitDocuments => ({
  rto: normalizeDocument(documents?.rto),
  insurance: normalizeDocument(documents?.insurance),
  hoist: normalizeDocument(documents?.hoist),
})

const isMissingOrExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return true
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date.getTime() < new Date().setHours(0, 0, 0, 0)
}

const hasInvalidDocuments = (documents?: FleetUnitDocuments): boolean => {
  if (!documents) {
    return true
  }
  return (
    isMissingOrExpired(documents.rto?.expiresAt) ||
    isMissingOrExpired(documents.insurance?.expiresAt) ||
    isMissingOrExpired(documents.hoist?.expiresAt)
  )
}

const deriveOperationalStatus = (
  requested: FleetOperationalStatus,
  documents?: FleetUnitDocuments,
): FleetOperationalStatus => (hasInvalidDocuments(documents) ? 'OUT_OF_SERVICE' : requested)

const normalizeFormData = (formData: FleetFormData): FleetFormData => {
  const normalizedHydroCraneFlag = normalizeHydroCraneFlag(formData.unitType, formData.hasHydroCrane)
  const normalizedDocuments = normalizeDocuments(formData.documents)
  const nextOperationalStatus = deriveOperationalStatus(formData.operationalStatus, normalizedDocuments)

  return {
    ...formData,
    operationalStatus: nextOperationalStatus,
    brand: sanitizeText(formData.brand),
    model: sanitizeText(formData.model),
    year: formData.year,
    clientName: sanitizeText(formData.clientName),
    location: sanitizeText(formData.location),
    hasHydroCrane: normalizedHydroCraneFlag,
    hydroCraneBrand: normalizedHydroCraneFlag ? sanitizeText(formData.hydroCraneBrand) : '',
    hydroCraneModel: normalizedHydroCraneFlag ? sanitizeText(formData.hydroCraneModel) : '',
    hydroCraneSerialNumber: normalizedHydroCraneFlag ? sanitizeText(formData.hydroCraneSerialNumber) : '',
    hasSemiTrailer: formData.hasSemiTrailer,
    semiTrailerUnitId: formData.hasSemiTrailer ? formData.semiTrailerUnitId : '',
    semiTrailerLicensePlate: formData.hasSemiTrailer ? sanitizeText(formData.semiTrailerLicensePlate) : '',
    semiTrailerBrand: formData.hasSemiTrailer ? sanitizeText(formData.semiTrailerBrand) : '',
    semiTrailerModel: formData.hasSemiTrailer ? sanitizeText(formData.semiTrailerModel) : '',
    semiTrailerYear: formData.hasSemiTrailer ? formData.semiTrailerYear : 0,
    semiTrailerChassisNumber: formData.hasSemiTrailer ? sanitizeText(formData.semiTrailerChassisNumber) : '',
    currentKilometers: Number.isFinite(formData.currentKilometers) ? formData.currentKilometers : 0,
    currentEngineHours: Number.isFinite(formData.currentEngineHours) ? formData.currentEngineHours : 0,
    currentHydroHours: Number.isFinite(formData.currentHydroHours) ? formData.currentHydroHours : 0,
    lubricants: normalizeLubricants(formData.lubricants),
    filters: normalizeFilters(formData.filters),
    documents: normalizedDocuments,
  }
}

export const createEmptyFleetFormData = (): FleetFormData => ({
  internalCode: '',
  brand: '',
  model: '',
  year: 0,
  clientName: '',
  location: '',
  ownerCompany: '',
  operationalStatus: fallbackOperationalStatus,
  unitType: fallbackUnitType,
  configurationNotes: '',
  chassisNumber: '',
  engineNumber: '',
  tareWeightKg: 0,
  maxLoadKg: 0,
  hasHydroCrane: false,
  hydroCraneBrand: '',
  hydroCraneModel: '',
  hydroCraneSerialNumber: '',
  hasSemiTrailer: false,
  semiTrailerUnitId: '',
  semiTrailerLicensePlate: '',
  semiTrailerBrand: '',
  semiTrailerModel: '',
  semiTrailerYear: 0,
  semiTrailerChassisNumber: '',
  currentKilometers: 0,
  currentEngineHours: 0,
  currentHydroHours: 0,
  lubricants: createEmptyLubricants(),
  filters: createEmptyFilters(),
  documents: createEmptyDocuments(),
})

export const mapFleetUnitToFormData = (unit: FleetUnit): FleetFormData => {
  const normalizedUnit = normalizeFleetUnit(unit)

  return {
    internalCode: normalizedUnit.internalCode,
    brand: normalizedUnit.brand,
    model: normalizedUnit.model,
    year: normalizedUnit.year,
    clientName: normalizedUnit.clientName,
    location: normalizedUnit.location,
    ownerCompany: normalizedUnit.ownerCompany,
    operationalStatus: normalizedUnit.operationalStatus,
    unitType: normalizedUnit.unitType,
    configurationNotes: normalizedUnit.configurationNotes,
    chassisNumber: normalizedUnit.chassisNumber,
    engineNumber: normalizedUnit.engineNumber,
    tareWeightKg: normalizedUnit.tareWeightKg,
    maxLoadKg: normalizedUnit.maxLoadKg,
    hasHydroCrane: normalizedUnit.hasHydroCrane,
    hydroCraneBrand: normalizedUnit.hydroCraneBrand,
    hydroCraneModel: normalizedUnit.hydroCraneModel,
    hydroCraneSerialNumber: normalizedUnit.hydroCraneSerialNumber,
    hasSemiTrailer: normalizedUnit.hasSemiTrailer,
    semiTrailerUnitId: normalizedUnit.semiTrailerUnitId ?? '',
    semiTrailerLicensePlate: normalizedUnit.semiTrailerLicensePlate,
    semiTrailerBrand: normalizedUnit.semiTrailerBrand,
    semiTrailerModel: normalizedUnit.semiTrailerModel,
    semiTrailerYear: normalizedUnit.semiTrailerYear,
    semiTrailerChassisNumber: normalizedUnit.semiTrailerChassisNumber,
    currentKilometers: normalizedUnit.currentKilometers ?? 0,
    currentEngineHours: normalizedUnit.currentEngineHours ?? 0,
    currentHydroHours: normalizedUnit.currentHydroHours ?? 0,
    lubricants: normalizedUnit.lubricants,
    filters: normalizedUnit.filters,
    documents: normalizedUnit.documents,
  }
}

export const resolveSemiTrailerFormData = (formData: FleetFormData, unitList: FleetUnit[]): FleetFormData => {
  if (!formData.hasSemiTrailer) {
    return {
      ...formData,
      semiTrailerUnitId: '',
    }
  }

  if (!formData.semiTrailerUnitId) {
    return formData
  }

  const matchedSemiTrailer = unitList.find(
    (unit) => unit.id === formData.semiTrailerUnitId && unit.unitType === 'SEMI_TRAILER',
  )

  if (!matchedSemiTrailer) {
    return formData
  }

  return {
    ...formData,
    semiTrailerLicensePlate: matchedSemiTrailer.internalCode,
    semiTrailerBrand: matchedSemiTrailer.semiTrailerBrand ?? '',
    semiTrailerModel: matchedSemiTrailer.semiTrailerModel ?? '',
    semiTrailerYear: matchedSemiTrailer.semiTrailerYear ?? 0,
    semiTrailerChassisNumber: matchedSemiTrailer.semiTrailerChassisNumber ?? '',
  }
}

export const toFleetUnit = (formData: FleetFormData): FleetUnit => {
  const id = createId()

  return {
    id,
    qrId: buildQrId(id),
    ...normalizeFormData(formData),
    semiTrailerUnitId: formData.hasSemiTrailer ? formData.semiTrailerUnitId || null : null,
    tractorHistoryIds: [],
  }
}

export const createSemiTrailerUnitFromForm = (formData: FleetFormData, tractorId: string): FleetUnit => {
  const id = createId()

  return {
    id,
    qrId: buildQrId(id),
    internalCode: sanitizeText(formData.semiTrailerLicensePlate),
    brand: sanitizeText(formData.semiTrailerBrand),
    model: sanitizeText(formData.semiTrailerModel),
    year: formData.semiTrailerYear,
    clientName: sanitizeText(formData.clientName),
    location: sanitizeText(formData.location),
    ownerCompany: sanitizeText(formData.ownerCompany),
    operationalStatus: fallbackOperationalStatus,
    unitType: 'SEMI_TRAILER',
    configurationNotes: '',
    chassisNumber: sanitizeText(formData.semiTrailerChassisNumber),
    engineNumber: '',
    tareWeightKg: 0,
    maxLoadKg: 0,
    hasHydroCrane: false,
    hydroCraneBrand: '',
    hydroCraneModel: '',
    hydroCraneSerialNumber: '',
    hasSemiTrailer: false,
    semiTrailerUnitId: null,
    semiTrailerLicensePlate: sanitizeText(formData.semiTrailerLicensePlate),
    semiTrailerBrand: sanitizeText(formData.semiTrailerBrand),
    semiTrailerModel: sanitizeText(formData.semiTrailerModel),
    semiTrailerYear: formData.semiTrailerYear,
    semiTrailerChassisNumber: sanitizeText(formData.semiTrailerChassisNumber),
    tractorHistoryIds: tractorId ? [tractorId] : [],
    currentKilometers: 0,
    currentEngineHours: 0,
    currentHydroHours: 0,
    lubricants: createEmptyLubricants(),
    filters: createEmptyFilters(),
    documents: createEmptyDocuments(),
  }
}

export const addTractorHistoryToSemiTrailer = (semiTrailer: FleetUnit, tractorId: string): FleetUnit => {
  if (!tractorId) {
    return semiTrailer
  }

  const history = semiTrailer.tractorHistoryIds ?? []

  if (history.includes(tractorId)) {
    return semiTrailer
  }

  return {
    ...semiTrailer,
    tractorHistoryIds: [...history, tractorId],
  }
}

export const mergeFleetUnitFromForm = (unit: FleetUnit, formData: FleetFormData): FleetUnit => ({
  ...unit,
  qrId: unit.qrId && unit.qrId.trim() ? unit.qrId : buildQrId(unit.id),
  ...normalizeFormData(formData),
  semiTrailerUnitId: formData.hasSemiTrailer ? formData.semiTrailerUnitId || null : null,
})

export const findFleetUnitById = (unitList: FleetUnit[], unitId: string): FleetUnit | undefined =>
  unitList.find((unit) => unit.id === unitId)

export const hasDuplicateInternalCode = (unitList: FleetUnit[], internalCode: string, excludedUnitId?: string): boolean =>
  unitList.some(
    (unit) =>
      unit.internalCode.trim().toLowerCase() === internalCode.trim().toLowerCase() &&
      (!excludedUnitId || unit.id !== excludedUnitId),
  )

const validateRequiredText = (
  value: string,
  fieldName: keyof FleetFormErrors,
  errorMessage: string,
  validationErrors: FleetFormErrors,
): void => {
  if (!value.trim()) {
    validationErrors[fieldName] = errorMessage
  }
}

export const validateFleetFormData = (
  formData: FleetFormData,
  unitList: FleetUnit[],
  excludedUnitId?: string,
): FleetFormErrors => {
  const normalizedFormData = normalizeFormData(formData)
  const validationErrors: FleetFormErrors = {}

  if (!normalizedFormData.internalCode.trim()) {
    validationErrors.internalCode = 'El codigo interno es obligatorio.'
  } else if (normalizedFormData.internalCode.trim().length > MAX_TEXT_LENGTH) {
    validationErrors.internalCode = 'El codigo interno excede el largo maximo permitido.'
  } else if (hasDuplicateInternalCode(unitList, normalizedFormData.internalCode, excludedUnitId)) {
    validationErrors.internalCode = 'Ya existe una unidad con este codigo interno.'
  }

  if (!normalizedFormData.ownerCompany.trim()) {
    validationErrors.ownerCompany = 'La empresa propietaria es obligatoria.'
  } else if (normalizedFormData.ownerCompany.trim().length > MAX_TEXT_LENGTH) {
    validationErrors.ownerCompany = 'La empresa propietaria excede el largo maximo permitido.'
  }

  if (!fleetUnitTypes.includes(normalizedFormData.unitType)) {
    validationErrors.unitType = 'Debes seleccionar un tipo de unidad valido.'
  }

  if (normalizedFormData.year < 1900) {
    validationErrors.year = 'El anio de la unidad debe ser valido.'
  }

  validateRequiredText(
    normalizedFormData.chassisNumber,
    'chassisNumber',
    'El numero de chasis es obligatorio.',
    validationErrors,
  )

  validateRequiredText(
    normalizedFormData.engineNumber,
    'engineNumber',
    'El numero de motor es obligatorio.',
    validationErrors,
  )

  if (normalizedFormData.tareWeightKg < MIN_WEIGHT_KG) {
    validationErrors.tareWeightKg = 'La tara debe ser mayor a cero.'
  }

  if (normalizedFormData.maxLoadKg < MIN_WEIGHT_KG) {
    validationErrors.maxLoadKg = 'La carga maxima debe ser mayor a cero.'
  } else if (normalizedFormData.maxLoadKg < normalizedFormData.tareWeightKg) {
    validationErrors.maxLoadKg = 'La carga maxima no puede ser menor que la tara.'
  }

  if (normalizedFormData.hasHydroCrane) {
    validateRequiredText(
      normalizedFormData.hydroCraneBrand,
      'hydroCraneBrand',
      'La marca de hidrogrua es obligatoria.',
      validationErrors,
    )
    validateRequiredText(
      normalizedFormData.hydroCraneModel,
      'hydroCraneModel',
      'El modelo de hidrogrua es obligatorio.',
      validationErrors,
    )
    validateRequiredText(
      normalizedFormData.hydroCraneSerialNumber,
      'hydroCraneSerialNumber',
      'El numero de serie de hidrogrua es obligatorio.',
      validationErrors,
    )
  }

  if (normalizedFormData.hasSemiTrailer) {
    if (normalizedFormData.semiTrailerUnitId) {
      const matchedSemiTrailer = unitList.find(
        (unit) => unit.id === normalizedFormData.semiTrailerUnitId && unit.unitType === 'SEMI_TRAILER',
      )

      if (!matchedSemiTrailer) {
        validationErrors.semiTrailerUnitId = 'Debes seleccionar un semirremolque valido.'
      }
    } else {
      validateRequiredText(
        normalizedFormData.semiTrailerLicensePlate,
        'semiTrailerLicensePlate',
        'El dominio del semirremolque es obligatorio.',
        validationErrors,
      )

      if (normalizedFormData.semiTrailerLicensePlate.trim().length > MAX_TEXT_LENGTH) {
        validationErrors.semiTrailerLicensePlate = 'El dominio del semirremolque excede el largo maximo permitido.'
      } else if (hasDuplicateInternalCode(unitList, normalizedFormData.semiTrailerLicensePlate)) {
        validationErrors.semiTrailerLicensePlate = 'Ya existe un vehiculo con ese dominio.'
      }

      validateRequiredText(
        normalizedFormData.semiTrailerBrand,
        'semiTrailerBrand',
        'La marca del semirremolque es obligatoria.',
        validationErrors,
      )
      validateRequiredText(
        normalizedFormData.semiTrailerModel,
        'semiTrailerModel',
        'El modelo del semirremolque es obligatorio.',
        validationErrors,
      )
      validateRequiredText(
        normalizedFormData.semiTrailerChassisNumber,
        'semiTrailerChassisNumber',
        'El numero de chasis del semirremolque es obligatorio.',
        validationErrors,
      )

      if (normalizedFormData.semiTrailerYear < 1900) {
        validationErrors.semiTrailerYear = 'El anio del semirremolque debe ser valido.'
      }
    }
  }

  return validationErrors
}

export const getOperationalStatusLabel = (status: FleetOperationalStatus): string => fleetOperationalStatusLabelMap[status]

export const getFleetUnitTypeLabel = (unitType: FleetUnitType): string => fleetUnitTypeLabelMap[unitType]

export const normalizeFleetUnit = (unit: FleetUnit): FleetUnit => {
  const normalizedUnitType = fleetUnitTypes.includes(unit.unitType) ? unit.unitType : fallbackUnitType
  const normalizedHydroCraneFlag = normalizeHydroCraneFlag(normalizedUnitType, Boolean(unit.hasHydroCrane))
  const normalizedQrId = unit.qrId && unit.qrId.trim() ? unit.qrId : buildQrId(unit.id)
  const normalizedDocuments = normalizeDocuments(unit.documents)
  const nextOperationalStatus = deriveOperationalStatus(
    fleetOperationalStatuses.includes(unit.operationalStatus) ? unit.operationalStatus : fallbackOperationalStatus,
    normalizedDocuments,
  )

  return {
    ...unit,
    qrId: normalizedQrId,
    operationalStatus: nextOperationalStatus,
    brand: unit.brand ?? '',
    model: unit.model ?? '',
    year: Number.isFinite(unit.year) ? unit.year : 0,
    clientName: unit.clientName ?? '',
    location: unit.location ?? '',
    unitType: normalizedUnitType,
    configurationNotes: unit.configurationNotes ?? '',
    hasHydroCrane: normalizedHydroCraneFlag,
    hydroCraneBrand: normalizedHydroCraneFlag ? unit.hydroCraneBrand ?? '' : '',
    hydroCraneModel: normalizedHydroCraneFlag ? unit.hydroCraneModel ?? '' : '',
    hydroCraneSerialNumber: normalizedHydroCraneFlag ? unit.hydroCraneSerialNumber ?? '' : '',
    hasSemiTrailer: Boolean(unit.hasSemiTrailer),
    semiTrailerUnitId: unit.semiTrailerUnitId ?? null,
    semiTrailerLicensePlate: unit.hasSemiTrailer ? unit.semiTrailerLicensePlate ?? '' : '',
    semiTrailerBrand: unit.hasSemiTrailer ? unit.semiTrailerBrand ?? '' : '',
    semiTrailerModel: unit.hasSemiTrailer ? unit.semiTrailerModel ?? '' : '',
    semiTrailerYear: unit.hasSemiTrailer ? unit.semiTrailerYear ?? 0 : 0,
    semiTrailerChassisNumber: unit.hasSemiTrailer ? unit.semiTrailerChassisNumber ?? '' : '',
    tractorHistoryIds: Array.isArray(unit.tractorHistoryIds) ? unit.tractorHistoryIds : [],
    currentKilometers: Number.isFinite(unit.currentKilometers) ? unit.currentKilometers : 0,
    currentEngineHours: Number.isFinite(unit.currentEngineHours) ? unit.currentEngineHours : 0,
    currentHydroHours: Number.isFinite(unit.currentHydroHours) ? unit.currentHydroHours : 0,
    lubricants: normalizeLubricants(unit.lubricants),
    filters: normalizeFilters(unit.filters),
    documents: normalizedDocuments,
  }
}

export const normalizeFleetUnits = (unitList: FleetUnit[]): FleetUnit[] => unitList.map((unit) => normalizeFleetUnit(unit))
