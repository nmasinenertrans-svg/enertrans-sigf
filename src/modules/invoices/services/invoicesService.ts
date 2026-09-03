import type { FleetUnit, Invoice, RepairRecord } from '../../../types/domain'
import type { InvoiceFormData, InvoiceFormErrors } from '../types'

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `invoice-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

/**
 * Acepta tanto "650.000,50" (formato AR) como "650,000.50" o "650000.50"
 * (formato US, como lo tipea gente acostumbrada a teclado numerico o copia
 * de una factura en ingles). El separador decimal es el que aparece mas a
 * la derecha; si solo hay uno de los dos y deja 1 o 2 digitos despues, se
 * toma como decimal, sino como separador de miles (nadie escribe centavos
 * con 3+ digitos).
 */
export const parseMoney = (value: string): number => {
  const cleaned = value.trim().replace(/[^\d.,-]/g, '')
  if (!cleaned) {
    return 0
  }

  const lastComma = cleaned.lastIndexOf(',')
  const lastDot = cleaned.lastIndexOf('.')

  let normalized: string
  if (lastComma !== -1 && lastDot !== -1) {
    normalized =
      lastComma > lastDot
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '')
  } else if (lastComma !== -1) {
    const decimals = cleaned.length - lastComma - 1
    normalized = decimals >= 1 && decimals <= 2 ? cleaned.replace(',', '.') : cleaned.replace(/,/g, '')
  } else if (lastDot !== -1) {
    const decimals = cleaned.length - lastDot - 1
    normalized = decimals >= 1 && decimals <= 2 ? cleaned : cleaned.replace(/\./g, '')
  } else {
    normalized = cleaned
  }

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
  unitId: '',
  inventoryItemIds: [],
  inventoryItemQuantityInputs: {},
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

const buildInventoryItemQuantities = (formData: InvoiceFormData): Record<string, number> => {
  const quantities: Record<string, number> = {}
  formData.inventoryItemIds.forEach((id) => {
    const quantity = parseMoney(formData.inventoryItemQuantityInputs[id] ?? '')
    if (quantity > 0) {
      quantities[id] = quantity
    }
  })
  return quantities
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
  unitId: formData.unitId || null,
  inventoryItemIds: formData.inventoryItemIds,
  inventoryItemQuantities: buildInventoryItemQuantities(formData),
  createdByUserId: '',
})

export const toInvoiceUpdateFields = (formData: InvoiceFormData): Partial<Invoice> => ({
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
  unitId: formData.unitId || null,
  inventoryItemIds: formData.inventoryItemIds,
  inventoryItemQuantities: buildInventoryItemQuantities(formData),
})

export interface InvoiceViewItem extends Invoice {
  repairLabel: string
  unitLabel: string
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
    const unitLabel = invoice.unitId ? unitCodeById.get(invoice.unitId) ?? '' : ''
    const inventoryItemLabels = invoice.inventoryItemIds
      .map((id) => inventoryItemLabelById.get(id))
      .filter((label): label is string => Boolean(label))

    return {
      ...invoice,
      repairLabel,
      unitLabel,
      inventoryItemLabels,
    }
  })
}
