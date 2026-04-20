interface InventoryStockCardProps {
  totalItems: number
  totalStockUnits: number
  lowStockItems: number
  linkedToWorkOrders: number
  totalValueArs: number
  totalValueUsd: number
}

const formatCurrency = (value: number, currency: 'ARS' | 'USD') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

export const InventoryStockCard = ({
  totalItems,
  totalStockUnits,
  lowStockItems,
  linkedToWorkOrders,
  totalValueArs,
  totalValueUsd,
}: InventoryStockCardProps) => (
  <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{totalItems}</p>
    </article>

    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stock total</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{totalStockUnits}</p>
    </article>

    <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Stock bajo</p>
      <p className="mt-2 text-2xl font-bold text-amber-800">{lowStockItems}</p>
    </article>

    <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Inversión ARS</p>
      <p className="mt-2 text-lg font-bold text-emerald-800">
        {totalValueArs > 0 ? formatCurrency(totalValueArs, 'ARS') : '—'}
      </p>
    </article>

    <article className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Inversión USD</p>
      <p className="mt-2 text-lg font-bold text-sky-800">
        {totalValueUsd > 0 ? formatCurrency(totalValueUsd, 'USD') : '—'}
      </p>
    </article>
  </div>
)
