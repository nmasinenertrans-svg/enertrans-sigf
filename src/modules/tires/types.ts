export interface TireFormData {
  unitId: string
  position: string
  brand: string
  model: string
  installedAt: string
  installedKmInput: string
  costBaseInput: string
  currency: 'ARS' | 'USD'
  notes: string
}

export type TireFormField = keyof TireFormData

export type TireFormErrors = Partial<Record<TireFormField, string>>
