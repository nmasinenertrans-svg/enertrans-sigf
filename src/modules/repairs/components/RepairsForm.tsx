import type { ExternalRequest, WorkOrder } from '../../../types/domain'
import type { RepairFormData, RepairFormErrors, RepairFormField } from '../types'
import { calculateInvoicedFromSurcharge, calculateMargin } from '../services/repairsService'
import type { ReactNode } from 'react'

interface RepairsFormProps {
  workOrders: WorkOrder[]
  externalRequests: ExternalRequest[]
  formData: RepairFormData
  errors: RepairFormErrors
  isEditing: boolean
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

export const RepairsForm = ({
  workOrders,
  externalRequests,
  formData,
  errors,
  isEditing,
  onFieldChange,
  onSubmit,
  onCancelEdit,
}: RepairsFormProps) => {
  const realCost = Number(formData.realCostInput.replace(/\./g, '').replace(',', '.')) || 0
  const surchargePercent = Number(formData.surchargePercentInput.replace(/\./g, '').replace(',', '.')) || 0
  const invoicedToClient = calculateInvoicedFromSurcharge(realCost, surchargePercent)
  const margin = calculateMargin(realCost, invoicedToClient)
  const moneyFormatter = new Intl.NumberFormat(formData.currency === 'USD' ? 'en-US' : 'es-AR', {
    style: 'currency',
    currency: formData.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar reparacion' : 'Registrar reparacion'}</h3>
        <p className="mt-1 text-sm text-slate-600">Asocia OT o nota externa, proveedor, fecha/hora, km y costos.</p>
      </header>

      <form
        className="mt-5 grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormRow label="Origen" errorMessage={formData.sourceType === 'WORK_ORDER' ? errors.workOrderId : errors.externalRequestId}>
          <div className="flex flex-col gap-2">
            <select
              className={inputClassName}
              value={formData.sourceType}
              onChange={(event) => onFieldChange('sourceType', event.target.value as RepairFormData['sourceType'])}
            >
              <option value="WORK_ORDER">Orden de trabajo</option>
              <option value="EXTERNAL_REQUEST">Nota de pedido externo</option>
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
              <select
                className={inputClassName}
                value={formData.externalRequestId}
                onChange={(event) => onFieldChange('externalRequestId', event.target.value)}
              >
                <option value="">Seleccionar nota externa</option>
                {externalRequests.map((request) => (
                  <option key={request.id} value={request.id}>
                    {request.code ?? request.id.slice(0, 8)} - {request.companyName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </FormRow>

        <FormRow label="Proveedor" errorMessage={errors.supplierName}>
          <input
            className={inputClassName}
            value={formData.supplierName}
            onChange={(event) => onFieldChange('supplierName', event.target.value)}
            placeholder="Nombre del proveedor"
          />
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
              onChange={(event) => onFieldChange('currency', event.target.value as RepairFormData['currency'])}
            >
              <option value="ARS">ARS - Peso argentino</option>
              <option value="USD">USD - Dolar estadounidense</option>
            </select>
          </FormRow>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FormRow label="Costo real" errorMessage={errors.realCostInput}>
            <input
              className={inputClassName}
              value={formData.realCostInput}
              onChange={(event) => onFieldChange('realCostInput', event.target.value)}
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
          <span className="font-semibold">Costo al cliente:</span> {moneyFormatter.format(invoicedToClient)}
          <span className="ml-3 font-semibold">Margen:</span>{' '}
          {moneyFormatter.format(margin)}
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
