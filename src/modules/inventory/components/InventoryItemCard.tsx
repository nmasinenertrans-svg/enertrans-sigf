import { formatStock } from '../services/inventoryService'
import type { InventoryViewItem } from '../types'

interface InventoryItemCardProps {
  item: InventoryViewItem
  onEdit: (itemId: string) => void
  onDelete: (itemId: string) => void
  canEdit?: boolean
  canDelete?: boolean
}

const lowStockThreshold: Record<string, number> = {
  UNIDAD: 5,
  LITRO: 10,
  KG: 5,
  METRO: 5,
}

export const InventoryItemCard = ({
  item,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: InventoryItemCardProps) => {
  const unit = item.unit ?? 'UNIDAD'
  const threshold = lowStockThreshold[unit] ?? 5
  const isLowStock = item.stock <= threshold
  const latestMovement = item.movementHistory[item.movementHistory.length - 1] ?? 'Sin movimientos'
  const totalValue = item.unitPrice != null ? item.stock * item.unitPrice : null

  const formatCurrency = (value: number, currency: 'ARS' | 'USD' = 'ARS') =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">SKU</p>
          <h3 className="mt-0.5 text-base font-bold text-slate-900">{item.sku}</h3>
          <p className="text-sm text-slate-600">{item.productName}</p>
          {item.externalBarcode && item.externalBarcode !== item.sku && (
            <p className="mt-0.5 text-xs text-slate-400">Cód. barra: {item.externalBarcode}</p>
          )}
        </div>

        <span
          className={`rounded-full border px-2 py-1 text-xs font-semibold ${
            isLowStock
              ? 'border-amber-300 bg-amber-50 text-amber-700'
              : 'border-emerald-300 bg-emerald-50 text-emerald-700'
          }`}
        >
          {formatStock(item.stock, unit)}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
        {item.unitPrice != null && (
          <>
            <p>
              <span className="font-semibold">Precio unitario:</span>{' '}
              {formatCurrency(item.unitPrice, item.currency)}
            </p>
            {totalValue != null && (
              <p>
                <span className="font-semibold">Valor en stock:</span>{' '}
                <span className="font-semibold text-slate-800">{formatCurrency(totalValue, item.currency)}</span>
              </p>
            )}
          </>
        )}
        <p className="col-span-2">
          <span className="font-semibold">OT vinculadas:</span> {item.linkedWorkOrderIds.length}
        </p>
        <p className="col-span-2 truncate">
          <span className="font-semibold">Último movimiento:</span> {latestMovement}
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
