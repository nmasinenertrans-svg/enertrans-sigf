import type { TripFormData, TripFormErrors } from '../types'

export const createEmptyTripFormData = (): TripFormData => ({
  driverUserId: '',
  driverExternalName: '',
  unitId: '',
  startDate: '',
  endDate: '',
  originLabel: '',
  originLat: null,
  originLng: null,
  destinationLabel: '',
  destinationLat: null,
  destinationLng: null,
  notes: '',
})

export const validateTripFormData = (formData: TripFormData): TripFormErrors => {
  const errors: TripFormErrors = {}

  if (!formData.driverUserId && !formData.driverExternalName.trim()) {
    errors.driverExternalName = 'Elegí un chofer del sistema o escribí el nombre.'
  }

  if (!formData.startDate) {
    errors.startDate = 'La fecha de inicio es obligatoria.'
  }
  if (!formData.endDate) {
    errors.endDate = 'La fecha de fin es obligatoria.'
  }
  if (formData.startDate && formData.endDate && new Date(formData.endDate) < new Date(formData.startDate)) {
    errors.endDate = 'La fecha de fin no puede ser anterior a la de inicio.'
  }

  if (formData.originLat === null || formData.originLng === null) {
    errors.originLabel = 'Marcá el origen en el mapa.'
  }
  if (formData.destinationLat === null || formData.destinationLng === null) {
    errors.destinationLabel = 'Marcá el destino en el mapa.'
  }

  return errors
}

export const toTripCreatePayload = (formData: TripFormData) => ({
  driverUserId: formData.driverUserId || null,
  driverExternalName: formData.driverUserId ? '' : formData.driverExternalName.trim(),
  unitId: formData.unitId || null,
  startDate: new Date(formData.startDate).toISOString(),
  endDate: new Date(formData.endDate).toISOString(),
  originLabel: formData.originLabel.trim(),
  origin: { lat: formData.originLat as number, lng: formData.originLng as number },
  destinationLabel: formData.destinationLabel.trim(),
  destination: { lat: formData.destinationLat as number, lng: formData.destinationLng as number },
  notes: formData.notes.trim(),
})
