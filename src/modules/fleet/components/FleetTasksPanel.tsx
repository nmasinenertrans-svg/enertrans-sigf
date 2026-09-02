import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { TaskPriority, TaskRecord, TaskStatus, TaskType } from '../../../types/domain'

interface FleetTasksPanelProps {
  unitId: string
}

const statusLabelMap: Record<TaskStatus, string> = {
  UNASSIGNED: 'Sin asignar',
  ASSIGNED: 'Asignada',
  IN_PROGRESS: 'En curso',
  BLOCKED: 'Bloqueada',
  DONE: 'Finalizada',
  CANCELED: 'Cancelada',
}

const priorityLabelMap: Record<TaskPriority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
}

const taskTypeLabelMap: Record<TaskType, string> = {
  REVISION_CHECKLIST: 'Revisión / Checklist',
  RTO: 'RTO',
  ENTREGA: 'Entrega',
  RETIRO_DEVOLUCION: 'Retiro / Devolución',
  REPARACION: 'Reparación / Acondicionamiento',
  MANTENIMIENTO: 'Mantenimiento',
  ADMINISTRATIVA: 'Administrativa',
  OTRA: 'Otra',
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-AR')
}

export const FleetTasksPanel = ({ unitId }: FleetTasksPanelProps) => {
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    apiRequest<TaskRecord[]>(`/tasks?unitId=${unitId}`)
      .then((data) => {
        if (cancelled) return
        setTasks(Array.isArray(data) ? data : [])
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [unitId])

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Tareas de la unidad</h3>
          <p className="mt-1 text-sm text-slate-600">
            Tareas vinculadas directamente a esta unidad. La carga se hace desde el módulo de Tareas.
          </p>
        </div>
        <Link
          to={ROUTE_PATHS.tasks}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
        >
          Abrir módulo Tareas
        </Link>
      </div>

      {status === 'loading' ? <p className="mt-4 text-sm text-slate-500">Cargando tareas...</p> : null}
      {status === 'error' ? (
        <p className="mt-4 text-sm text-red-600">No se pudieron cargar las tareas de esta unidad.</p>
      ) : null}
      {status === 'ready' && tasks.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">Aún no hay tareas vinculadas a esta unidad.</p>
      ) : null}
      {status === 'ready' && tasks.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Tarea</th>
                <th className="px-3 py-2">Tipo</th>
                <th className="px-3 py-2">Estado</th>
                <th className="px-3 py-2">Prioridad</th>
                <th className="px-3 py-2">Asignada a</th>
                <th className="px-3 py-2">Fin aprox.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tasks.map((task) => (
                <tr key={task.id}>
                  <td className="px-3 py-2 font-semibold text-slate-900">{task.title || 'Tarea sin título'}</td>
                  <td className="px-3 py-2 text-slate-700">{taskTypeLabelMap[task.type]}</td>
                  <td className="px-3 py-2 text-slate-700">{statusLabelMap[task.status]}</td>
                  <td className="px-3 py-2 text-slate-700">{priorityLabelMap[task.priority]}</td>
                  <td className="px-3 py-2 text-slate-700">
                    {task.assignedToUserName || task.assignedToExternalName || 'Sin asignar'}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{formatDate(task.estimatedFinishDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </article>
  )
}
