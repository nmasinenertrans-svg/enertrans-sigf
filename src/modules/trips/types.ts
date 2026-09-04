export interface TripFormData {
  driverUserId: string
  driverExternalName: string
  unitId: string
  startDate: string
  endDate: string
  originLabel: string
  originLat: number | null
  originLng: number | null
  destinationLabel: string
  destinationLat: number | null
  destinationLng: number | null
  notes: string
}

export type TripFormField = keyof TripFormData

export type TripFormErrors = Partial<Record<TripFormField, string>>
