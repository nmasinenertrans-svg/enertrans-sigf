interface WorkOrderBoardProps {
  total: number
  open: number
  inProgress: number
  closed: number
}

export const WorkOrderBoard = ({ total, open, inProgress, closed }: WorkOrderBoardProps) => (
  <div className="grid gap-3 md:grid-cols-4">
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total OT</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{total}</p>
    </article>
    <article className="rounded-xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Abiertas</p>
      <p className="mt-2 text-2xl font-bold text-sky-800">{open}</p>
    </article>
    <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">En proceso</p>
      <p className="mt-2 text-2xl font-bold text-amber-800">{inProgress}</p>
    </article>
    <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Cerradas</p>
      <p className="mt-2 text-2xl font-bold text-emerald-800">{closed}</p>
    </article>
  </div>
)
