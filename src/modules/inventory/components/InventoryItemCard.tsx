import type { InventoryViewItem } from '../types'

interface InventoryItemCardProps {
  item: InventoryViewItem
  onEdit: (itemId: string) => void
  onDelete: (itemId: string) => void
  canEdit?: boolean
  canDelete?: boolean
}

export const InventoryItemCard = ({
  item,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: InventoryItemCardProps) => {
  const latestMovement = item.movementHistory[item.movementHistory.length - 1] ?? 'Sin movimientos'

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">SKU</p>
          <h3 className="mt-1 text-base font-bold text-slate-900">{item.sku}</h3>
          <p className="text-sm text-slate-600">{item.productName}</p>
        </div>

        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            item.stock <= 5
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700'
          }`}
        >
          Stock: {item.stock}
        </span>
      </div>

      <div className="mt-4 space-y-2 text-sm text-slate-700">
        <p>
          <span className="font-semibold">OT vinculadas:</span>{' '}
          {item.linkedWorkOrderIds.length > 0 ? item.linkedWorkOrderIds.length : 0}
        </p>
        <p>
          <span className="font-semibold">Ultimo movimiento:</span> {latestMovement}
        </p>
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
