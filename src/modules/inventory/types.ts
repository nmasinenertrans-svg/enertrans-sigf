import type { InventoryUnit } from '../../types/domain'

export interface InventoryItemFormData {
  sku: string
  productName: string
  stock: number
  unit: InventoryUnit
  unitPrice: string
  currency: 'ARS' | 'USD'
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
  suggestedSku: string
}

export interface InventoryViewItem {
  id: string
  sku: string
  externalBarcode?: string
  productName: string
  stock: number
  unit: InventoryUnit
  unitPrice?: number
  currency?: 'ARS' | 'USD'
  movementHistory: string[]
  linkedWorkOrderIds: string[]
}
