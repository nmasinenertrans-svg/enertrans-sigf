import { useMemo, useState } from 'react'
import { FormRow } from '../../../components/shared/FormRow'
import type { FleetUnit, InventoryItem, RepairRecord } from '../../../types/domain'
import type { InvoiceFormData, InvoiceFormErrors, InvoiceFormField } from '../types'

interface InvoiceFormProps {
  formData: InvoiceFormData
  errors: InvoiceFormErrors
  repairs: RepairRecord[]
  fleetUnits: FleetUnit[]
  inventoryItems: InventoryItem[]
  isSaving: boolean
  onFieldChange: <TField extends InvoiceFormField>(field: TField, value: InvoiceFormData[TField]) => void
  onFileSelected: (file: File | null) => void
  onSubmit: () => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const InvoiceForm = ({
  formData,
  errors,
  repairs,
  fleetUnits,
  inventoryItems,
  isSaving,
  onFieldChange,
  onFileSelected,
  onSubmit,
}: InvoiceFormProps) => {
  const [repairSearch, setRepairSearch] = useState('')
  const [inventorySearch, setInventorySearch] = useState('')

  const unitCodeById = useMemo(() => new Map(fleetUnits.map((unit) => [unit.id, unit.internalCode])), [fleetUnits])

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
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">Nueva factura</h3>
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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormRow label="Proveedor" errorMessage={errors.providerName}>
            <input
              className={inputClassName}
              value={formData.providerName}
              onChange={(event) => onFieldChange('providerName', event.target.value)}
              placeholder="Nombre del proveedor"
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
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <FormRow label="Monto" errorMessage={errors.amountInput}>
            <input
              type="text"
              inputMode="decimal"
              className={inputClassName}
              value={formData.amountInput}
              onChange={(event) => onFieldChange('amountInput', event.target.value)}
              placeholder="0.00"
            />
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
          {selectedInventoryItems.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedInventoryItems.map((item) => (
                <span
                  key={item.id}
                  className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800"
                >
                  {item.sku}
                  <button type="button" onClick={() => toggleInventoryItem(item.id)} className="hover:underline">
                    ×
                  </button>
                </span>
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

        <FormRow label="Notas (opcional)">
          <textarea
            className={inputClassName}
            rows={2}
            value={formData.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
          />
        </FormRow>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={isSaving}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
          >
            {isSaving ? 'Guardando...' : 'Guardar factura'}
          </button>
        </div>
      </form>
    </section>
  )
}
