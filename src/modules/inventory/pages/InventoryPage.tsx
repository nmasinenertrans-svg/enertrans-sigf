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
  createEmptyInventoryItemFormData,
  createInventoryItemFromBarcode,
  findInventoryItemBySku,
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

const lowStockThreshold = 5

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const InventoryPage = () => {
  const { can } = usePermissions()
  const {
    state: { inventoryItems },
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

  const summary = useMemo(
    () => ({
      totalItems: inventoryView.length,
      totalStockUnits: inventoryView.reduce((accumulator, item) => accumulator + item.stock, 0),
      lowStockItems: inventoryView.filter((item) => item.stock <= lowStockThreshold).length,
      linkedToWorkOrders: inventoryView.filter((item) => item.linkedWorkOrderIds.length > 0).length,
    }),
    [inventoryView],
  )

  const resetForm = () => {
    setEditingItemId(null)
    setErrors({})
    setFormData(createEmptyInventoryItemFormData())
  }

  const handleFieldChange = <TField extends InventoryItemFormField>(field: TField, value: InventoryItemFormData[TField]) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      [field]: value,
    }))

    setErrors((previousErrors) => ({
      ...previousErrors,
      [field]: undefined,
    }))
  }

  const handleSubmitForm = () => {
    if (editingItemId ? !canEdit : !canCreate) {
      return
    }

    const validationErrors = validateInventoryItemFormData(formData, inventoryItems, editingItemId ?? undefined)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    if (editingItemId) {
      const selectedItem = inventoryItems.find((item) => item.id === editingItemId)

      if (!selectedItem) {
        resetForm()
        return
      }

      const nextItems = inventoryItems.map((item) =>
        item.id === editingItemId ? mergeInventoryItemFromForm(selectedItem, formData) : item,
      )

      setInventoryItems(nextItems)
      const updatedItem = mergeInventoryItemFromForm(selectedItem, formData)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        apiRequest(`/inventory/${editingItemId}`, { method: 'PATCH', body: updatedItem }).catch(() => null)
      }
      resetForm()
      return
    }

    const createdItem = toInventoryItem(formData)
    setInventoryItems([createdItem, ...inventoryItems])
    enqueueAndSync({
      id: `inventory.create.${createdItem.id}`,
      type: 'inventory.create',
      payload: createdItem,
      createdAt: new Date().toISOString(),
    })
    resetForm()
  }

  const handleBarcodeEntry = (payload: BarcodeEntryPayload) => {
    if (!canEdit && !canCreate) {
      return
    }

    const normalizedBarcode = normalizeBarcode(payload.barcode)

    if (!normalizedBarcode || payload.quantity <= 0) {
      return
    }

    const barcodeResult = applyBarcodeStockEntry(inventoryItems, normalizedBarcode, payload.quantity)

    if (barcodeResult.matchedItem) {
      setInventoryItems(barcodeResult.nextItems)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const updatedItem = barcodeResult.nextItems.find((item) => item.id === barcodeResult.matchedItem?.id)
        if (updatedItem) {
          apiRequest(`/inventory/${updatedItem.id}`, { method: 'PATCH', body: updatedItem }).catch(() => null)
        }
      }
      setPendingBarcodeRegistration(null)
      return
    }

    setPendingBarcodeRegistration({
      barcode: normalizedBarcode,
      quantity: payload.quantity,
      productName: '',
    })
  }

  const handleConfirmBarcodeRegistration = () => {
    if (!canEdit && !canCreate) {
      return
    }

    if (!pendingBarcodeRegistration) {
      return
    }

    if (!pendingBarcodeRegistration.productName.trim()) {
      setAppError('Debes ingresar nombre de producto para dar de alta el nuevo SKU.')
      return
    }

    const exists = findInventoryItemBySku(inventoryItems, pendingBarcodeRegistration.barcode)

    if (exists) {
      const barcodeResult = applyBarcodeStockEntry(
        inventoryItems,
        pendingBarcodeRegistration.barcode,
        pendingBarcodeRegistration.quantity,
      )
      setInventoryItems(barcodeResult.nextItems)
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        const updatedItem = barcodeResult.nextItems.find((item) => item.id === exists.id)
        if (updatedItem) {
          apiRequest(`/inventory/${updatedItem.id}`, { method: 'PATCH', body: updatedItem }).catch(() => null)
        }
      }
      setPendingBarcodeRegistration(null)
      return
    }

    const { createdItem, nextItems } = createInventoryItemFromBarcode(
      inventoryItems,
      pendingBarcodeRegistration.barcode,
      pendingBarcodeRegistration.productName,
      pendingBarcodeRegistration.quantity,
    )
    setInventoryItems(nextItems)
    enqueueAndSync({
      id: `inventory.create.${createdItem.id}`,
      type: 'inventory.create',
      payload: createdItem,
      createdAt: new Date().toISOString(),
    })

    setPendingBarcodeRegistration(null)
  }

  const handleEditItem = (itemId: string) => {
    if (!canEdit) {
      return
    }

    const selectedItem = inventoryItems.find((item) => item.id === itemId)

    if (!selectedItem) {
      return
    }

    setEditingItemId(itemId)
    setFormData(toInventoryItemFormData(selectedItem))
  }

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!itemIdPendingDelete) {
      return
    }

    const selectedItem = inventoryItems.find((item) => item.id === itemIdPendingDelete)

    if (selectedItem && selectedItem.linkedWorkOrderIds.length > 0) {
      setAppError('No se puede eliminar un item vinculado a ordenes de trabajo.')
      setItemIdPendingDelete(null)
      return
    }

    setInventoryItems(inventoryItems.filter((item) => item.id !== itemIdPendingDelete))

    if (editingItemId === itemIdPendingDelete) {
      resetForm()
    }

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
        linkedToWorkOrders={summary.linkedToWorkOrders}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          {canCreate || canEdit ? (
            <>
              <InventoryBarcodePanel onSubmitBarcode={handleBarcodeEntry} />

              {pendingBarcodeRegistration ? (
                <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 shadow-sm">
                  <h3 className="text-sm font-bold text-amber-900">SKU no encontrado: {pendingBarcodeRegistration.barcode}</h3>
                  <p className="mt-1 text-xs text-amber-900">
                    Ingresa el nombre del producto para darlo de alta. Cantidad detectada: {pendingBarcodeRegistration.quantity}
                  </p>

                  <input
                    className="mt-3 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none"
                    value={pendingBarcodeRegistration.productName}
                    onChange={(event) =>
                      setPendingBarcodeRegistration((previous) =>
                        previous
                          ? {
                              ...previous,
                              productName: event.target.value,
                            }
                          : previous,
                      )
                    }
                    placeholder="Nombre del producto"
                  />

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
                  onSubmit={(event) => {
                    event.preventDefault()
                    handleSubmitForm()
                  }}
                >
                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">SKU</span>
                    <input
                      className={inputClassName}
                      value={formData.sku}
                      onChange={(event) => handleFieldChange('sku', event.target.value)}
                      placeholder="SKU"
                    />
                    {errors.sku ? <span className="text-xs font-semibold text-rose-700">{errors.sku}</span> : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">Producto</span>
                    <input
                      className={inputClassName}
                      value={formData.productName}
                      onChange={(event) => handleFieldChange('productName', event.target.value)}
                      placeholder="Nombre del producto"
                    />
                    {errors.productName ? <span className="text-xs font-semibold text-rose-700">{errors.productName}</span> : null}
                  </label>

                  <label className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">Stock</span>
                    <input
                      type="number"
                      min={0}
                      className={inputClassName}
                      value={formData.stock}
                      onChange={(event) => handleFieldChange('stock', Number(event.target.value))}
                    />
                    {errors.stock ? <span className="text-xs font-semibold text-rose-700">{errors.stock}</span> : null}
                  </label>

                  <div className="flex flex-wrap justify-end gap-2">
                    {editingItemId ? (
                      <button
                        type="button"
                        onClick={resetForm}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      >
                        Cancelar edicion
                      </button>
                    ) : null}
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
