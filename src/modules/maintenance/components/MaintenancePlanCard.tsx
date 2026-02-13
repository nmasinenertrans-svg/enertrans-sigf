import { StatusPill } from '../../../components/ui/StatusPill'
import type { MaintenancePlanViewModel } from '../types'

interface MaintenancePlanCardProps {
  planView: MaintenancePlanViewModel
  onEdit: (planId: string) => void
  onDelete: (planId: string) => void
  canEdit?: boolean
  canDelete?: boolean
}

export const MaintenancePlanCard = ({
  planView,
  onEdit,
  onDelete,
  canEdit = true,
  canDelete = true,
}: MaintenancePlanCardProps) => {
  const { plan, unit, remainingKilometers, remainingHours, calculatedStatus } = planView

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unidad</p>
          <h3 className="mt-1 text-base font-bold text-slate-900">{unit?.internalCode ?? 'Unidad no disponible'}</h3>
          <p className="text-sm text-slate-600">{unit?.ownerCompany ?? 'Sin empresa asociada'}</p>
        </div>
        <StatusPill status={calculatedStatus} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">KM actuales</p>
          <p className="mt-1 font-semibold">{plan.currentKilometers}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Próximo service KM</p>
          <p className="mt-1 font-semibold">{plan.nextServiceByKilometers}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Horas actuales</p>
          <p className="mt-1 font-semibold">{plan.currentHours}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Próximo service horas</p>
          <p className="mt-1 font-semibold">{plan.nextServiceByHours}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700">
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Restante KM</span>
          <span className="mt-1 block font-semibold">{remainingKilometers}</span>
        </p>
        <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <span className="text-xs uppercase tracking-wide text-slate-500">Restante horas</span>
          <span className="mt-1 block font-semibold">{remainingHours}</span>
        </p>
      </div>

      <p className="mt-4 text-sm text-slate-700">
        <span className="font-semibold">Aceites:</span> {plan.oils.join(', ')}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="font-semibold">Filtros:</span> {plan.filters.join(', ')}
      </p>
      <p className="mt-1 text-sm text-slate-700">
        <span className="font-semibold">Notas:</span> {plan.notes || 'Sin observaciones.'}
      </p>

      {canEdit || canDelete ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {canEdit ? (
            <button
              type="button"
              onClick={() => onEdit(plan.id)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Editar
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={() => onDelete(plan.id)}
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
