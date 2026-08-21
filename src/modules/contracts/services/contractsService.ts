import type { FleetUnit, RentalContract } from '../../../types/domain'
import type { ContractFormData, ContractFormErrors } from '../types'

const parseMoney = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

const toDateInput = (isoDate: string): string => {
  const parsed = new Date(isoDate)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toISOString().slice(0, 10)
}

const toIsoFromDateInput = (dateInput: string): string => {
  const parsed = new Date(`${dateInput}T12:00:00.000Z`)
  return parsed.toISOString()
}

export const createEmptyContractFormData = (): ContractFormData => ({
  code: '',
  unitId: '',
  clientId: '',
  clientName: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  monthlyValueInput: '',
  currency: 'ARS',
  status: 'ACTIVE',
  notes: '',
})

export const toContractFormData = (contract: RentalContract): ContractFormData => ({
  code: contract.code,
  unitId: contract.unitId,
  clientId: contract.clientId ?? '',
  clientName: contract.clientName,
  startDate: toDateInput(contract.startDate),
  endDate: toDateInput(contract.endDate),
  monthlyValueInput: String(contract.monthlyValue),
  currency: contract.currency,
  status: contract.status,
  notes: contract.notes,
})

export const validateContractFormData = (formData: ContractFormData): ContractFormErrors => {
  const errors: ContractFormErrors = {}

  if (!formData.unitId) {
    errors.unitId = 'Debes seleccionar una unidad.'
  }
  if (!formData.startDate) {
    errors.startDate = 'La fecha de inicio es obligatoria.'
  }
  if (!formData.endDate) {
    errors.endDate = 'La fecha de fin es obligatoria.'
  } else if (formData.startDate && formData.endDate <= formData.startDate) {
    errors.endDate = 'La fecha de fin debe ser posterior a la de inicio.'
  }
  if (formData.monthlyValueInput.trim() && parseMoney(formData.monthlyValueInput) < 0) {
    errors.monthlyValueInput = 'El valor mensual no puede ser negativo.'
  }

  return errors
}

export const toContractPayload = (formData: ContractFormData) => ({
  code: formData.code.trim(),
  unitId: formData.unitId,
  clientId: formData.clientId || null,
  clientName: formData.clientName.trim(),
  startDate: toIsoFromDateInput(formData.startDate),
  endDate: toIsoFromDateInput(formData.endDate),
  monthlyValue: parseMoney(formData.monthlyValueInput),
  currency: formData.currency,
  status: formData.status,
  notes: formData.notes.trim(),
})

export interface ContractViewItem extends RentalContract {
  unitLabel: string
  daysUntilExpiration: number
}

export const buildContractView = (contracts: RentalContract[], fleetUnits: FleetUnit[]): ContractViewItem[] => {
  const unitById = new Map(fleetUnits.map((unit) => [unit.id, unit]))
  const now = Date.now()

  return contracts
    .map((contract) => {
      const unit = unitById.get(contract.unitId)
      const unitLabel = unit ? `${unit.internalCode} - ${unit.brand} ${unit.model}` : 'Unidad no disponible'
      const endTime = new Date(contract.endDate).getTime()
      const daysUntilExpiration = Number.isFinite(endTime)
        ? Math.ceil((endTime - now) / (24 * 60 * 60 * 1000))
        : 0
      return { ...contract, unitLabel, daysUntilExpiration }
    })
    .sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime())
}
