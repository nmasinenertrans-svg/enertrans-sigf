import { useMemo, useState } from 'react'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { InventoryBarcodePanel } from '../components/InventoryBarcodePanel'
import { InventoryItemCard } from '../components/InventoryItemCard'
import { InventoryStockCard } from '../components/InventoryStockCard'
import { BackLink } from '../../../components/shared/BackLink'
import {
  applyBarcodeStockEntry,
  buildInventoryView,
  calcTotalStockValue,
  createEmptyInventoryItemFormData,
  createInventoryItemFromBarcode,
  generateInternalSku,
  mergeInventoryItemFromForm,
  normalizeBarcode,
  toInventoryItem,
  toInventoryItemFormData,
  validateInventoryItemFormData,
} from '../services/inventoryService'
import type {
  BarcodeEntryPayload,
  InventoryItemFormData,
  InventoryItemFormErrors,
  InventoryItemFormField,
  PendingBarcodeRegistration,
} from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { apiRequest } from '../../../services/api/apiClient'
import { inventoryUnits } from '../../../types/domain'

const lowStockThreshold = 5

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const unitLabels: Record<string, string> = {
  UNIDAD: 'Unidad (un.)',
  LITRO: 'Litro (L)',
  KG: 'Kilogramo (kg)',
  METRO: 'Metro (m)',
}

