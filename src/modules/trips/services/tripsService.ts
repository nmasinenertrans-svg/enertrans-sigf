import type { TripFormData, TripLegFormData, TripLegFormErrors } from '../types'

export const createEmptyLegFormData = (): TripLegFormData => ({
  label: '',
  unitId: '',
  startDate: '',
  endDate: '',
  originLabel: '',
  originLat: null,
  originLng: null,
  destinationLabel: '',
  destinationLat: null,
  destinationLng: null,
})

export const createEmptyTripFormData = (): TripFormData => ({
  driverUserId: '',
  driverExternalName: '',
  notes: '',
  legs: [createEmptyLegFormData()],
})

export const defaultLegLabel = (index: number): string => {
  if (index === 0) return 'Ida'
  if (index === 1) return 'Vuelta'
  return `Tramo ${index + 1}`
}

export const validateLegFormData = (leg: TripLegFormData): TripLegFormErrors => {
  const errors: TripLegFormErrors = {}
  if (!leg.startDate) {
    errors.startDate = 'La fecha de inicio es obligatoria.'
  }
  if (!leg.endDate) {
    errors.endDate = 'La fecha de fin es obligatoria.'
  }
  if (leg.startDate && leg.endDate && new Date(leg.endDate) < new Date(leg.startDate)) {
    errors.endDate = 'No puede ser anterior al inicio.'
  }
  if (leg.originLat === null || leg.originLng === null) {
    errors.originLabel = 'Marcá el origen en el mapa.'
  }
  if (leg.destinationLat === null || leg.destinationLng === null) {
    errors.destinationLabel = 'Marcá el destino en el mapa.'
  }
  return errors
}

export interface TripFormValidation {
  driverExternalName?: string
  legs: TripLegFormErrors[]
}

export const validateTripFormData = (formData: TripFormData): TripFormValidation => {
  const legs = formData.legs.map((leg) => validateLegFormData(leg))
  const validation: TripFormValidation = { legs }
  if (!formData.driverUserId && !formData.driverExternalName.trim()) {
    validation.driverExternalName = 'Elegí un chofer del sistema o escribí el nombre.'
  }
  return validation
}

export const hasValidationErrors = (validation: TripFormValidation): boolean =>
  Boolean(validation.driverExternalName) || validation.legs.some((leg) => Object.keys(leg).length > 0)

const toLegPayload = (leg: TripLegFormData) => ({
  label: leg.label.trim(),
  unitId: leg.unitId || null,
  startDate: new Date(leg.startDate).toISOString(),
  endDate: new Date(leg.endDate).toISOString(),
  originLabel: leg.originLabel.trim(),
  origin: { lat: leg.originLat as number, lng: leg.originLng as number },
  destinationLabel: leg.destinationLabel.trim(),
  destination: { lat: leg.destinationLat as number, lng: leg.destinationLng as number },
})

export const toTripPayload = (formData: TripFormData) => ({
  driverUserId: formData.driverUserId || null,
  driverExternalName: formData.driverUserId ? '' : formData.driverExternalName.trim(),
  notes: formData.notes.trim(),
  legs: formData.legs.map(toLegPayload),
})
