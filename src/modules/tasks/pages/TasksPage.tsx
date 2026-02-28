import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { TaskPriority, TaskRecord, TaskStatus } from '../../../types/domain'

type TaskFormData = {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  assignedToUserId: string
  isInTaskBank: boolean
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

const priorityBadgeMap: Record<TaskPriority, string> = {
  LOW: 'border-slate-200 bg-slate-100 text-slate-700',
  MEDIUM: 'border-sky-200 bg-sky-50 text-sky-700',
  HIGH: 'border-amber-200 bg-amber-50 text-amber-700',
  URGENT: 'border-rose-200 bg-rose-50 text-rose-700',
}

const createEmptyForm = (): TaskFormData => ({
  title: '',
  description: '',
  status: 'UNASSIGNED',
  priority: 'MEDIUM',
  assignedToUserId: '',
  isInTaskBank: true,
})

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

export const TasksPage = () => {
  const { currentUser, can } = usePermissions()
  const {
    state: { users },
    actions: { setAppError },
  } = useAppContext()

  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState<TaskFormData>(createEmptyForm)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | TaskPriority>('ALL')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL')
  const [bankFilter, setBankFilter] = useState<'ALL' | 'BANK' | 'ASSIGNED'>('ALL')

  const isManager = currentUser?.role === 'DEV' || currentUser?.role === 'GERENTE'
  const canViewTasks = can('TASKS', 'view')

  const assignableUsers = useMemo(
    () => users.filter((user) => user.role === 'AUDITOR' || user.role === 'MECANICO' || user.role === 'COORDINADOR'),
    [users],
  )

  const loadTasks = useCallback(async () => {
    if (!canViewTasks) {
      return
    }
    setIsLoading(true)
    try {
      const response = await apiRequest<TaskRecord[]>('/tasks')
      setTasks(Array.isArray(response) ? response : [])
    } catch {
      setAppError('No se pudieron cargar las tareas.')
    } finally {
      setIsLoading(false)
    }
  }, [canViewTasks, setAppError])

  useEffect(() => {
    loadTasks()
  }, [loadTasks])

  const resetForm = () => {
    setEditingTaskId(null)
    setFormData(createEmptyForm())
  }

  const handleFormChange = <K extends keyof TaskFormData>(field: K, value: TaskFormData[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
  }

  const submitTask = async () => {
    if (!isManager || !formData.description.trim()) {
      if (!formData.description.trim()) {
        setAppError('La descripcion de la tarea es obligatoria.')
      }
      return
    }

    setIsSaving(true)
    try {
      const payload = {
        title: formData.title.trim(),
        description: formData.description.trim(),
        status: formData.status,
        priority: formData.priority,
        assignedToUserId: formData.assignedToUserId || null,
        isInTaskBank: formData.isInTaskBank,
      }

      if (editingTaskId) {
        const updated = await apiRequest<TaskRecord>(`/tasks/${editingTaskId}`, { method: 'PATCH', body: payload })
        setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
      } else {
        const created = await apiRequest<TaskRecord>('/tasks', { method: 'POST', body: payload })
        setTasks((previous) => [created, ...previous])
      }
      resetForm()
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo guardar la tarea.'))
    } finally {
      setIsSaving(false)
    }
  }

  const startEdit = (taskId: string) => {
    if (!isManager) {
      return
    }
    const task = tasks.find((item) => item.id === taskId)
    if (!task) {
      return
    }
    setEditingTaskId(task.id)
    setFormData({
      title: task.title ?? '',
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      assignedToUserId: task.assignedToUserId ?? '',
      isInTaskBank: Boolean(task.isInTaskBank),
    })
  }

  const handleTakeFromBank = async (taskId: string) => {
    try {
      const updated = await apiRequest<TaskRecord>(`/tasks/${taskId}/take`, { method: 'POST', body: {} })
      setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo tomar la tarea.'))
    }
  }

  const handleQuickStatusChange = async (taskId: string, status: TaskStatus) => {
    try {
      const updated = await apiRequest<TaskRecord>(`/tasks/${taskId}`, { method: 'PATCH', body: { status } })
      setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo actualizar el estado.'))
    }
  }

  const filteredTasks = useMemo(() => {
    const query = searchTerm.trim().toLowerCase()
    return tasks.filter((task) => {
      if (statusFilter !== 'ALL' && task.status !== statusFilter) {
        return false
      }
      if (priorityFilter !== 'ALL' && task.priority !== priorityFilter) {
        return false
      }
      if (assigneeFilter !== 'ALL' && (task.assignedToUserId ?? '') !== assigneeFilter) {
        return false
      }
      if (bankFilter === 'BANK' && !task.isInTaskBank) {
        return false
      }
      if (bankFilter === 'ASSIGNED' && task.isInTaskBank) {
        return false
      }
      if (!query) {
        return true
      }
      const haystack = [
        task.title,
        task.description,
        task.createdByUserName,
        task.assignedToUserName,
        statusLabelMap[task.status],
        priorityLabelMap[task.priority],
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [tasks, statusFilter, priorityFilter, assigneeFilter, bankFilter, searchTerm])

  const bankTasks = useMemo(
    () => filteredTasks.filter((task) => task.isInTaskBank && !task.assignedToUserId),
    [filteredTasks],
  )
  const assignedTasks = useMemo(() => filteredTasks.filter((task) => !task.isInTaskBank), [filteredTasks])

  const currentUserCanTake = currentUser?.role === 'AUDITOR' || currentUser?.role === 'MECANICO'

  if (!canViewTasks) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Tareas</h2>
        <p className="mt-2 text-sm text-slate-600">No tenes permisos para ver este modulo.</p>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Tareas</h2>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">{editingTaskId ? 'Editar tarea' : 'Nueva tarea'}</h3>

          {isManager ? (
            <>
              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Titulo (opcional)
                <input
                  value={formData.title}
                  onChange={(event) => handleFormChange('title', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Ej: Revision frenos unidad 18"
                />
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Descripcion
                <textarea
                  rows={4}
                  value={formData.description}
                  onChange={(event) => handleFormChange('description', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  placeholder="Detalle de la tarea..."
                />
              </label>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Estado
                  <select
                    value={formData.status}
                    onChange={(event) => handleFormChange('status', event.target.value as TaskStatus)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    {(Object.keys(statusLabelMap) as TaskStatus[]).map((status) => (
                      <option key={status} value={status}>
                        {statusLabelMap[status]}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Prioridad
                  <select
                    value={formData.priority}
                    onChange={(event) => handleFormChange('priority', event.target.value as TaskPriority)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    {(Object.keys(priorityLabelMap) as TaskPriority[]).map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabelMap[priority]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-4 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={formData.isInTaskBank}
                  onChange={(event) => handleFormChange('isInTaskBank', event.target.checked)}
                />
                Enviar al banco de tareas
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Asignar a (opcional)
                <select
                  value={formData.assignedToUserId}
                  onChange={(event) => handleFormChange('assignedToUserId', event.target.value)}
                  disabled={formData.isInTaskBank}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                >
                  <option value="">Sin asignar</option>
                  {assignableUsers.map((user) => (
                    <option key={user.id} value={user.id}>
                      {user.fullName} ({user.role})
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-5 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitTask}
                  disabled={isSaving}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
                >
                  {isSaving ? 'Guardando...' : editingTaskId ? 'Guardar cambios' : 'Crear tarea'}
                </button>
                {editingTaskId ? (
                  <button
                    type="button"
                    onClick={resetForm}
                    className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                  >
                    Cancelar
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Podes tomar tareas desde el banco si tu rol es Auditor o Mecanico.
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex min-w-[220px] flex-1 flex-col gap-2 text-sm font-semibold text-slate-700">
              Buscar
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Descripcion, titulo, persona..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Estado
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as 'ALL' | TaskStatus)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todos</option>
                {(Object.keys(statusLabelMap) as TaskStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {statusLabelMap[status]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Prioridad
              <select
                value={priorityFilter}
                onChange={(event) => setPriorityFilter(event.target.value as 'ALL' | TaskPriority)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todas</option>
                {(Object.keys(priorityLabelMap) as TaskPriority[]).map((priority) => (
                  <option key={priority} value={priority}>
                    {priorityLabelMap[priority]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Persona
              <select
                value={assigneeFilter}
                onChange={(event) => setAssigneeFilter(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todas</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Vista
              <select
                value={bankFilter}
                onChange={(event) => setBankFilter(event.target.value as 'ALL' | 'BANK' | 'ASSIGNED')}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todas</option>
                <option value="BANK">Solo banco</option>
                <option value="ASSIGNED">Solo asignadas/historico</option>
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Banco de tareas</h3>
                  <p className="text-xs text-slate-500">Tareas libres para tomar.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                  {bankTasks.length}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {isLoading ? (
                  <p className="text-sm text-slate-500">Cargando tareas...</p>
                ) : bankTasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                    No hay tareas disponibles en el banco.
                  </p>
                ) : (
                  bankTasks.map((task) => (
                    <div key={task.id} className="rounded-lg border border-slate-200 bg-white p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${priorityBadgeMap[task.priority]}`}>
                          {priorityLabelMap[task.priority]}
                        </span>
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {statusLabelMap[task.status]}
                        </span>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{task.title || 'Tarea sin titulo'}</p>
                      <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Creada por {task.createdByUserName || task.createdByUserId} | {formatDateTime(task.createdAt)}
                      </p>
                      {currentUserCanTake ? (
                        <button
                          type="button"
                          onClick={() => handleTakeFromBank(task.id)}
                          className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                        >
                          Tomar tarea
                        </button>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </article>

            <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Asignadas / Historico</h3>
                  <p className="text-xs text-slate-500">Seguimiento y cambios de estado.</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
                  {assignedTasks.length}
                </span>
              </div>

              <div className="mt-3 space-y-3">
                {isLoading ? (
                  <p className="text-sm text-slate-500">Cargando tareas...</p>
                ) : assignedTasks.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
                    No hay tareas para el filtro seleccionado.
                  </p>
                ) : (
                  assignedTasks.map((task) => {
                    const canEditThisTask = isManager || (currentUser?.id && task.assignedToUserId === currentUser.id && can('TASKS', 'edit'))
                    return (
                      <div key={task.id} className="rounded-lg border border-slate-200 bg-white p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${priorityBadgeMap[task.priority]}`}>
                                {priorityLabelMap[task.priority]}
                              </span>
                              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-600">
                                {statusLabelMap[task.status]}
                              </span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{task.title || 'Tarea sin titulo'}</p>
                            <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                            <p className="mt-2 text-xs text-slate-500">
                              Asignada a {task.assignedToUserName || 'Sin asignar'} | Creada por {task.createdByUserName || task.createdByUserId}
                            </p>
                          </div>
                          {isManager ? (
                            <button
                              type="button"
                              onClick={() => startEdit(task.id)}
                              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Editar
                            </button>
                          ) : null}
                        </div>

                        {canEditThisTask ? (
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-slate-600">Estado:</span>
                            <select
                              value={task.status}
                              onChange={(event) => handleQuickStatusChange(task.id, event.target.value as TaskStatus)}
                              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
                            >
                              {(Object.keys(statusLabelMap) as TaskStatus[]).map((status) => (
                                <option key={status} value={status}>
                                  {statusLabelMap[status]}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : null}

                        <details className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2">
                          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                            Historico ({task.events.length})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {task.events.length === 0 ? (
                              <p className="text-xs text-slate-500">Sin eventos registrados.</p>
                            ) : (
                              task.events.map((event) => (
                                <div key={event.id} className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600">
                                  <p className="font-semibold text-slate-800">
                                    {event.type} | {event.actorName || event.actorUserId}
                                  </p>
                                  <p>{formatDateTime(event.createdAt)}</p>
                                  {(event.fromStatus || event.toStatus) ? (
                                    <p>
                                      Estado: {event.fromStatus || '-'} {'->'} {event.toStatus || '-'}
                                    </p>
                                  ) : null}
                                </div>
                              ))
                            )}
                          </div>
                        </details>
                      </div>
                    )
                  })
                )}
              </div>
            </article>
          </div>
        </section>
      </div>
    </section>
  )
}
