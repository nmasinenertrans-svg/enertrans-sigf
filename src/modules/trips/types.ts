export interface TripLegFormData {
  label: string
  unitId: string
  startDate: string
  endDate: string
  originLabel: string
  originLat: number | null
  originLng: number | null
  destinationLabel: string
  destinationLat: number | null
  destinationLng: number | null
}

export interface TripFormData {
  driverUserId: string
  driverExternalName: string
  notes: string
  legs: TripLegFormData[]
}

export type TripFormField = keyof Omit<TripFormData, 'legs'>

export type TripFormErrors = Partial<Record<TripFormField, string>>

export type TripLegFormErrors = Partial<Record<keyof TripLegFormData, string>>
