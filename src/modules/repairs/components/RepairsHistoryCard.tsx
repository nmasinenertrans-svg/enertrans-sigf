import type { RepairViewItem } from '../types'

interface RepairsHistoryCardProps {
  item: RepairViewItem
  onEdit: (repairId: string) => void
  onDelete: (repairId: string) => void
  canEdit?: boolean
  canDelete?: boolean
}

export const RepairsHistoryCard = ({ item, onEdit, onDelete, canEdit = true, canDelete = true }: RepairsHistoryCardProps) => {
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
        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            item.margin >= 0 ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-rose-300 bg-rose-50 text-rose-700'
          }`}
        >
          Margen: {moneyFormatter.format(item.margin)}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-700">
        <p>
          <span className="font-semibold">{item.sourceType === 'EXTERNAL_REQUEST' ? 'Nota externa:' : 'OT:'}</span>{' '}
          {item.sourceType === 'EXTERNAL_REQUEST' ? item.externalRequestLabel : item.workOrderLabel}
        </p>
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
          <span className="font-semibold">Costo real:</span> {moneyFormatter.format(item.realCost)}
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
      </div>

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
