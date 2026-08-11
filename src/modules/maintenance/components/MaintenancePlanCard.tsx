import { StatusPill } from '../../../components/ui/StatusPill'
import { maintenanceTypeLabels } from '../services/maintenanceService'
import type { MaintenancePlanViewModel } from '../types'

interface MaintenancePlanCardProps {
  planView: MaintenancePlanViewModel
  onEdit: (planId: string) => void
  onDelete: (planId: string) => void
  onMarkServiceDone: (planId: string) => void
  canEdit?: boolean
  canDelete?: boolean
}

export const MaintenancePlanCard = ({
  planView,
  onEdit,
  onDelete,
  onMarkServiceDone,
  canEdit = true,
  canDelete = true,
}: MaintenancePlanCardProps) => {
  const { plan, unit, measurementUnit, remainingKilometers, remainingHours, calculatedStatus } = planView
  const isKilometers = measurementUnit === 'KILOMETERS'
  const current = isKilometers ? plan.currentKilometers : plan.currentHours
  const nextServiceBy = isKilometers ? plan.nextServiceByKilometers : plan.nextServiceByHours
  const remaining = isKilometers ? remainingKilometers : remainingHours
  const interval = isKilometers ? plan.serviceIntervalKilometers : plan.serviceIntervalHours
  const unitLabel = isKilometers ? 'km' : 'hs'

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {unit?.internalCode ?? 'Unidad no disponible'}
          </p>
          <h3 className="mt-1 text-base font-bold text-slate-900">
            {maintenanceTypeLabels[plan.maintenanceType] ?? plan.maintenanceType}
          </h3>
          <p className="text-sm text-slate-600">{unit?.ownerCompany ?? 'Sin empresa asociada'}</p>
        </div>
        <StatusPill status={calculatedStatus} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm text-slate-700">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Actual</p>
          <p className="mt-1 font-semibold">
            {current} {unitLabel}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Próximo service</p>
          <p className="mt-1 font-semibold">
            {nextServiceBy} {unitLabel}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Intervalo</p>
          <p className="mt-1 font-semibold">{interval ? `cada ${interval} ${unitLabel}` : 'Sin configurar'}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <p className="text-xs uppercase tracking-wide text-slate-500">Restante</p>
          <p className="mt-1 font-semibold">
            {remaining} {unitLabel}
          </p>
        </div>
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
              onClick={() => onMarkServiceDone(plan.id)}
              disabled={!interval}
              title={!interval ? 'Configurá el intervalo de service para poder marcarlo como realizado.' : undefined}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Marcar service realizado
            </button>
          ) : null}
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
