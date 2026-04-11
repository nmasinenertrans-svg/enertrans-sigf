import { useMemo, useState } from 'react'
import { FormRow } from '../../../components/shared/FormRow'
import type { FleetUnit, InventoryItem } from '../../../types/domain'
import type { WorkOrderFormData, WorkOrderFormErrors, WorkOrderFormField } from '../types'

interface WorkOrderFormProps {
  fleetUnits: FleetUnit[]
  inventoryItems: InventoryItem[]
  formData: WorkOrderFormData
  errors: WorkOrderFormErrors
  isEditing: boolean
  isSubmitting?: boolean
  onFieldChange: <TField extends WorkOrderFormField>(field: TField, value: WorkOrderFormData[TField]) => void
  onSubmit: () => void
  onCancelEdit: () => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'


export const WorkOrderForm = ({
  fleetUnits,
  inventoryItems,
  formData,
  errors,
  isEditing,
  isSubmitting = false,
  onFieldChange,
  onSubmit,
  onCancelEdit,
}: WorkOrderFormProps) => {
  const [unitSearch, setUnitSearch] = useState('')
  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) {
      return fleetUnits
    }
    return fleetUnits.filter((unit) => {
      const haystack = [unit.internalCode, unit.ownerCompany, unit.clientName, unit.brand, unit.model].join(' ').toLowerCase()
      return haystack.includes(query)
    })
  }, [fleetUnits, unitSearch])

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar OT' : 'Crear OT'}</h3>
        <p className="mt-1 text-sm text-slate-600">Asociá unidad, tareas, repuestos, mano de obra y vinculación con inventario.</p>
      </header>

      <form
        className="mt-5 grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormRow label="Unidad" errorMessage={errors.unitId}>
          <input
            className={inputClassName}
            value={unitSearch}
            onChange={(event) => setUnitSearch(event.target.value)}
            placeholder="Buscar por patente/codigo, cliente, marca o modelo..."
          />
          <select className={inputClassName} value={formData.unitId} onChange={(event) => onFieldChange('unitId', event.target.value)}>
            <option value="">Seleccionar unidad</option>
            {filteredUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.internalCode} - {unit.ownerCompany}
              </option>
            ))}
          </select>
          {unitSearch.trim() && filteredUnits.length === 0 ? (
            <span className="text-xs font-semibold text-slate-500">No hay unidades que coincidan con la busqueda.</span>
          ) : null}
        </FormRow>

        <FormRow label="Tareas (una por línea)" errorMessage={errors.tasksInput}>
          <textarea
            rows={4}
            className={inputClassName}
            value={formData.tasksInput}
            onChange={(event) => onFieldChange('tasksInput', event.target.value)}
            placeholder="Inspección general&#10;Cambio de correa"
          />
        </FormRow>

        <FormRow label="Repuestos (uno por línea)">
          <textarea
            rows={3}
            className={inputClassName}
            value={formData.sparePartsInput}
            onChange={(event) => onFieldChange('sparePartsInput', event.target.value)}
            placeholder="Filtro de aceite&#10;Bulón M12"
          />
        </FormRow>

        <FormRow label="Mano de obra" errorMessage={errors.laborDetail}>
          <textarea
            rows={3}
            className={inputClassName}
            value={formData.laborDetail}
            onChange={(event) => onFieldChange('laborDetail', event.target.value)}
            placeholder="2 técnicos / 4 horas"
          />
        </FormRow>

        <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
          <h4 className="text-sm font-semibold text-slate-800">Vinculación con inventario</h4>

          {inventoryItems.length === 0 ? (
            <p className="mt-2 text-xs text-slate-600">No hay ítems de inventario cargados.</p>
          ) : (
            <div className="mt-3 grid gap-2">
              {inventoryItems.map((item) => {
                const isChecked = formData.linkedInventorySkuList.includes(item.sku)

                return (
                  <label key={item.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={(event) => {
                        const nextSkuList = event.target.checked
                          ? [...formData.linkedInventorySkuList, item.sku]
                          : formData.linkedInventorySkuList.filter((sku) => sku !== item.sku)

                        onFieldChange('linkedInventorySkuList', nextSkuList)
                      }}
                    />
                    <span>
                      {item.sku} - {item.productName} (stock: {item.stock})
                    </span>
                  </label>
                )
              })}
            </div>
          )}
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          {isEditing ? (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancelar edición
            </button>
          ) : null}
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Guardando...' : isEditing ? 'Guardar cambios' : 'Crear OT'}
          </button>
        </div>
      </form>
    </section>
  )
}

