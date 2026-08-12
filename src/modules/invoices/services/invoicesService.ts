import type { FleetUnit, Invoice, RepairRecord } from '../../../types/domain'
import type { InvoiceFormData, InvoiceFormErrors } from '../types'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `invoice-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const parseMoney = (value: string): number => {
  const normalized = value.replace(/\./g, '').replace(',', '.')
  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export const createEmptyInvoiceFormData = (): InvoiceFormData => ({
  providerName: '',
  supplierId: '',
  invoiceNumber: '',
  amountInput: '',
  currency: 'ARS',
  issuedAt: '',
  notes: '',
  fileName: '',
  fileBase64: '',
  fileUrl: '',
  repairId: '',
  inventoryItemIds: [],
})

export const validateInvoiceFormData = (formData: InvoiceFormData): InvoiceFormErrors => {
  const errors: InvoiceFormErrors = {}

  if (!formData.providerName.trim()) {
    errors.providerName = 'El proveedor es obligatorio.'
  }

  if (formData.amountInput.trim() && parseMoney(formData.amountInput) <= 0) {
    errors.amountInput = 'El monto debe ser mayor a cero.'
  }

  return errors
}

export const toInvoicePayload = (formData: InvoiceFormData): Invoice => ({
  id: createId(),
  code: '',
  providerName: formData.providerName.trim(),
  supplierId: formData.supplierId || null,
  invoiceNumber: formData.invoiceNumber.trim(),
  amount: parseMoney(formData.amountInput),
  currency: formData.currency,
  issuedAt: formData.issuedAt ? new Date(formData.issuedAt).toISOString() : null,
  notes: formData.notes.trim(),
  fileName: formData.fileName,
  fileBase64: formData.fileBase64,
  fileUrl: formData.fileUrl,
  repairId: formData.repairId || null,
  inventoryItemIds: formData.inventoryItemIds,
  createdByUserId: '',
})

export interface InvoiceViewItem extends Invoice {
  repairLabel: string
  inventoryItemLabels: string[]
}

export const buildInvoiceView = (
  invoices: Invoice[],
  repairs: RepairRecord[],
  fleetUnits: FleetUnit[],
  inventoryItemLabelById: Map<string, string>,
): InvoiceViewItem[] => {
  const unitCodeById = new Map(fleetUnits.map((unit) => [unit.id, unit.internalCode]))

  return invoices.map((invoice) => {
    const repair = invoice.repairId ? repairs.find((item) => item.id === invoice.repairId) : undefined
    const repairLabel = repair
      ? `${unitCodeById.get(repair.unitId) ?? 'Unidad'} · ${repair.supplierName || 'Reparación'}`
      : ''
    const inventoryItemLabels = invoice.inventoryItemIds
      .map((id) => inventoryItemLabelById.get(id))
      .filter((label): label is string => Boolean(label))

    return {
      ...invoice,
      repairLabel,
      inventoryItemLabels,
    }
  })
}
