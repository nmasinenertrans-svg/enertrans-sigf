import type { RentalContractStatus } from '../../types/domain'

export interface ContractFormData {
  code: string
  unitId: string
  clientId: string
  clientName: string
  startDate: string
  endDate: string
  monthlyValueInput: string
  currency: 'ARS' | 'USD'
  status: RentalContractStatus
  notes: string
}

export type ContractFormField = keyof ContractFormData

export type ContractFormErrors = Partial<Record<ContractFormField, string>>
