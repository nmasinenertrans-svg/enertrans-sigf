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
  vehicleMode: 'fleet' | 'external'
  unitId: string | null
  externalVehicle: string
  checklistType: 'HIDROGUA' | 'CAMION' | null
  newChecklistItems: Record<string, { estado: string; obs: string }>
  // Documentación Camión
  cedulaVenc: string
  tituloVenc: string
  vtvVenc: string
  seguroNroPol: string
  seguroVenc: string
  // Certificado Hidrogrúa
  certEnteCert: string
  certNro: string
  certVenc: string
  certCapacidad: string
  auditMode: 'INDEPENDENT' | 'EXTERNAL_REQUEST'
  manualResult: 'APPROVED' | 'REJECTED'
  externalRequestId: string
  observations: string
  checklistSections: AuditChecklistSectionDraft[]
  photoBase64List: string[]
  reportPdfFileName: string
  reportPdfFileBase64: string
  reportPdfFileUrl?: string
  unitKilometers: number
  engineHours: number
  hydroHours: number
  // Notas de una planilla de papel escaneada por IA que no se pudieron
  // mapear con confianza a ningun item del catalogo existente — se agregan
  // como una seccion extra al guardar, en vez de perderse o forzar un item
  // que no corresponde.
  scanUnmatchedNotes: { label: string; status: AuditChecklistStatus }[]
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
  reportPdfFileBase64?: string
}

export interface AuditHistoryViewItem {
  code: string
  auditKind: 'AUDIT' | 'REAUDIT'
  id: string
  unitId: string | null
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
