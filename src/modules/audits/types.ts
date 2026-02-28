import type { AuditChecklistSection, AuditChecklistStatus } from '../../types/domain'

export interface AuditChecklistItemDraft {
  id: string
  label: string
  status: AuditChecklistStatus
  observation: string
}

export interface AuditChecklistSectionDraft {
  id: string
  title: string
  items: AuditChecklistItemDraft[]
}

export interface AuditFormData {
  unitId: string
  auditMode: 'INDEPENDENT' | 'EXTERNAL_REQUEST'
  externalRequestId: string
  observations: string
  checklistSections: AuditChecklistSectionDraft[]
  photoBase64List: string[]
  unitKilometers: number
  engineHours: number
  hydroHours: number
}

export type AuditFormErrors = {
  unitId?: string
  auditMode?: string
  externalRequestId?: string
  checklistSections?: string
  observations?: string
  unitKilometers?: string
  engineHours?: string
  hydroHours?: string
}

export interface AuditHistoryViewItem {
  code: string
  auditKind: 'AUDIT' | 'REAUDIT'
  id: string
  unitId: string
  unitLabel: string
  performedAt: string
  auditorName: string
  resultLabel: string
  resultClassName: string
  observations: string
  unitKilometers: number
  engineHours: number
  hydroHours: number
  photoCount: number
  sections: AuditChecklistSection[]
  syncState?: 'SYNCED' | 'PENDING' | 'LOCAL_ONLY' | 'ERROR'
  syncError?: string
}
