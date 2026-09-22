export interface BatteryFormData {
  unitId: string
  position: string
  brand: string
  model: string
  serialNumber: string
  installedAt: string
  lifespanMonthsInput: string
  notes: string
}

export type BatteryFormField = keyof BatteryFormData

export type BatteryFormErrors = Partial<Record<BatteryFormField, string>>
