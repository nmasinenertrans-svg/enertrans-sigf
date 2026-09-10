import { useMemo, useState } from 'react'
import { FormRow } from '../../../components/shared/FormRow'
import type { FleetUnit, InventoryItem, RepairRecord, Supplier, WorkOrder } from '../../../types/domain'
import { createEmptyLineItemDraft, parseMoney } from '../services/invoicesService'
import type { InvoiceFormData, InvoiceFormErrors, InvoiceFormField, InvoiceLineItemDraft } from '../types'

interface InvoiceFormProps {
  formData: InvoiceFormData
  errors: InvoiceFormErrors
  repairs: RepairRecord[]
  fleetUnits: FleetUnit[]
  inventoryItems: InventoryItem[]
  suppliers: Supplier[]
  workOrders: WorkOrder[]
  isSaving: boolean
  isEditing?: boolean
  onFieldChange: <TField extends InvoiceFormField>(field: TField, value: InvoiceFormData[TField]) => void
  onFileSelected: (file: File | null) => void
  onSubmit: () => void
  onCancelEdit?: () => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const InvoiceForm = ({
  formData,
  errors,
  repairs,
  fleetUnits,
  inventoryItems,
  suppliers,
  workOrders,
  isSaving,
  isEditing = false,
  onFieldChange,
  onFileSelected,
  onSubmit,
  onCancelEdit,
}: InvoiceFormProps) => {
  const [repairSearch, setRepairSearch] = useState('')
  const [unitSearch, setUnitSearch] = useState('')
  const [inventorySearch, setInventorySearch] = useState('')
  const [supplierSearch, setSupplierSearch] = useState('')
  const [lineItemUnitSearch, setLineItemUnitSearch] = useState<Record<number, string>>({})

  const selectedSupplier = suppliers.find((supplier) => supplier.id === formData.supplierId)

  const filteredSuppliers = useMemo(() => {
    const query = supplierSearch.trim().toLowerCase()
    if (!query) {
      return suppliers.slice(0, 8)
    }
    return suppliers.filter((supplier) => supplier.name.toLowerCase().includes(query)).slice(0, 8)
  }, [suppliers, supplierSearch])

  const handleSelectSupplier = (supplier: Supplier) => {
    onFieldChange('supplierId', supplier.id)
    onFieldChange('providerName', supplier.name)
    setSupplierSearch('')
  }

  const unitCodeById = useMemo(() => new Map(fleetUnits.map((unit) => [unit.id, unit.internalCode])), [fleetUnits])

  const workOrdersByUnit = useMemo(() => {
    const map = new Map<string, WorkOrder[]>()
    workOrders.forEach((workOrder) => {
      if (!workOrder.unitId) return
      const list = map.get(workOrder.unitId) ?? []
      list.push(workOrder)
      map.set(workOrder.unitId, list)
    })
    return map
  }, [workOrders])

  const updateLineItem = (index: number, field: keyof InvoiceLineItemDraft, value: string) => {
    onFieldChange(
      'lineItems',
      formData.lineItems.map((item, itemIndex) => {
        if (itemIndex !== index) return item
        const next = { ...item, [field]: value }
        // Si cambia la unidad, la OT elegida antes puede ya no corresponder.
        if (field === 'unitId') next.workOrderId = ''
        return next
      }),
    )
  }

  const addLineItem = () => {
    onFieldChange('lineItems', [...formData.lineItems, createEmptyLineItemDraft()])
  }

  const removeLineItem = (index: number) => {
    onFieldChange(
      'lineItems',
      formData.lineItems.length > 1
        ? formData.lineItems.filter((_, itemIndex) => itemIndex !== index)
        : formData.lineItems,
    )
    // Los indices de las filas siguientes corren uno para atras -- se
    // resetean las busquedas en curso para no dejar el texto de una fila
    // pegado a la fila equivocada.
    setLineItemUnitSearch({})
  }

  const lineItemsTotal = formData.lineItems.reduce((sum, item) => sum + parseMoney(item.amountInput), 0)

  const filteredRepairs = useMemo(() => {
    const query = repairSearch.trim().toLowerCase()
    const sorted = [...repairs].sort(
      (a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime(),
    )
    if (!query) {
      return sorted.slice(0, 8)
    }
    return sorted
      .filter((repair) => {
        const unitCode = unitCodeById.get(repair.unitId) ?? ''
        const haystack = `${unitCode} ${repair.supplierName}`.toLowerCase()
        return haystack.includes(query)
      })
      .slice(0, 8)
  }, [repairs, repairSearch, unitCodeById])

  const selectedRepair = repairs.find((repair) => repair.id === formData.repairId)

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) {
      return fleetUnits.slice(0, 8)
    }
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const filteredInventoryItems = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase()
    if (!query) {
      return inventoryItems.slice(0, 8)
    }
    return inventoryItems
      .filter((item) => `${item.sku} ${item.productName}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [inventoryItems, inventorySearch])

  const selectedInventoryItems = inventoryItems.filter((item) => formData.inventoryItemIds.includes(item.id))

  const toggleInventoryItem = (itemId: string) => {
    const isSelected = formData.inventoryItemIds.includes(itemId)
    onFieldChange(
      'inventoryItemIds',
      isSelected ? formData.inventoryItemIds.filter((id) => id !== itemId) : [...formData.inventoryItemIds, itemId],
    )
    if (isSelected) {
      const { [itemId]: _removed, ...rest } = formData.inventoryItemQuantityInputs
      onFieldChange('inventoryItemQuantityInputs', rest)
    } else {
      onFieldChange('inventoryItemQuantityInputs', { ...formData.inventoryItemQuantityInputs, [itemId]: '1' })
    }
  }

  const setInventoryItemQuantity = (itemId: string, value: string) => {
    onFieldChange('inventoryItemQuantityInputs', { ...formData.inventoryItemQuantityInputs, [itemId]: value })
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar factura' : 'Nueva factura'}</h3>
        <p className="mt-1 text-sm text-slate-600">
          Una factura puede cubrir varios productos de inventario y, opcionalmente, quedar vinculada a una reparación.
        </p>
      </header>

      <form
        className="mt-4 grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormRow label="Proveedor" errorMessage={errors.providerName}>
          {selectedSupplier ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>Proveedor registrado: {selectedSupplier.name}</span>
              <button
                type="button"
                onClick={() => onFieldChange('supplierId', '')}
                className="font-semibold text-amber-700 hover:underline"
              >
                Quitar vínculo
              </button>
            </div>
          ) : (
            <>
              <input
                className={inputClassName}
                value={supplierSearch}
                onChange={(event) => setSupplierSearch(event.target.value)}
                placeholder="Buscar proveedor registrado..."
              />
              {supplierSearch.trim() && filteredSuppliers.length > 0 ? (
                <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                  {filteredSuppliers.map((supplier) => (
                    <button
                      key={supplier.id}
                      type="button"
                      onClick={() => handleSelectSupplier(supplier)}
                      className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {supplier.name}
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          )}
          <input
            className={`${inputClassName} mt-2`}
            value={formData.providerName}
            onChange={(event) => onFieldChange('providerName', event.target.value)}
            placeholder="Nombre del proveedor (o corregilo si no está registrado)"
          />
        </FormRow>

        <FormRow label="N° de factura (opcional)">
          <input
            className={inputClassName}
            value={formData.invoiceNumber}
            onChange={(event) => onFieldChange('invoiceNumber', event.target.value)}
            placeholder="0001-00012345"
          />
        </FormRow>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormRow label="Monto" errorMessage={errors.amountInput}>
            <input
              type="text"
              inputMode="decimal"
              className={inputClassName}
              value={formData.amountInput}
              onChange={(event) => onFieldChange('amountInput', event.target.value)}
              placeholder="650000 o 650.000,50"
            />
            {formData.amountInput.trim() ? (
              <p className="mt-1 text-xs font-semibold text-slate-600">
                Se va a guardar como:{' '}
                <span className="text-amber-700">
                  {new Intl.NumberFormat('es-AR', {
                    style: 'currency',
                    currency: formData.currency,
                    minimumFractionDigits: 2,
                  }).format(parseMoney(formData.amountInput))}
                </span>
              </p>
            ) : null}
          </FormRow>
          <FormRow label="Moneda">
            <select
              className={inputClassName}
              value={formData.currency}
              onChange={(event) => onFieldChange('currency', event.target.value as InvoiceFormData['currency'])}
            >
              <option value="ARS">ARS</option>
              <option value="USD">USD</option>
            </select>
          </FormRow>
          <FormRow label="Fecha de emisión (opcional)">
            <input
              type="date"
              className={inputClassName}
              value={formData.issuedAt}
              onChange={(event) => onFieldChange('issuedAt', event.target.value)}
            />
          </FormRow>
        </div>

        <FormRow label="Archivo (PDF o foto)">
          <input
            type="file"
            accept="application/pdf,image/*"
            className={inputClassName}
            onChange={(event) => onFileSelected(event.target.files?.[0] ?? null)}
          />
          {formData.fileName ? <span className="text-xs text-slate-500">Adjunto: {formData.fileName}</span> : null}
        </FormRow>

        <FormRow label="Vincular a una unidad (opcional)">
          <p className="mb-1 text-xs text-slate-500">
            Para que quede registro en la ficha del camión, sin necesidad de armar una reparación.
          </p>
          {selectedUnit ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>
                {selectedUnit.internalCode} · {selectedUnit.brand} {selectedUnit.model}
              </span>
              <button
                type="button"
                onClick={() => onFieldChange('unitId', '')}
                className="font-semibold text-amber-700 hover:underline"
              >
                Quitar vínculo
              </button>
            </div>
          ) : (
            <>
              <input
                className={inputClassName}
                value={unitSearch}
                onChange={(event) => setUnitSearch(event.target.value)}
                placeholder="Buscar por dominio, marca o modelo..."
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {filteredUnits.map((unit) => (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => onFieldChange('unitId', unit.id)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {unit.internalCode} · {unit.brand} {unit.model}
                  </button>
                ))}
                {filteredUnits.length === 0 ? (
                  <p className="px-1 text-xs text-slate-400">Sin resultados.</p>
                ) : null}
              </div>
            </>
          )}
        </FormRow>

        <FormRow label="Vincular a una reparación (opcional)">
          {selectedRepair ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <span>
                {unitCodeById.get(selectedRepair.unitId) ?? 'Unidad'} · {selectedRepair.supplierName || 'Reparación'}
              </span>
              <button
                type="button"
                onClick={() => onFieldChange('repairId', '')}
                className="font-semibold text-amber-700 hover:underline"
              >
                Quitar vínculo
              </button>
            </div>
          ) : (
            <>
              <input
                className={inputClassName}
                value={repairSearch}
                onChange={(event) => setRepairSearch(event.target.value)}
                placeholder="Buscar por dominio o proveedor..."
              />
              <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
                {filteredRepairs.map((repair) => (
                  <button
                    key={repair.id}
                    type="button"
                    onClick={() => onFieldChange('repairId', repair.id)}
                    className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                  >
                    {unitCodeById.get(repair.unitId) ?? 'Unidad'} · {repair.supplierName || 'Sin proveedor'}
                  </button>
                ))}
                {filteredRepairs.length === 0 ? (
                  <p className="px-1 text-xs text-slate-400">Sin resultados.</p>
                ) : null}
              </div>
            </>
          )}
        </FormRow>

        <FormRow label="Vincular a productos de inventario (opcional)">
          <p className="mb-1 text-xs text-slate-500">
            Si ponés cantidad, se suma automáticamente al stock del producto al guardar la factura.
          </p>
          {selectedInventoryItems.length > 0 ? (
            <div className="mb-2 space-y-1.5">
              {selectedInventoryItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-xs font-semibold text-amber-800"
                >
                  <span className="flex-1">
                    {item.sku} — {item.productName}
                  </span>
                  <input
                    className="w-20 rounded-lg border border-amber-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-amber-500"
                    value={formData.inventoryItemQuantityInputs[item.id] ?? ''}
                    onChange={(event) => setInventoryItemQuantity(item.id, event.target.value)}
                    placeholder="Cant."
                  />
                  <button type="button" onClick={() => toggleInventoryItem(item.id)} className="hover:underline">
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <input
            className={inputClassName}
            value={inventorySearch}
            onChange={(event) => setInventorySearch(event.target.value)}
            placeholder="Buscar por SKU o nombre de producto..."
          />
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {filteredInventoryItems.map((item) => {
              const isSelected = formData.inventoryItemIds.includes(item.id)
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleInventoryItem(item.id)}
                  className={`block w-full rounded-lg border px-3 py-1.5 text-left text-xs ${
                    isSelected
                      ? 'border-amber-300 bg-amber-50 text-amber-800'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {isSelected ? '✓ ' : ''}
                  {item.sku} — {item.productName}
                </button>
              )
            })}
            {filteredInventoryItems.length === 0 ? <p className="px-1 text-xs text-slate-400">Sin resultados.</p> : null}
          </div>
        </FormRow>

        <FormRow label="Desglosar entre varias unidades/OTs (opcional)" errorMessage={errors.lineItems}>
          <p className="mb-2 text-xs text-slate-500">
            Usalo cuando una misma factura cubre varios equipos (repuestos para varios camiones en una factura del
            proveedor, o una factura mensual de RTO con todas las unidades del mes).
          </p>
          <label className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <input
              type="checkbox"
              checked={formData.hasLineItems}
              onChange={(event) => onFieldChange('hasLineItems', event.target.checked)}
            />
            Esta factura cubre más de un equipo
          </label>

          {formData.hasLineItems ? (
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
              {formData.lineItems.map((item, index) => {
                const itemUnit = fleetUnits.find((unit) => unit.id === item.unitId)
                const itemSearch = lineItemUnitSearch[index] ?? ''
                const filteredItemUnits = (() => {
                  const query = itemSearch.trim().toLowerCase()
                  if (!query) return fleetUnits.slice(0, 8)
                  return fleetUnits
                    .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
                    .slice(0, 8)
                })()

                return (
                  <div key={index} className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-500">Item {index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removeLineItem(index)}
                        className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                      >
                        Quitar item
                      </button>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-700">Unidad</label>
                      {itemUnit ? (
                        <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                          <span>
                            {itemUnit.internalCode} · {itemUnit.brand} {itemUnit.model}
                          </span>
                          <button
                            type="button"
                            onClick={() => updateLineItem(index, 'unitId', '')}
                            className="font-semibold text-amber-700 hover:underline"
                          >
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <>
                          <input
                            className={`${inputClassName} mt-1`}
                            value={itemSearch}
                            onChange={(event) =>
                              setLineItemUnitSearch((previous) => ({ ...previous, [index]: event.target.value }))
                            }
                            placeholder="Buscar por dominio, marca o modelo..."
                          />
                          <div className="mt-1 max-h-32 space-y-1 overflow-y-auto">
                            {filteredItemUnits.map((unit) => (
                              <button
                                key={unit.id}
                                type="button"
                                onClick={() => {
                                  updateLineItem(index, 'unitId', unit.id)
                                  setLineItemUnitSearch((previous) => ({ ...previous, [index]: '' }))
                                }}
                                className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                              >
                                {unit.internalCode} · {unit.brand} {unit.model}
                              </button>
                            ))}
                            {filteredItemUnits.length === 0 ? (
                              <p className="px-1 text-xs text-slate-400">Sin resultados.</p>
                            ) : null}
                          </div>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 sm:col-span-1">
                        OT (opcional)
                        <select
                          className={inputClassName}
                          value={item.workOrderId}
                          onChange={(event) => updateLineItem(index, 'workOrderId', event.target.value)}
                          disabled={!item.unitId}
                        >
                          <option value="">Sin OT</option>
                          {(workOrdersByUnit.get(item.unitId) ?? []).map((workOrder) => (
                            <option key={workOrder.id} value={workOrder.id}>
                              {workOrder.code}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 sm:col-span-1">
                        Monto
                        <input
                          type="text"
                          inputMode="decimal"
                          className={inputClassName}
                          value={item.amountInput}
                          onChange={(event) => updateLineItem(index, 'amountInput', event.target.value)}
                          placeholder="Monto"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs font-semibold text-slate-700 sm:col-span-1">
                        Descripción
                        <input
                          className={inputClassName}
                          value={item.description}
                          onChange={(event) => updateLineItem(index, 'description', event.target.value)}
                          placeholder="Ej: RTO, filtro de aceite"
                        />
                      </label>
                    </div>
                  </div>
                )
              })}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <button
                  type="button"
                  onClick={addLineItem}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  + Agregar item
                </button>
                <p className="text-xs font-semibold text-slate-600">
                  Total del desglose:{' '}
                  <span className={lineItemsTotal !== parseMoney(formData.amountInput) ? 'text-rose-600' : 'text-emerald-700'}>
                    {new Intl.NumberFormat('es-AR', {
                      style: 'currency',
                      currency: formData.currency,
                      minimumFractionDigits: 2,
                    }).format(lineItemsTotal)}
                  </span>
                  {lineItemsTotal !== parseMoney(formData.amountInput) ? ' (no coincide con el monto de la factura)' : ''}
                </p>
              </div>
            </div>
          ) : null}
        </FormRow>

        <FormRow label="Notas (opcional)">
          <textarea
            className={inputClassName}
            rows={2}
            value={formData.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
          />
        </FormRow>

        <div className="flex justify-end gap-2">
          {isEditing && onCancelEdit ? (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancelar
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
          >
            {isSaving ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Guardar factura'}
          </button>
        </div>
      </form>
    </section>
  )
}
