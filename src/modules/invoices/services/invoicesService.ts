import type { FleetUnit, Invoice, InvoiceLineItem, RepairRecord, WorkOrder } from '../../../types/domain'
import type { InvoiceFormData, InvoiceFormErrors, InvoiceLineItemDraft } from '../types'

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
  } else if (lastComma !== -1 || lastDot !== -1) {
    // Solo aparece un tipo de separador, pero puede aparecer mas de una vez
    // (ej. "1.500.000" o el typo "1.500.0"): el ultimo es el decimal si deja
    // 1 o 2 digitos despues, y cualquier aparicion anterior del mismo
    // separador se limpia como separador de miles.
    const sep = lastComma !== -1 ? ',' : '.'
    const lastIndex = lastComma !== -1 ? lastComma : lastDot
    const decimals = cleaned.length - lastIndex - 1
    if (decimals >= 1 && decimals <= 2) {
      normalized = `${cleaned.slice(0, lastIndex).split(sep).join('')}.${cleaned.slice(lastIndex + 1)}`
    } else {
      normalized = cleaned.split(sep).join('')
    }
  } else {
    normalized = cleaned
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export const createEmptyLineItemDraft = (): InvoiceLineItemDraft => ({
  workOrderId: '',
  unitId: '',
  description: '',
  amountInput: '',
})

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
  hasLineItems: false,
  lineItems: [createEmptyLineItemDraft()],
})

export const validateInvoiceFormData = (formData: InvoiceFormData): InvoiceFormErrors => {
  const errors: InvoiceFormErrors = {}

  if (!formData.providerName.trim()) {
    errors.providerName = 'El proveedor es obligatorio.'
  }

  if (formData.amountInput.trim() && parseMoney(formData.amountInput) <= 0) {
    errors.amountInput = 'El monto debe ser mayor a cero.'
  }

  if (formData.hasLineItems) {
    const hasValidItem = formData.lineItems.some(
      (item) => item.description.trim() && parseMoney(item.amountInput) > 0,
    )
    if (!hasValidItem) {
      errors.lineItems = 'Agrega al menos un item del desglose con descripcion y monto validos.'
    }
  }

  return errors
}

export const parseInvoiceLineItems = (drafts: InvoiceLineItemDraft[]): InvoiceLineItem[] =>
  drafts
    .map((item) => ({
      workOrderId: item.workOrderId || null,
      unitId: item.unitId || null,
      description: item.description.trim(),
      amount: parseMoney(item.amountInput),
    }))
    .filter((item) => item.description && item.amount > 0)

export const toLineItemDrafts = (lineItems?: InvoiceLineItem[]): InvoiceLineItemDraft[] => {
  if (!lineItems || lineItems.length === 0) {
    return [createEmptyLineItemDraft()]
  }
  return lineItems.map((item) => ({
    workOrderId: item.workOrderId ?? '',
    unitId: item.unitId ?? '',
    description: item.description,
    amountInput: String(item.amount),
  }))
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
  lineItems: formData.hasLineItems ? parseInvoiceLineItems(formData.lineItems) : [],
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
  lineItems: formData.hasLineItems ? parseInvoiceLineItems(formData.lineItems) : [],
})

export interface InvoiceLineItemView extends InvoiceLineItem {
  unitLabel: string
  workOrderLabel: string
}

export interface InvoiceViewItem extends Invoice {
  repairLabel: string
  unitLabel: string
  inventoryItemLabels: string[]
  lineItemViews: InvoiceLineItemView[]
}

export const buildInvoiceView = (
  invoices: Invoice[],
  repairs: RepairRecord[],
  fleetUnits: FleetUnit[],
  inventoryItemLabelById: Map<string, string>,
  workOrders: WorkOrder[] = [],
): InvoiceViewItem[] => {
  const unitCodeById = new Map(fleetUnits.map((unit) => [unit.id, unit.internalCode]))
  const workOrderCodeById = new Map(workOrders.map((workOrder) => [workOrder.id, workOrder.code]))

  return invoices.map((invoice) => {
    const repair = invoice.repairId ? repairs.find((item) => item.id === invoice.repairId) : undefined
    const repairLabel = repair
      ? `${unitCodeById.get(repair.unitId) ?? 'Unidad'} · ${repair.supplierName || 'Reparación'}`
      : ''
    const unitLabel = invoice.unitId ? unitCodeById.get(invoice.unitId) ?? '' : ''
    const inventoryItemLabels = invoice.inventoryItemIds
      .map((id) => inventoryItemLabelById.get(id))
      .filter((label): label is string => Boolean(label))
    const lineItemViews = (invoice.lineItems ?? []).map((item) => ({
      ...item,
      unitLabel: item.unitId ? unitCodeById.get(item.unitId) ?? '' : '',
      workOrderLabel: item.workOrderId ? workOrderCodeById.get(item.workOrderId) ?? '' : '',
    }))

    return {
      ...invoice,
      repairLabel,
      unitLabel,
      inventoryItemLabels,
      lineItemViews,
    }
  })
}
