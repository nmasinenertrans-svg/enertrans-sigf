import type { WorkOrderDeviation } from '../../../types/domain'
import { workOrderStatusClassMap } from '../services/workOrdersService'
import type { WorkOrderViewItem } from '../types'

interface WorkOrderCardProps {
  item: WorkOrderViewItem
  onEdit: (workOrderId: string) => void
  onDelete: (workOrderId: string) => void
  onExportPdf: (workOrderId: string) => void
  onResolveDeviation: (workOrderId: string, deviation: WorkOrderDeviation) => void
  canEdit?: boolean
  canDelete?: boolean
}

export const WorkOrderCard = ({
  item,
  onEdit,
  onDelete,
  onExportPdf,
  onResolveDeviation,
  canEdit = true,
  canDelete = true,
}: WorkOrderCardProps) => (
  <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Unidad</p>
        <h3 className="mt-1 text-base font-bold text-slate-900">{item.unitLabel}</h3>
        <p className="text-xs font-semibold text-slate-500">{item.code}</p>
      </div>
      <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${workOrderStatusClassMap[item.status]}`}>
        {item.statusLabel}
      </span>
    </div>

    <div className="mt-4 space-y-2 text-sm text-slate-700">
      {item.pendingReaudit ? <p className="text-xs font-semibold text-amber-700">Pendiente de re-inspeccion</p> : null}
      <p>
        <span className="font-semibold">Desvios:</span> {item.taskList.length}
      </p>
      <p>
        <span className="font-semibold">Repuestos:</span> {item.spareParts.length}
      </p>
      <p>
        <span className="font-semibold">Mano de obra:</span> {item.laborDetail}
      </p>
      <p>
        <span className="font-semibold">Inventario vinculado:</span>{' '}
        {item.linkedInventorySkuList.length > 0 ? item.linkedInventorySkuList.join(', ') : 'Sin vínculo'}
      </p>
    </div>

    <div className="mt-4 space-y-2">
      {item.taskList.map((task) => {
        const hasEvidence = Boolean((task.resolutionPhotoUrl ?? '').trim() || (task.resolutionPhotoBase64 ?? '').trim())
        const isResolved = task.status === 'RESOLVED'
        const canResolveTask = !isResolved || !hasEvidence

        return (
        <div key={task.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-semibold text-slate-900">{task.section}</p>
              <p className="text-slate-600">{task.item}</p>
              {task.observation ? <p className="text-slate-500">Obs: {task.observation}</p> : null}
              {isResolved && !hasEvidence ? (
                <p className="text-amber-700">Falta evidencia fotografica para cerrar la OT.</p>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${
                  isResolved
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-rose-300 bg-rose-50 text-rose-700'
                }`}
              >
                {isResolved ? 'RESUELTO' : 'PENDIENTE'}
              </span>
              {canResolveTask ? (
                <button
                  type="button"
                  onClick={() => onResolveDeviation(item.id, task)}
                  className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
                >
                  {isResolved ? 'Completar evidencia' : 'Resolver'}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )})}
    </div>

    <div className="mt-4 flex gap-2">
      <button
        type="button"
        onClick={() => onExportPdf(item.id)}
        className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
      >
        PDF
      </button>
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
  </article>
)
