import type {
  FleetOperationalStatus,
  FleetUnitDocuments,
  FleetUnitFilters,
  FleetUnitLubricants,
  FleetUnitType,
} from '../../types/domain'

export interface FleetFormData {
  internalCode: string
  brand: string
  model: string
  year: number
  clientName: string
  location: string
  ownerCompany: string
  operationalStatus: FleetOperationalStatus
  unitType: FleetUnitType
  configurationNotes: string
  chassisNumber: string
  engineNumber: string
  tareWeightKg: number
  maxLoadKg: number
  hasHydroCrane: boolean
  hydroCraneBrand: string
  hydroCraneModel: string
  hydroCraneSerialNumber: string
  hasSemiTrailer: boolean
  semiTrailerUnitId: string
  semiTrailerLicensePlate: string
  semiTrailerBrand: string
  semiTrailerModel: string
  semiTrailerYear: number
  semiTrailerChassisNumber: string
  currentKilometers: number
  currentEngineHours: number
  currentHydroHours: number
  engineCylinders: number
  lubricants: FleetUnitLubricants
  filters: FleetUnitFilters
  documents: FleetUnitDocuments
}

export type FleetFormField = keyof FleetFormData

export type FleetFormErrors = Partial<Record<FleetFormField, string>>
