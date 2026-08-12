export interface InvoiceFormData {
  providerName: string
  supplierId: string
  invoiceNumber: string
  amountInput: string
  currency: 'ARS' | 'USD'
  issuedAt: string
  notes: string
  fileName: string
  fileBase64: string
  fileUrl: string
  repairId: string
  inventoryItemIds: string[]
}

export type InvoiceFormField = keyof InvoiceFormData

export type InvoiceFormErrors = Partial<Record<InvoiceFormField, string>>
