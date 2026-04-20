import type { InventoryItem } from '../../../types/domain'
import type {
  InventoryItemFormData,
  InventoryItemFormErrors,
  InventoryViewItem,
} from '../types'

const MAX_TEXT_LENGTH = 120

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `inventory-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const nowIso = (): string => new Date().toISOString()

const normalizeSku = (value: string): string => value.trim().toUpperCase()

const normalizeName = (value: string): string => value.trim()

export const isLiquidUnit = (unit: InventoryItem['unit']): boolean =>
  unit === 'LITRO' || unit === 'KG' || unit === 'METRO'

export const unitLabel = (unit: InventoryItem['unit']): string => {
  const map: Record<InventoryItem['unit'], string> = {
    UNIDAD: 'un.',
    LITRO: 'L',
    KG: 'kg',
    METRO: 'm',
  }
  return map[unit]
}

export const formatStock = (stock: number, unit: InventoryItem['unit']): string => {
  const label = unitLabel(unit)
  if (isLiquidUnit(unit)) {
    return `${stock % 1 === 0 ? stock : stock.toFixed(1)} ${label}`
  }
  return `${Math.floor(stock)} ${label}`
}

export const generateInternalSku = (inventoryItems: InventoryItem[]): string => {
  const maxNum = inventoryItems.reduce((max, item) => {
    const match = item.sku.match(/^ENT-(\d+)$/)
    return match ? Math.max(max, parseInt(match[1], 10)) : max
  }, 0)
  return `ENT-${String(maxNum + 1).padStart(6, '0')}`
}

export const createInventoryMovementLog = (action: 'IN' | 'OUT' | 'ADJUST', quantity: number, source: string, unit: InventoryItem['unit'] = 'UNIDAD'): string => {
  const sign = action === 'OUT' ? '-' : '+'
  return `${nowIso()} | ${action} | ${sign}${formatStock(quantity, unit)} | ${source}`
}

export const createEmptyInventoryItemFormData = (): InventoryItemFormData => ({
  sku: '',
  productName: '',
  stock: 0,
  unit: 'UNIDAD',
  unitPrice: '',
  currency: 'ARS',
})

export const toInventoryItemFormData = (item: InventoryItem): InventoryItemFormData => ({
  sku: item.sku,
  productName: item.productName,
  stock: item.stock,
  unit: item.unit ?? 'UNIDAD',
  unitPrice: item.unitPrice != null ? String(item.unitPrice) : '',
  currency: item.currency ?? 'ARS',
})

export const validateInventoryItemFormData = (
  formData: InventoryItemFormData,
  inventoryItems: InventoryItem[],
  excludedItemId?: string,
): InventoryItemFormErrors => {
  const validationErrors: InventoryItemFormErrors = {}
  const normalizedSku = normalizeSku(formData.sku)
  const normalizedName = normalizeName(formData.productName)

  if (!normalizedSku) {
    validationErrors.sku = 'El SKU es obligatorio.'
  } else if (normalizedSku.length > MAX_TEXT_LENGTH) {
    validationErrors.sku = 'El SKU supera el largo maximo permitido.'
  } else if (
    inventoryItems.some(
      (item) => normalizeSku(item.sku) === normalizedSku && (!excludedItemId || item.id !== excludedItemId),
    )
  ) {
    validationErrors.sku = 'Ya existe un item con este SKU.'
  }

  if (!normalizedName) {
    validationErrors.productName = 'El producto es obligatorio.'
  } else if (normalizedName.length > MAX_TEXT_LENGTH) {
    validationErrors.productName = 'El producto supera el largo maximo permitido.'
  }

  if (formData.stock < 0) {
    validationErrors.stock = 'El stock no puede ser negativo.'
  }

  return validationErrors
}

const parseUnitPrice = (value: string): number | undefined => {
  const parsed = parseFloat(value.replace(',', '.'))
  return isNaN(parsed) || parsed < 0 ? undefined : parsed
}

const normalizeStock = (stock: number, unit: InventoryItem['unit']): number =>
  isLiquidUnit(unit) ? Math.round(stock * 10) / 10 : Math.floor(stock)

export const toInventoryItem = (formData: InventoryItemFormData, externalBarcode?: string): InventoryItem => {
  const unit = formData.unit ?? 'UNIDAD'
  const stock = normalizeStock(formData.stock, unit)
  return {
    id: createId(),
    sku: normalizeSku(formData.sku),
    externalBarcode: externalBarcode ? normalizeSku(externalBarcode) : undefined,
    productName: normalizeName(formData.productName),
    stock,
    unit,
    unitPrice: parseUnitPrice(formData.unitPrice),
    currency: formData.currency ?? 'ARS',
    movementHistory: [createInventoryMovementLog('IN', stock, 'alta manual', unit)],
    linkedWorkOrderIds: [],
  }
}

export const mergeInventoryItemFromForm = (item: InventoryItem, formData: InventoryItemFormData): InventoryItem => {
  const unit = formData.unit ?? item.unit ?? 'UNIDAD'
  const normalizedStock = normalizeStock(formData.stock, unit)
  const delta = normalizedStock - item.stock

  const nextMovementHistory =
    delta === 0
      ? item.movementHistory
      : [
          ...item.movementHistory,
          createInventoryMovementLog(delta > 0 ? 'IN' : 'OUT', Math.abs(delta), 'ajuste manual de stock', unit),
        ]

  return {
    ...item,
    sku: normalizeSku(formData.sku),
    productName: normalizeName(formData.productName),
    stock: normalizedStock,
    unit,
    unitPrice: parseUnitPrice(formData.unitPrice),
    currency: formData.currency ?? 'ARS',
    movementHistory: nextMovementHistory,
  }
}

export const findInventoryItemBySku = (inventoryItems: InventoryItem[], sku: string): InventoryItem | undefined => {
  const normalized = normalizeSku(sku)
  return inventoryItems.find((item) => normalizeSku(item.sku) === normalized)
}

export const findInventoryItemByBarcode = (inventoryItems: InventoryItem[], barcode: string): InventoryItem | undefined => {
  const normalized = normalizeSku(barcode)
  return inventoryItems.find(
    (item) => normalizeSku(item.sku) === normalized || (item.externalBarcode && normalizeSku(item.externalBarcode) === normalized),
  )
}

export const applyBarcodeStockEntry = (
  inventoryItems: InventoryItem[],
  barcode: string,
  quantity: number,
): { nextItems: InventoryItem[]; matchedItem: InventoryItem | null } => {
  const matchedItem = findInventoryItemByBarcode(inventoryItems, barcode)

  if (!matchedItem) {
    return { nextItems: inventoryItems, matchedItem: null }
  }

  const unit = matchedItem.unit ?? 'UNIDAD'
  const nextItems = inventoryItems.map((item) => {
    if (item.id !== matchedItem.id) return item
    return {
      ...item,
      stock: normalizeStock(item.stock + quantity, unit),
      movementHistory: [...item.movementHistory, createInventoryMovementLog('IN', quantity, 'lector codigo barra', unit)],
    }
  })

  return { nextItems, matchedItem }
}

export const createInventoryItemFromBarcode = (
  inventoryItems: InventoryItem[],
  barcode: string,
  productName: string,
  quantity: number,
  unit: InventoryItem['unit'] = 'UNIDAD',
  unitPrice?: number,
  currency: 'ARS' | 'USD' = 'ARS',
  customSku?: string,
): { nextItems: InventoryItem[]; createdItem: InventoryItem } => {
  const sku = customSku ? normalizeSku(customSku) : generateInternalSku(inventoryItems)
  const stock = normalizeStock(quantity, unit)
  const createdItem: InventoryItem = {
    id: createId(),
    sku,
    externalBarcode: normalizeSku(barcode),
    productName: normalizeName(productName),
    stock,
    unit,
    unitPrice,
    currency,
    movementHistory: [createInventoryMovementLog('IN', stock, 'alta por lector codigo barra', unit)],
    linkedWorkOrderIds: [],
  }

  return { createdItem, nextItems: [createdItem, ...inventoryItems] }
}

export const buildInventoryView = (inventoryItems: InventoryItem[]): InventoryViewItem[] =>
  [...inventoryItems].sort((a, b) => a.sku.localeCompare(b.sku))

export const normalizeBarcode = (barcode: string): string => normalizeSku(barcode)

export const calcTotalStockValue = (inventoryItems: InventoryItem[]): { ars: number; usd: number } => {
  return inventoryItems.reduce(
    (acc, item) => {
      if (!item.unitPrice) return acc
      const value = item.stock * item.unitPrice
      if (item.currency === 'USD') return { ...acc, usd: acc.usd + value }
      return { ...acc, ars: acc.ars + value }
    },
    { ars: 0, usd: 0 },
  )
}
