import type { WorkOrderDeviation, WorkOrderStatus } from '../../types/domain'

export interface WorkOrderFormData {
  vehicleMode: 'fleet' | 'external'
  unitId: string
  externalVehicle: string
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
  unitId: string | null
  externalVehicle: string | null
  unitLabel: string
  status: WorkOrderStatus
  statusLabel: string
  taskList: WorkOrderDeviation[]
  spareParts: string[]
  laborDetail: string
  linkedInventorySkuList: string[]
}
