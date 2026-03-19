import type { ExternalRequest, Supplier, WorkOrder } from '../../../types/domain'
import type { RepairFormData, RepairFormErrors, RepairFormField } from '../types'
import { calculateInvoicedFromSurcharge, calculateMargin, isExternalRequestEligibleForRepair } from '../services/repairsService'
import type { ReactNode } from 'react'

interface RepairsFormProps {
  workOrders: WorkOrder[]
  externalRequests: ExternalRequest[]
  suppliers: Supplier[]
  formData: RepairFormData
  errors: RepairFormErrors
  isEditing: boolean
  currentRepairId?: string | null
  onFieldChange: <TField extends RepairFormField>(field: TField, value: RepairFormData[TField]) => void
  onSubmit: () => void
  onCancelEdit: () => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

interface FormRowProps {
  label: string
  errorMessage?: string
  children: ReactNode
}

const FormRow = ({ label, errorMessage, children }: FormRowProps) => (
  <label className="flex flex-col gap-2">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    {children}
    {errorMessage ? <span className="text-xs font-semibold text-rose-700">{errorMessage}</span> : null}
  </label>
)

const toCurrency = (value: string | undefined): 'ARS' | 'USD' => (value === 'USD' ? 'USD' : 'ARS')

export const RepairsForm = ({
  workOrders,
  externalRequests,
  suppliers,
  formData,
  errors,
  isEditing,
  currentRepairId,
  onFieldChange,
  onSubmit,
  onCancelEdit,
}: RepairsFormProps) => {
  const selectedExternalRequestIds = Array.isArray(formData.linkedExternalRequestIds) ? formData.linkedExternalRequestIds : []
  const selectedExternalRequests = externalRequests.filter((request) => selectedExternalRequestIds.includes(request.id))
  const eligibleExternalRequests = externalRequests.filter((request) =>
    isExternalRequestEligibleForRepair(request, currentRepairId ?? undefined),
  )

  const partsCost = selectedExternalRequests.reduce((sum, request) => {
    const value = Number(request.partsTotal ?? 0)
    return sum + (Number.isFinite(value) ? value : 0)
  }, 0)
  const laborCost = Number(formData.laborCostInput.replace(/\./g, '').replace(',', '.')) || 0
  const realCost = Number((laborCost + partsCost).toFixed(2))
  const surchargePercent = Number(formData.surchargePercentInput.replace(/\./g, '').replace(',', '.')) || 0
  const invoicedToClient = calculateInvoicedFromSurcharge(realCost, surchargePercent)
  const margin = calculateMargin(realCost, invoicedToClient)
  const moneyFormatter = new Intl.NumberFormat(formData.currency === 'USD' ? 'en-US' : 'es-AR', {
    style: 'currency',
    currency: formData.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  const toggleExternalRequest = (request: ExternalRequest) => {
    const current = new Set(selectedExternalRequestIds)
    if (current.has(request.id)) {
      current.delete(request.id)
    } else {
      current.add(request.id)
    }
    const nextIds = Array.from(current)
    onFieldChange('linkedExternalRequestIds', nextIds)
    if (nextIds.length > 0) {
      const firstRequest = externalRequests.find((item) => item.id === nextIds[0])
      onFieldChange('currency', toCurrency(firstRequest?.currency))
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar reparacion' : 'Registrar reparacion'}</h3>
        <p className="mt-1 text-sm text-slate-600">Flujo NDP - Reparacion: mano de obra + repuestos vinculados.</p>
      </header>

      <form
        className="mt-5 grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormRow label="Origen" errorMessage={formData.sourceType === 'WORK_ORDER' ? errors.workOrderId : errors.linkedExternalRequestIds}>
          <div className="flex flex-col gap-2">
            <select
              className={inputClassName}
              value={formData.sourceType}
              onChange={(event) => onFieldChange('sourceType', event.target.value as RepairFormData['sourceType'])}
            >
              <option value="WORK_ORDER">Orden de trabajo</option>
              <option value="EXTERNAL_REQUEST">NDP (repuestos comprados)</option>
            </select>

            {formData.sourceType === 'WORK_ORDER' ? (
              <select
                className={inputClassName}
                value={formData.workOrderId}
                onChange={(event) => onFieldChange('workOrderId', event.target.value)}
              >
                <option value="">Seleccionar OT</option>
                {workOrders.map((workOrder) => (
                  <option key={workOrder.id} value={workOrder.id}>
                    {workOrder.code ?? workOrder.id.slice(0, 8)} - {workOrder.status}
                  </option>
                ))}
              </select>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">NDP elegibles</p>
                {eligibleExternalRequests.length === 0 ? (
                  <p className="mt-2 text-xs text-slate-600">No hay NDP listas para reparar (requieren adjunto y estado listo).</p>
                ) : (
                  <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                    {eligibleExternalRequests.map((request) => {
                      const checked = selectedExternalRequestIds.includes(request.id)
                      const currency = toCurrency(request.currency)
                      const formatter = new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-AR', {
                        style: 'currency',
                        currency,
                      })
                      const partTotal = Number(request.partsTotal ?? 0)
                      return (
                        <label
                          key={request.id}
                          className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleExternalRequest(request)}
                            className="mt-0.5 h-4 w-4"
                          />
                          <span className="flex-1 text-slate-700">
                            <strong>{request.code}</strong> - {request.companyName}
                            <br />
                            Repuestos: {formatter.format(Number.isFinite(partTotal) ? partTotal : 0)}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </FormRow>

        <FormRow label="Proveedor" errorMessage={errors.supplierName}>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <select
              className={inputClassName}
              value={formData.supplierId}
              onChange={(event) => {
                const supplierId = event.target.value
                const selected = suppliers.find((item) => item.id === supplierId)
                onFieldChange('supplierId', supplierId)
                if (selected) {
                  onFieldChange('supplierName', selected.name)
                }
              }}
            >
              <option value="">Seleccionar proveedor del catalogo</option>
              {suppliers
                .filter((supplier) => supplier.isActive)
                .map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>
                    {supplier.name}
                  </option>
                ))}
            </select>

            <input
              className={inputClassName}
              value={formData.supplierName}
              onChange={(event) => {
                onFieldChange('supplierName', event.target.value)
                onFieldChange('supplierId', '')
              }}
              placeholder="O escribir proveedor manual"
            />
          </div>
        </FormRow>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormRow label="Fecha de reparacion" errorMessage={errors.performedDate}>
            <input
              type="date"
              className={inputClassName}
              value={formData.performedDate}
              onChange={(event) => onFieldChange('performedDate', event.target.value)}
            />
          </FormRow>

          <FormRow label="Hora de reparacion" errorMessage={errors.performedTime}>
            <input
              type="time"
              className={inputClassName}
              value={formData.performedTime}
              onChange={(event) => onFieldChange('performedTime', event.target.value)}
            />
          </FormRow>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormRow label="KM de la unidad" errorMessage={errors.unitKilometersInput}>
            <input
              type="number"
              min={0}
              step={1}
              className={inputClassName}
              value={formData.unitKilometersInput}
              onChange={(event) => onFieldChange('unitKilometersInput', event.target.value)}
              placeholder="Ej: 245120"
            />
          </FormRow>

          <FormRow label="Moneda" errorMessage={errors.currency}>
            <select
              className={inputClassName}
              value={formData.currency}
              disabled={formData.sourceType === 'EXTERNAL_REQUEST' && selectedExternalRequestIds.length > 0}
              onChange={(event) => onFieldChange('currency', event.target.value as RepairFormData['currency'])}
            >
              <option value="ARS">ARS - Peso argentino</option>
              <option value="USD">USD - Dolar estadounidense</option>
            </select>
          </FormRow>
        </div>

        {formData.sourceType === 'EXTERNAL_REQUEST' ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
            <p className="font-semibold">NDP vinculadas: {selectedExternalRequests.length}</p>
            <p className="mt-1">
              Repuestos acumulados: <span className="font-semibold">{moneyFormatter.format(partsCost)}</span>
            </p>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormRow label="Mano de obra" errorMessage={errors.laborCostInput}>
            <input
              className={inputClassName}
              value={formData.laborCostInput}
              onChange={(event) => onFieldChange('laborCostInput', event.target.value)}
              placeholder="Ej: 580000"
            />
          </FormRow>

          <FormRow label="Recargo (%)" errorMessage={errors.surchargePercentInput}>
            <input
              className={inputClassName}
              value={formData.surchargePercentInput}
              onChange={(event) => onFieldChange('surchargePercentInput', event.target.value)}
              placeholder="Ej: 65"
            />
          </FormRow>
        </div>

        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold">Costo repuestos:</span> {moneyFormatter.format(partsCost)}
          <span className="ml-3 font-semibold">Costo total real:</span> {moneyFormatter.format(realCost)}
          <span className="ml-3 font-semibold">Costo al cliente:</span> {moneyFormatter.format(invoicedToClient)}
          <span className="ml-3 font-semibold">Margen:</span> {moneyFormatter.format(margin)}
        </p>

        {formData.sourceType === 'EXTERNAL_REQUEST' ? (
          <FormRow label="Factura del proveedor (FC)" errorMessage={errors.invoiceFileBase64}>
            <input
              type="file"
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) {
                  onFieldChange('invoiceFileName', '')
                  onFieldChange('invoiceFileBase64', '')
                  onFieldChange('invoiceFileUrl', '')
                  return
                }
                const reader = new FileReader()
                reader.onload = () => {
                  const result = typeof reader.result === 'string' ? reader.result : ''
                  onFieldChange('invoiceFileName', file.name)
                  onFieldChange('invoiceFileBase64', result)
                  onFieldChange('invoiceFileUrl', '')
                }
                reader.readAsDataURL(file)
              }}
            />
          </FormRow>
        ) : null}

        <div className="flex flex-wrap justify-end gap-3">
          {isEditing ? (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancelar edicion
            </button>
          ) : null}
          <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500">
            {isEditing ? 'Guardar cambios' : 'Guardar reparacion'}
          </button>
        </div>
      </form>
    </section>
  )
}
