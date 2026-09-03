import type { InvoiceViewItem } from '../services/invoicesService'

interface InvoiceCardProps {
  invoice: InvoiceViewItem
  onDelete: (invoiceId: string) => void
  onEdit?: (invoice: InvoiceViewItem) => void
  canDelete?: boolean
  canEdit?: boolean
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-AR')
}

export const InvoiceCard = ({ invoice, onDelete, onEdit, canDelete = true, canEdit = false }: InvoiceCardProps) => {
  const formatCurrency = (value: number, currency: 'ARS' | 'USD' = 'ARS') =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{invoice.code}</p>
          <h3 className="mt-0.5 text-base font-bold text-slate-900">{invoice.providerName}</h3>
          {invoice.invoiceNumber ? <p className="text-xs text-slate-500">N° {invoice.invoiceNumber}</p> : null}
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
          {formatCurrency(invoice.amount, invoice.currency)}
        </span>
      </div>

      <p className="mt-2 text-xs text-slate-500">Emitida: {formatDate(invoice.issuedAt)}</p>

      {invoice.unitLabel ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
          Unidad: {invoice.unitLabel}
        </p>
      ) : null}

      {invoice.repairLabel ? (
        <p className="mt-2 rounded-lg border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-700">
          Reparación: {invoice.repairLabel}
        </p>
      ) : null}

      {invoice.inventoryItemLabels.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {invoice.inventoryItemLabels.map((label) => (
            <span
              key={label}
              className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600"
            >
              {label}
            </span>
          ))}
        </div>
      ) : null}

      {invoice.notes ? <p className="mt-2 text-xs text-slate-600">{invoice.notes}</p> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {invoice.fileUrl ? (
          <a
            href={invoice.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Ver archivo
          </a>
        ) : null}
        {canEdit && onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(invoice)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
          >
            Editar
          </button>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            onClick={() => onDelete(invoice.id)}
            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
          >
            Eliminar
          </button>
        ) : null}
      </div>
    </article>
  )
}
