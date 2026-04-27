import type { FleetProjectType, FleetProjectStatus, FleetProjectItemStatus, TaskPriority } from '../../types/domain'

export interface ProjectFormData {
  title: string
  projectType: FleetProjectType | ''
  status: FleetProjectStatus
  priority: TaskPriority
  unitId: string
  description: string
  estimatedCost: string
  actualCost: string
  currency: 'ARS' | 'USD'
  assignedToUserId: string
  targetDate: string
  modificationNotes: string
}

export interface ItemFormData {
  title: string
  description: string
  assignedToUserId: string
}

export const createEmptyProjectForm = (): ProjectFormData => ({
  title: '',
  projectType: '',
  status: 'PENDING',
  priority: 'MEDIUM',
  unitId: '',
  description: '',
  estimatedCost: '0',
  actualCost: '0',
  currency: 'ARS',
  assignedToUserId: '',
  targetDate: '',
  modificationNotes: '',
})

export const createEmptyItemForm = (): ItemFormData => ({
  title: '',
  description: '',
  assignedToUserId: '',
})

export const PROJECT_TYPE_LABELS: Record<FleetProjectType, string> = {
  HYDROCRANE_CHANGE: 'Cambio de hidrogrúa',
  THIRD_AXLE: 'Tercer eje',
  BOX_EXTENSION: 'Alargue de caja',
  BODY_MODIFICATION: 'Modificación de carrocería',
  ENGINE_OVERHAUL: 'Revisión mayor de motor',
  TRANSMISSION: 'Caja de cambios',
  SUSPENSION: 'Suspensión',
  ELECTRICAL: 'Sistema eléctrico',
  BRAKE_SYSTEM: 'Sistema de frenos',
  OTHER: 'Otro',
}

export const PROJECT_STATUS_LABELS: Record<FleetProjectStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En ejecución',
  ON_HOLD: 'En pausa',
  COMPLETED: 'Completado',
  CANCELED: 'Cancelado',
}

export const PROJECT_STATUS_COLORS: Record<FleetProjectStatus, string> = {
  PENDING: 'border-slate-300 bg-slate-50 text-slate-600',
  IN_PROGRESS: 'border-sky-300 bg-sky-50 text-sky-700',
  ON_HOLD: 'border-amber-300 bg-amber-50 text-amber-700',
  COMPLETED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  CANCELED: 'border-rose-300 bg-rose-50 text-rose-700',
}

export const ITEM_STATUS_LABELS: Record<FleetProjectItemStatus, string> = {
  PENDING: 'Pendiente',
  IN_PROGRESS: 'En progreso',
  DONE: 'Listo',
  SKIPPED: 'Omitido',
}

export const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

export const PRIORITY_COLORS: Record<string, string> = {
  LOW: 'border-slate-300 bg-slate-50 text-slate-600',
  MEDIUM: 'border-sky-300 bg-sky-50 text-sky-700',
  HIGH: 'border-amber-300 bg-amber-50 text-amber-700',
  URGENT: 'border-rose-300 bg-rose-50 text-rose-700',
}
