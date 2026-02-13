interface MaintenanceSummaryCardProps {
  totalPlans: number
  overduePlans: number
  dueSoonPlans: number
  okPlans: number
}

export const MaintenanceSummaryCard = ({
  totalPlans,
  overduePlans,
  dueSoonPlans,
  okPlans,
}: MaintenanceSummaryCardProps) => (
  <div className="grid gap-3 md:grid-cols-4">
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total planes</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{totalPlans}</p>
    </article>
    <article className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Vencidos</p>
      <p className="mt-2 text-2xl font-bold text-rose-800">{overduePlans}</p>
    </article>
    <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Por vencer</p>
      <p className="mt-2 text-2xl font-bold text-amber-800">{dueSoonPlans}</p>
    </article>
    <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">OK</p>
      <p className="mt-2 text-2xl font-bold text-emerald-800">{okPlans}</p>
    </article>
  </div>
)
