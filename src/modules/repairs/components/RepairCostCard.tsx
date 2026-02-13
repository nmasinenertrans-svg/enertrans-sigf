interface RepairCostCardProps {
  totalRepairs: number
  totalRealCost: number
  totalInvoiced: number
  totalMargin: number
}

export const RepairCostCard = ({
  totalRepairs,
  totalRealCost,
  totalInvoiced,
  totalMargin,
}: RepairCostCardProps) => {
  const formatMoney = (value: number) =>
    new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)
  const recargoPercent = totalRealCost > 0 ? ((totalInvoiced - totalRealCost) / totalRealCost) * 100 : 0

  return (
    <div className="grid gap-3 md:grid-cols-5">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total reparaciones</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{totalRepairs}</p>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Costo real total</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(totalRealCost)}</p>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Facturado total</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(totalInvoiced)}</p>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Recargo promedio</p>
        <p className="mt-2 text-2xl font-bold text-slate-900">
          {new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(recargoPercent)}%
        </p>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Margen total</p>
        <p className={`mt-2 text-2xl font-bold ${totalMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
          {formatMoney(totalMargin)}
        </p>
      </article>
    </div>
  )
}