export const InventoryPage = () => {
  const { can } = usePermissions()
  const {
    state: { inventoryItems, featureFlags },
    actions: { setInventoryItems, setAppError },
  } = useAppContext()

  const canCreate = can('INVENTORY', 'create')
  const canEdit = can('INVENTORY', 'edit')
  const canDelete = can('INVENTORY', 'delete')

  const [formData, setFormData] = useState<InventoryItemFormData>(createEmptyInventoryItemFormData)
  const [errors, setErrors] = useState<InventoryItemFormErrors>({})
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [itemIdPendingDelete, setItemIdPendingDelete] = useState<string | null>(null)
  const [pendingBarcodeRegistration, setPendingBarcodeRegistration] = useState<PendingBarcodeRegistration | null>(null)

  const inventoryView = useMemo(() => buildInventoryView(inventoryItems), [inventoryItems])
  const totalValue = useMemo(() => calcTotalStockValue(inventoryItems), [inventoryItems])

  const summary = useMemo(
    () => ({
      totalItems: inventoryView.length,
      totalStockUnits: inventoryView.reduce((acc, item) => acc + item.stock, 0),
      lowStockItems: inventoryView.filter((item) => item.stock <= lowStockThreshold).length,
    }),
    [inventoryView],
  )

  if (!featureFlags.showInventoryModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Inventario</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const resetForm = () => {
    setEditingItemId(null)
    setErrors({})
    setFormData(createEmptyInventoryItemFormData())
  }

  const handleFieldChange = <TField extends InventoryItemFormField>(field: TField, value: InventoryItemFormData[TField]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSubmitForm = () => {
    if (editingItemId ? !canEdit : !canCreate) return

    const validationErrors = validateInventoryItemFormData(formData, inventoryItems, editingItemId ?? undefined)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    if (editingItemId) {
      const selectedItem = inventoryItems.find((item) => item.id === editingItemId)
      if (!selectedItem) { resetForm(); return }

      const updatedItem = mergeInventoryItemFromForm(selectedItem, formData)
      const nextItems = inventoryItems.map((item) => item.id === editingItemId ? updatedItem : item)
      setInventoryItems(nextItems)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        apiRequest(`/inventory/${editingItemId}`, { method: 'PATCH', body: updatedItem }).catch(() => null)
      }
      resetForm()
      return
    }

    const createdItem = toInventoryItem(formData)
    setInventoryItems([createdItem, ...inventoryItems])
    enqueueAndSync({ id: `inventory.create.${createdItem.id}`, type: 'inventory.create', payload: createdItem, createdAt: new Date().toISOString() })
    resetForm()
  }

  const handleBarcodeEntry = (payload: BarcodeEntryPayload) => {
    if (!canEdit && !canCreate) return
    const normalizedBarcode = normalizeBarcode(payload.barcode)
    if (!normalizedBarcode || payload.quantity <= 0) return

    const barcodeResult = applyBarcodeStockEntry(inventoryItems, normalizedBarcode, payload.quantity)

    if (barcodeResult.matchedItem) {
      setInventoryItems(barcodeResult.nextItems)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const updatedItem = barcodeResult.nextItems.find((item) => item.id === barcodeResult.matchedItem?.id)
        if (updatedItem) apiRequest(`/inventory/${updatedItem.id}`, { method: 'PATCH', body: updatedItem }).catch(() => null)
      }
      setPendingBarcodeRegistration(null)
      return
    }

    // Producto nuevo: sugerir SKU interno automático
    setPendingBarcodeRegistration({
      barcode: normalizedBarcode,
      quantity: payload.quantity,
      productName: '',
      suggestedSku: generateInternalSku(inventoryItems),
    })
  }

  const handleConfirmBarcodeRegistration = () => {
    if ((!canEdit && !canCreate) || !pendingBarcodeRegistration) return

    if (!pendingBarcodeRegistration.productName.trim()) {
      setAppError('Debes ingresar nombre de producto para dar de alta el nuevo SKU.')
      return
    }

    const { createdItem, nextItems } = createInventoryItemFromBarcode(
      inventoryItems,
      pendingBarcodeRegistration.barcode,
      pendingBarcodeRegistration.productName,
      pendingBarcodeRegistration.quantity,
      'UNIDAD',
      undefined,
      'ARS',
      pendingBarcodeRegistration.suggestedSku,
    )
    setInventoryItems(nextItems)
    enqueueAndSync({ id: `inventory.create.${createdItem.id}`, type: 'inventory.create', payload: createdItem, createdAt: new Date().toISOString() })
    setPendingBarcodeRegistration(null)
  }

  const handleEditItem = (itemId: string) => {
    if (!canEdit) return
    const selectedItem = inventoryItems.find((item) => item.id === itemId)
    if (!selectedItem) return
    setEditingItemId(itemId)
    setFormData(toInventoryItemFormData(selectedItem))
  }

  const handleConfirmDelete = () => {
    if (!canDelete || !itemIdPendingDelete) return

    const selectedItem = inventoryItems.find((item) => item.id === itemIdPendingDelete)
    if (selectedItem && selectedItem.linkedWorkOrderIds.length > 0) {
      setAppError('No se puede eliminar un item vinculado a ordenes de trabajo.')
      setItemIdPendingDelete(null)
      return
    }

    setInventoryItems(inventoryItems.filter((item) => item.id !== itemIdPendingDelete))
    if (editingItemId === itemIdPendingDelete) resetForm()
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/inventory/${itemIdPendingDelete}`, { method: 'DELETE' }).catch(() => null)
    }
    setItemIdPendingDelete(null)
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Inventario</h2>
        <p className="text-sm text-slate-600">Control de SKU, stock, movimientos y vinculo con OT.</p>
      </header>

      <InventoryStockCard
        totalItems={summary.totalItems}
        totalStockUnits={summary.totalStockUnits}
        lowStockItems={summary.lowStockItems}
        totalValueArs={totalValue.ars}
        totalValueUsd={totalValue.usd}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          {canCreate || canEdit ? (
            <>
              <InventoryBarcodePanel onSubmitBarcode={handleBarcodeEntry} />

              {pendingBarcodeRegistration ? (
                <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-amber-900">Código no encontrado</h3>
                  <p className="mt-1 text-xs text-amber-700">
                    Código escaneado: <span className="font-mono font-semibold">{pendingBarcodeRegistration.barcode}</span>
                    {' '}· Cantidad: {pendingBarcodeRegistration.quantity}
                  </p>
                  <p className="mt-2 text-xs text-amber-700">
                    Se asignará el SKU interno <span className="font-mono font-semibold">{pendingBarcodeRegistration.suggestedSku}</span>.
                    El código de barras original quedará guardado para futuras lecturas.
                  </p>

                  <div className="mt-3 space-y-2">
                    <input
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500"
                      value={pendingBarcodeRegistration.productName}
                      onChange={(e) => setPendingBarcodeRegistration((prev) => prev ? { ...prev, productName: e.target.value } : prev)}
                      placeholder="Nombre del producto *"
                      autoFocus
                    />
                    <input
                      className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-600 outline-none focus:border-amber-500"
                      value={pendingBarcodeRegistration.suggestedSku}
                      onChange={(e) => setPendingBarcodeRegistration((prev) => prev ? { ...prev, suggestedSku: e.target.value.toUpperCase() } : prev)}
                      placeholder="SKU interno (modificable)"
                    />
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmBarcodeRegistration}
                      className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
                    >
                      Dar de alta y sumar stock
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingBarcodeRegistration(null)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Cancelar
                    </button>
                  </div>
                </section>
              ) : null}

              <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-lg font-bold text-slate-900">{editingItemId ? 'Editar item' : 'Alta manual de item'}</h3>

                <form
                  className="mt-4 grid grid-cols-1 gap-3"
                  onSubmit={(e) => { e.preventDefault(); handleSubmitForm() }}
                >
                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">SKU</span>
                    <div className="flex gap-2">
                      <input
                        className={inputClassName}
                        value={formData.sku}
                        onChange={(e) => handleFieldChange('sku', e.target.value)}
                        placeholder="SKU interno"
                      />
                      {!editingItemId && (
                        <button
                          type="button"
                          onClick={() => handleFieldChange('sku', generateInternalSku(inventoryItems))}
                          className="flex-shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                          title="Generar SKU automático"
                        >
                          Auto
                        </button>
                      )}
                    </div>
                    {errors.sku && <span className="text-xs font-semibold text-rose-700">{errors.sku}</span>}
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">Producto</span>
                    <input
                      className={inputClassName}
                      value={formData.productName}
                      onChange={(e) => handleFieldChange('productName', e.target.value)}
                      placeholder="Nombre del producto"
                    />
                    {errors.productName && <span className="text-xs font-semibold text-rose-700">{errors.productName}</span>}
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">Unidad de medida</span>
                    <select
                      className={inputClassName}
                      value={formData.unit}
                      onChange={(e) => handleFieldChange('unit', e.target.value as InventoryItemFormData['unit'])}
                    >
                      {inventoryUnits.map((u) => (
                        <option key={u} value={u}>{unitLabels[u]}</option>
                      ))}
                    </select>
                  </label>

                  <label className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold text-slate-700">
                      Stock inicial{formData.unit !== 'UNIDAD' ? ` (${formData.unit === 'LITRO' ? 'L' : formData.unit === 'KG' ? 'kg' : 'm'})` : ''}
                    </span>
                    <input
                      type="number"
                      min={0}
                      step={formData.unit !== 'UNIDAD' ? '0.1' : '1'}
                      className={inputClassName}
                      value={formData.stock}
                      onChange={(e) => handleFieldChange('stock', Number(e.target.value))}
                    />
                    {errors.stock && <span className="text-xs font-semibold text-rose-700">{errors.stock}</span>}
                  </label>

                  <div className="grid grid-cols-3 gap-2">
                    <label className="col-span-2 flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-slate-700">Precio unitario</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className={inputClassName}
                        value={formData.unitPrice}
                        onChange={(e) => handleFieldChange('unitPrice', e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-sm font-semibold text-slate-700">Moneda</span>
                      <select
                        className={inputClassName}
                        value={formData.currency}
                        onChange={(e) => handleFieldChange('currency', e.target.value as 'ARS' | 'USD')}
                      >
                        <option value="ARS">ARS</option>
                        <option value="USD">USD</option>
                      </select>
                    </label>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    {editingItemId && (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Cancelar edicion
                      </button>
                    )}
                    <button
                      type="submit"
                      className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                    >
                      {editingItemId ? 'Guardar cambios' : 'Guardar item'}
                    </button>
                  </div>
                </form>
              </section>
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenes permisos para crear o editar items de inventario.
            </section>
          )}
        </div>

        <div className="xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-lg font-bold text-slate-900">Listado de inventario</h3>
            <p className="mt-1 text-sm text-slate-600">Stock actual y movimientos por SKU.</p>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {inventoryView.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                  No hay items de inventario cargados.
                </div>
              ) : (
                inventoryView.map((item) => (
                  <InventoryItemCard
                    key={item.id}
                    item={item}
                    onEdit={handleEditItem}
                    onDelete={setItemIdPendingDelete}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(itemIdPendingDelete)}
          title="Eliminar item de inventario"
          message="Deseas eliminar este item? Esta accion no se puede deshacer."
          onCancel={() => setItemIdPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  )
}
