import type { ChecklistItems, HandoverChecklistType } from '../../types/domain'

export interface HandoverChecklistFormData {
  code: string
  type: HandoverChecklistType
  unitId: string
  clientId: string
  clientName: string
  contractId: string
  responsibleName: string
  performedAt: string
  unitKilometersInput: string
  engineHoursInput: string
  fuelLevelPctInput: string
  checklist: ChecklistItems
  damagesFound: string
  chargeToClientUsdInput: string
  photoUrls: string[]
  signedActUrl: string
  observations: string
}

export type HandoverChecklistFormField = keyof HandoverChecklistFormData

export type HandoverChecklistFormErrors = Partial<Record<HandoverChecklistFormField, string>>
