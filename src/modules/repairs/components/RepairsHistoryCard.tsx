import type { ClientBillingStatus, Invoice } from '../../../types/domain'
import type { RepairViewItem } from '../types'

interface RepairsHistoryCardProps {
  item: RepairViewItem
  linkedInvoices?: Invoice[]
  onEdit: (repairId: string) => void
  onDelete: (repairId: string) => void
  onChangeBillingStatus?: (repairId: string, status: ClientBillingStatus) => void
  canEdit?: boolean
  canDelete?: boolean
}

const billingStatusLabelMap: Record<ClientBillingStatus, string> = {
  CARGADO: 'Cargado',
  PASADO_AL_CLIENTE: 'Pasado al cliente',
  ACEPTADO: 'Aceptado',
  RECHAZADO: 'Rechazado',
  FACTURADO: 'Facturado',
  COBRADO: 'Cobrado',
}

const billingStatusClassMap: Record<ClientBillingStatus, string> = {
  CARGADO: 'border-slate-300 bg-slate-50 text-slate-700',
  PASADO_AL_CLIENTE: 'border-sky-300 bg-sky-50 text-sky-700',
  ACEPTADO: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  RECHAZADO: 'border-rose-300 bg-rose-50 text-rose-700',
  FACTURADO: 'border-indigo-300 bg-indigo-50 text-indigo-700',
  COBRADO: 'border-emerald-400 bg-emerald-100 text-emerald-800',
}

// Mismo circuito que en el backend (backend/src/routes/repairs.ts) -- esto
// solo decide que botones mostrar, el servidor es quien de verdad valida.
const billingStatusNextSteps: Record<ClientBillingStatus, ClientBillingStatus[]> = {
  CARGADO: ['PASADO_AL_CLIENTE'],
  PASADO_AL_CLIENTE: ['ACEPTADO', 'RECHAZADO'],
  ACEPTADO: ['FACTURADO'],
  RECHAZADO: ['CARGADO'],
  FACTURADO: ['COBRADO'],
  COBRADO: [],
}

export const RepairsHistoryCard = ({
  item,
  linkedInvoices = [],
  onEdit,
  onDelete,
  onChangeBillingStatus,
  canEdit = true,
  canDelete = true,
}: RepairsHistoryCardProps) => {
  const billingStatus = item.clientBillingStatus ?? 'CARGADO'
  const nextSteps = billingStatusNextSteps[billingStatus] ?? []
  const performedAtDate = new Date(item.performedAt)
  const hasValidDate = !Number.isNaN(performedAtDate.getTime())
  const moneyFormatter = new Intl.NumberFormat(item.currency === 'USD' ? 'en-US' : 'es-AR', {
    style: 'currency',
    currency: item.currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Unidad</p>
          <h3 className="mt-1 text-base font-bold text-slate-900">{item.unitLabel}</h3>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span
            className={`rounded-full border px-2 py-1 text-xs font-semibold ${
              item.margin >= 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
            }`}
          >
            Margen: {moneyFormatter.format(item.margin)}
          </span>
          <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${billingStatusClassMap[billingStatus]}`}>
            Cobro cliente: {billingStatusLabelMap[billingStatus]}
          </span>
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-700">
        <p>
          <span className="font-semibold">{item.sourceType === 'EXTERNAL_REQUEST' ? 'NDP:' : 'OT:'}</span>{' '}
          {item.sourceType === 'EXTERNAL_REQUEST' ? item.externalRequestLabel : item.workOrderLabel}
        </p>
        {item.sourceType === 'EXTERNAL_REQUEST' && item.linkedExternalRequestLabels.length > 1 ? (
          <p>
            <span className="font-semibold">NDP vinculadas:</span> {item.linkedExternalRequestLabels.length}
          </p>
        ) : null}
        <p>
          <span className="font-semibold">Proveedor:</span> {item.supplierName}
        </p>
        <p>
          <span className="font-semibold">Fecha/Hora:</span>{' '}
          {hasValidDate
            ? `${performedAtDate.toLocaleDateString('es-AR')} ${performedAtDate.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`
            : 'Sin registro'}
        </p>
        <p>
          <span className="font-semibold">KM unidad:</span> {new Intl.NumberFormat('es-AR').format(item.unitKilometers)}
        </p>
        <p>
          <span className="font-semibold">Moneda:</span> {item.currency}
        </p>
        <p>
          <span className="font-semibold">Mano de obra:</span> {moneyFormatter.format(item.laborCost)}
        </p>
        <p>
          <span className="font-semibold">Repuestos:</span> {moneyFormatter.format(item.partsCost)}
        </p>
        {item.partsUsedLabels.length > 0 ? (
          <p className="text-xs text-slate-600">
            <span className="font-semibold">Repuestos utilizados:</span> {item.partsUsedLabels.join(', ')}
          </p>
        ) : null}
        <p>
          <span className="font-semibold">Costo total real:</span> {moneyFormatter.format(item.realCost)}
        </p>
        <p>
          <span className="font-semibold">Facturado cliente:</span> {moneyFormatter.format(item.invoicedToClient)}
        </p>
        {item.invoiceFileUrl ? (
          <p>
            <a
              href={item.invoiceFileUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-amber-700 hover:text-amber-800"
            >
              Ver factura adjunta
            </a>
          </p>
        ) : null}
        {linkedInvoices.length > 0 ? (
          <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
            <p className="text-xs font-semibold text-sky-800">Facturas vinculadas ({linkedInvoices.length})</p>
            <ul className="mt-1 space-y-0.5">
              {linkedInvoices.map((invoice) => (
                <li key={invoice.id} className="text-xs text-sky-700">
                  {invoice.code} · {invoice.providerName}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {onChangeBillingStatus && nextSteps.length > 0 ? (
        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
          {nextSteps.map((nextStatus) => (
            <button
              key={nextStatus}
              type="button"
              onClick={() => onChangeBillingStatus(item.id, nextStatus)}
              className={`rounded-lg border px-3 py-2 text-xs font-semibold hover:opacity-80 ${billingStatusClassMap[nextStatus]}`}
            >
              {nextStatus === 'RECHAZADO' ? 'Rechazar' : `Marcar: ${billingStatusLabelMap[nextStatus]}`}
            </button>
          ))}
        </div>
      ) : null}

      {canEdit || canDelete ? (
        <div className="mt-4 flex gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={() => onEdit(item.id)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Editar
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(item.id)}
              className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
            >
              Eliminar
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
