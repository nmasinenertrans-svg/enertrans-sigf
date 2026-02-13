import type { WorkOrderDeviation, WorkOrderStatus } from '../../types/domain'

export interface WorkOrderFormData {
  unitId: string
  status: WorkOrderStatus
  tasksInput: string
  sparePartsInput: string
  laborDetail: string
  linkedInventorySkuList: string[]
}

export type WorkOrderFormField = keyof WorkOrderFormData

export type WorkOrderFormErrors = Partial<Record<WorkOrderFormField, string>> & {
  taskResolution?: string
}

export interface WorkOrderViewItem {
  id: string
  code: string
  pendingReaudit: boolean
  unitId: string
  unitLabel: string
  status: WorkOrderStatus
  statusLabel: string
  taskList: WorkOrderDeviation[]
  spareParts: string[]
  laborDetail: string
  linkedInventorySkuList: string[]
}
