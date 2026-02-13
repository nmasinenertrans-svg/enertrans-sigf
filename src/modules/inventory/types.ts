export interface InventoryItemFormData {
  sku: string
  productName: string
  stock: number
}

export type InventoryItemFormField = keyof InventoryItemFormData

export type InventoryItemFormErrors = Partial<Record<InventoryItemFormField, string>>

export interface BarcodeEntryPayload {
  barcode: string
  quantity: number
}

export interface PendingBarcodeRegistration {
  barcode: string
  quantity: number
  productName: string
}

export interface InventoryViewItem {
  id: string
  sku: string
  productName: string
  stock: number
  movementHistory: string[]
  linkedWorkOrderIds: string[]
}
