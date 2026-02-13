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

export const createInventoryMovementLog = (action: 'IN' | 'OUT' | 'ADJUST', quantity: number, source: string): string => {
  const signedQuantity = action === 'OUT' ? `-${quantity}` : `+${quantity}`
  return `${nowIso()} | ${action} | ${signedQuantity} | ${source}`
}

export const createEmptyInventoryItemFormData = (): InventoryItemFormData => ({
  sku: '',
  productName: '',
  stock: 0,
})

export const toInventoryItemFormData = (item: InventoryItem): InventoryItemFormData => ({
  sku: item.sku,
  productName: item.productName,
  stock: item.stock,
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

export const toInventoryItem = (formData: InventoryItemFormData): InventoryItem => ({
  id: createId(),
  sku: normalizeSku(formData.sku),
  productName: normalizeName(formData.productName),
  stock: Math.floor(formData.stock),
  movementHistory: [createInventoryMovementLog('IN', Math.floor(formData.stock), 'alta manual')],
  linkedWorkOrderIds: [],
})

export const mergeInventoryItemFromForm = (item: InventoryItem, formData: InventoryItemFormData): InventoryItem => {
  const normalizedStock = Math.floor(formData.stock)
  const delta = normalizedStock - item.stock

  const nextMovementHistory =
    delta === 0
      ? item.movementHistory
      : [
          ...item.movementHistory,
          createInventoryMovementLog(delta > 0 ? 'IN' : 'OUT', Math.abs(delta), 'ajuste manual de stock'),
        ]

  return {
    ...item,
    sku: normalizeSku(formData.sku),
    productName: normalizeName(formData.productName),
    stock: normalizedStock,
    movementHistory: nextMovementHistory,
  }
}

export const findInventoryItemBySku = (inventoryItems: InventoryItem[], sku: string): InventoryItem | undefined => {
  const normalizedSku = normalizeSku(sku)
  return inventoryItems.find((item) => normalizeSku(item.sku) === normalizedSku)
}

export const applyBarcodeStockEntry = (
  inventoryItems: InventoryItem[],
  sku: string,
  quantity: number,
): { nextItems: InventoryItem[]; matchedItem: InventoryItem | null } => {
  const normalizedSku = normalizeSku(sku)
  const matchedItem = findInventoryItemBySku(inventoryItems, normalizedSku)

  if (!matchedItem) {
    return { nextItems: inventoryItems, matchedItem: null }
  }

  const nextItems = inventoryItems.map((item) => {
    if (item.id !== matchedItem.id) {
      return item
    }

    return {
      ...item,
      stock: item.stock + quantity,
      movementHistory: [...item.movementHistory, createInventoryMovementLog('IN', quantity, 'lector codigo barra')],
    }
  })

  return { nextItems, matchedItem }
}

export const createInventoryItemFromBarcode = (
  inventoryItems: InventoryItem[],
  sku: string,
  productName: string,
  quantity: number,
): { nextItems: InventoryItem[]; createdItem: InventoryItem } => {
  const createdItem: InventoryItem = {
    id: createId(),
    sku: normalizeSku(sku),
    productName: normalizeName(productName),
    stock: quantity,
    movementHistory: [createInventoryMovementLog('IN', quantity, 'alta por lector codigo barra')],
    linkedWorkOrderIds: [],
  }

  return { createdItem, nextItems: [createdItem, ...inventoryItems] }
}

export const buildInventoryView = (inventoryItems: InventoryItem[]): InventoryViewItem[] =>
  [...inventoryItems].sort((left, right) => left.sku.localeCompare(right.sku))

export const normalizeBarcode = (barcode: string): string => normalizeSku(barcode)
