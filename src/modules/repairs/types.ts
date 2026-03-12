export interface RepairFormData {
  sourceType: 'WORK_ORDER' | 'EXTERNAL_REQUEST'
  workOrderId: string
  externalRequestId: string
  performedDate: string
  performedTime: string
  unitKilometersInput: string
  currency: 'ARS' | 'USD'
  supplierName: string
  realCostInput: string
  surchargePercentInput: string
  invoiceFileName: string
  invoiceFileBase64: string
  invoiceFileUrl: string
}

export type RepairFormField = keyof RepairFormData

export type RepairFormErrors = Partial<Record<RepairFormField, string>>

export interface RepairViewItem {
  id: string
  unitId: string
  unitLabel: string
  sourceType: 'WORK_ORDER' | 'EXTERNAL_REQUEST'
  workOrderId: string
  workOrderLabel: string
  externalRequestId: string
  externalRequestLabel: string
  performedAt: string
  unitKilometers: number
  currency: 'ARS' | 'USD'
  supplierName: string
  realCost: number
  invoicedToClient: number
  margin: number
  invoiceFileName?: string
  invoiceFileUrl?: string
}
