import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { useAsyncLoader } from '../../../core/hooks/useAsyncLoader'
import { isRealUserId } from '../../../core/context/appState'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { getQueueItems } from '../../../services/offline/queue'
import { enqueueAndSync } from '../../../services/offline/sync'
import type { TaskPriority, TaskRecord, TaskStatus, TaskType } from '../../../types/domain'
import { downloadTaskPdf, downloadTasksSummaryPdf } from '../services/tasksPdfService'

const TASKS_PAGE_SIZE = 5

type TaskFormData = {
  title: string
  description: string
  status: TaskStatus
  priority: TaskPriority
  type: TaskType
  unitIds: string[]
  workOrderId: string
  assignedToUserIds: string[]
  assignedToExternalName: string
  isInTaskBank: boolean
  startDate: string
  estimatedFinishDate: string
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

const toDateInputValue = (value?: string | null): string => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toISOString().slice(0, 10)
}

const todayDateInputValue = (): string => new Date().toISOString().slice(0, 10)

const createEmptyForm = (): TaskFormData => ({
  title: '',
  description: '',
  status: 'UNASSIGNED',
  priority: 'MEDIUM',
  type: 'OTRA',
  unitIds: [],
  workOrderId: '',
  assignedToUserIds: [],
  assignedToExternalName: '',
  isInTaskBank: true,
  startDate: todayDateInputValue(),
  estimatedFinishDate: '',
})

const formatDateTime = (value?: string | null) => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

const formatDurationMinutes = (minutes: number): string => {
  if (minutes < 60) {
    return `${minutes} min`
  }
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) {
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}min` : `${hours}h`
  }
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`
}

const formatDateOnly = (value?: string | null) => {
  if (!value) {
    return '-'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  // Estas fechas son "solo dia" (sin hora), guardadas en UTC medianoche.
  // toLocaleDateString aplica el huso horario local (UTC-3 en Argentina) y
  // corria un dia para atras -- se lee el dia directo en UTC, igual que
  // toDateInputValue (asi la tarjeta y el formulario de edicion muestran
  // siempre la misma fecha).
  const day = String(date.getUTCDate()).padStart(2, '0')
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getUTCFullYear()}`
}

// Tareas viejas solo tenian un asignado/unidad sueltos (assignedToUserId/
// unitId); las nuevas usan los arrays (assignedToUserIds/unitIds). Estas dos
// funciones leen cualquiera de las dos formas sin repetir el fallback en
// cada lugar que necesita saber "a quien esta asignada" / "que unidades".
const getTaskAssigneeIds = (task: TaskRecord): string[] =>
  task.assignedToUserIds && task.assignedToUserIds.length > 0
    ? task.assignedToUserIds
    : task.assignedToUserId
      ? [task.assignedToUserId]
      : []

const getTaskUnitIds = (task: TaskRecord): string[] =>
  task.unitIds && task.unitIds.length > 0 ? task.unitIds : task.unitId ? [task.unitId] : []

const isTaskOverdue = (task: TaskRecord): boolean => {
  if (!task.estimatedFinishDate || task.status === 'DONE' || task.status === 'CANCELED') {
    return false
  }
  const due = new Date(task.estimatedFinishDate)
  return !Number.isNaN(due.getTime()) && due.getTime() < Date.now()
}

const taskEventTypeLabelMap: Partial<Record<string, string>> = {
  CREATED: 'Tarea creada',
  UPDATED: 'Tarea editada',
  ASSIGNED: 'Asignacion',
  UNASSIGNED: 'Se quito la asignacion',
  MOVED_TO_BANK: 'Enviada al banco',
  REMOVED_FROM_BANK: 'Sacada del banco',
  TAKEN_FROM_BANK: 'Tomada del banco',
  STATUS_CHANGED: 'Cambio de estado',
  VIEWED: 'Vista por el asignado',
}

export const TasksPage = () => {
  const { currentUser, can } = usePermissions()
  const {
    state: { users, fleetUnits, workOrders },
    actions: { setAppError },
  } = useAppContext()
  const [searchParams] = useSearchParams()

  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [formData, setFormData] = useState<TaskFormData>(createEmptyForm)
  const [unitSearch, setUnitSearch] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<'ALL' | TaskPriority>('ALL')
  const [typeFilter, setTypeFilter] = useState<'ALL' | TaskType>('ALL')
  const [unitFilter, setUnitFilter] = useState<string>('ALL')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('ALL')
  const [workOrderFilter, setWorkOrderFilter] = useState<string>(() => searchParams.get('workOrderId') ?? 'ALL')
  const [bankFilter, setBankFilter] = useState<'ALL' | 'BANK' | 'ASSIGNED'>('ALL')
  const [assignDrafts, setAssignDrafts] = useState<Record<string, { userId: string; externalName: string }>>({})
  const [assigningTaskId, setAssigningTaskId] = useState<string | null>(null)
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [sendingCommentTaskId, setSendingCommentTaskId] = useState<string | null>(null)
  const [markingViewedTaskIds, setMarkingViewedTaskIds] = useState<Set<string>>(new Set())
  const [expandedTaskSections, setExpandedTaskSections] = useState<Record<string, boolean>>({})

  const isManager = currentUser?.role === 'DEV' || currentUser?.role === 'GERENTE'
  const canViewTasks = can('TASKS', 'view')
  const canDeleteTasks = ['nmasin', 'rbottero'].includes((currentUser?.username ?? '').trim().toLowerCase())
  const isTaskAdmin = ['rbottero', 'nmasin', 'emoreno', 'crivas', 'mpinto'].includes(
    (currentUser?.username ?? '').trim().toLowerCase(),
  )
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null)

  const assignableUsers = useMemo(
    () =>
      users.filter(
        (user) =>
          isRealUserId(user.id) &&
          (user.role === 'AUDITOR' ||
            user.role === 'MECANICO' ||
            user.role === 'COORDINADOR' ||
            user.role === 'GERENTE' ||
            user.role === 'DEV'),
      ),
    [users],
  )

  const fleetUnitById = useMemo(() => new Map(fleetUnits.map((unit) => [unit.id, unit])), [fleetUnits])
  const workOrderById = useMemo(() => new Map(workOrders.map((order) => [order.id, order])), [workOrders])

  const selectedFormUnits = formData.unitIds.map((id) => fleetUnitById.get(id)).filter((unit): unit is (typeof fleetUnits)[number] => Boolean(unit))

  const filteredFormUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    const available = fleetUnits.filter((unit) => !formData.unitIds.includes(unit.id))
    if (!query) {
      return available.slice(0, 8)
    }
    return available
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch, formData.unitIds])

  const toggleFormAssignee = (userId: string) => {
    setFormData((previous) => ({
      ...previous,
      assignedToUserIds: previous.assignedToUserIds.includes(userId)
        ? previous.assignedToUserIds.filter((id) => id !== userId)
        : [...previous.assignedToUserIds, userId],
      assignedToExternalName: '',
    }))
  }

  const addFormUnit = (unitId: string) => {
    setFormData((previous) => ({ ...previous, unitIds: [...previous.unitIds, unitId] }))
    setUnitSearch('')
  }

  const removeFormUnit = (unitId: string) => {
    setFormData((previous) => ({ ...previous, unitIds: previous.unitIds.filter((id) => id !== unitId) }))
  }

  // Separada de useAsyncLoader a proposito: el refresco automatico de fondo
  // (cada tanto, o al recuperar foco) NO tiene que tapar la lista entera con
  // "Cargando tareas..." -- eso es lo que hacia que la pantalla "parpadeara"
  // cada vez que se actualizaba sola. Solo la carga inicial (al entrar a la
  // pagina) muestra ese estado de carga.
  const fetchTasksSilently = useCallback(async () => {
    if (!canViewTasks) return
    try {
      const response = await apiRequest<TaskRecord[]>('/tasks')
      const remoteTasks = Array.isArray(response) ? response : []
      // Las tareas creadas sin señal quedan en la cola offline hasta que se
      // sincronizan; si todavia no llegaron al servidor, se siguen viendo
      // en la lista (si no, "desaparecian" hasta que el navegador volviera
      // a sincronizar solo).
      const queuedTasks = (await getQueueItems())
        .filter((item) => item.type === 'task.create')
        .map((item) => item.payload as TaskRecord)
      const remoteIds = new Set(remoteTasks.map((task) => task.id))
      const pendingQueuedTasks = queuedTasks.filter((task) => task?.id && !remoteIds.has(task.id))
      setTasks([...remoteTasks, ...pendingQueuedTasks])
    } catch {
      setAppError('No se pudieron cargar las tareas.')
    }
  }, [canViewTasks, setAppError, setTasks])

  const { isLoading } = useAsyncLoader(
    async (getMounted) => {
      await fetchTasksSilently()
      if (!getMounted()) return
    },
    [fetchTasksSilently],
  )

  const lastAutoRefreshAtRef = useRef(0)
  const lastActivityAtRef = useRef(Date.now())
  // 8s era un umbral irreal: cualquiera que se quede leyendo o pensando 8
  // segundos sin tocar nada ya "cuenta" como inactivo y el refresco le
  // reordena/tapa la lista igual. Se sube a 90s (recien ahi es de verdad
  // "se fue a hacer otra cosa").
  const IDLE_THRESHOLD_MS = 90000

  useEffect(() => {
    // Si el usuario esta con algo abierto (completando un formulario,
    // escribiendo un comentario, etc.) el refresco automatico no deberia
    // interrumpirlo -- se marca actividad con cualquier tecleo/click/touch
    // y el refresco se salta mientras haya actividad reciente.
    const markActivity = () => {
      lastActivityAtRef.current = Date.now()
    }
    const activityEvents = ['mousedown', 'keydown', 'input', 'touchstart'] as const
    activityEvents.forEach((eventName) => window.addEventListener(eventName, markActivity, { passive: true }))
    return () => {
      activityEvents.forEach((eventName) => window.removeEventListener(eventName, markActivity))
    }
  }, [])

  useEffect(() => {
    if (!canViewTasks) {
      return
    }
    // El estado/asignacion de una tarea lo puede cambiar otra persona en cualquier momento
    // (el asignado, otro manager, etc.); sin esto la lista quedaba mostrando datos viejos
    // hasta que alguien recargaba la pagina a mano. Pero si el usuario esta activo, se
    // pospone el refresco para no cortarle lo que este haciendo -- vuelve a intentar en
    // el siguiente ciclo.
    const intervalId = window.setInterval(() => {
      if (Date.now() - lastActivityAtRef.current < IDLE_THRESHOLD_MS) {
        return
      }
      lastAutoRefreshAtRef.current = Date.now()
      void fetchTasksSilently()
    }, 30000)

    const handleVisibilityRegain = () => {
      if (document.visibilityState !== 'visible') {
        return
      }
      if (Date.now() - lastAutoRefreshAtRef.current < 15000) {
        return
      }
      lastAutoRefreshAtRef.current = Date.now()
      void fetchTasksSilently()
    }

    document.addEventListener('visibilitychange', handleVisibilityRegain)
    window.addEventListener('focus', handleVisibilityRegain)
    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityRegain)
      window.removeEventListener('focus', handleVisibilityRegain)
    }
  }, [canViewTasks, fetchTasksSilently])

  const resetForm = () => {
    setEditingTaskId(null)
    setFormData(createEmptyForm())
    setUnitSearch('')
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
        type: formData.type,
        unitId: formData.unitIds[0] ?? null,
        unitIds: formData.unitIds,
        workOrderId: formData.workOrderId || null,
        assignedToUserId: formData.assignedToUserIds[0] ?? null,
        assignedToUserIds: formData.assignedToUserIds,
        assignedToExternalName: formData.assignedToExternalName.trim(),
        isInTaskBank: formData.isInTaskBank,
        startDate: formData.startDate || null,
        estimatedFinishDate: formData.estimatedFinishDate || null,
      }

      if (editingTaskId) {
        const updated = await apiRequest<TaskRecord>(`/tasks/${editingTaskId}`, { method: 'PATCH', body: payload })
        setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
        resetForm()
      } else {
        const localId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? crypto.randomUUID()
            : `task-${Date.now()}-${Math.round(Math.random() * 10000)}`
        const assignedUsers = users.filter((user) => payload.assignedToUserIds.includes(user.id))
        const localTask: TaskRecord = {
          ...payload,
          id: localId,
          assignedToUserName: assignedUsers[0]?.fullName ?? '',
          assignedToUserNames: assignedUsers.map((user) => user.fullName),
          unitLabels: formData.unitIds.map((id) => fleetUnitById.get(id)?.internalCode ?? '').filter(Boolean),
          createdByUserId: currentUser?.id ?? '',
          createdByUserName: currentUser?.fullName ?? '',
          events: [],
        }
        setTasks((previous) => [localTask, ...previous])
        resetForm()
        try {
          await enqueueAndSync({
            id: `task.create.${localId}`,
            type: 'task.create',
            payload: localTask,
            createdAt: new Date().toISOString(),
          })
        } catch (error) {
          const isNetworkIssue =
            (typeof navigator !== 'undefined' && !navigator.onLine) ||
            String((error as Error)?.message ?? '').toLowerCase().includes('timeout') ||
            String((error as Error)?.message ?? '').toLowerCase().includes('failed to fetch')
          setAppError(
            isNetworkIssue
              ? 'Red inestable detectada. La tarea quedo guardada localmente y se sincronizara cuando haya mejor conexion.'
              : 'No se pudo confirmar la tarea en el servidor. Quedo en cola para reintento.',
          )
        }
      }
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
    setUnitSearch('')
    setFormData({
      title: task.title ?? '',
      description: task.description ?? '',
      status: task.status,
      priority: task.priority,
      type: task.type ?? 'OTRA',
      unitIds: task.unitIds && task.unitIds.length > 0 ? task.unitIds : task.unitId ? [task.unitId] : [],
      workOrderId: task.workOrderId ?? '',
      assignedToUserIds:
        task.assignedToUserIds && task.assignedToUserIds.length > 0
          ? task.assignedToUserIds
          : task.assignedToUserId
            ? [task.assignedToUserId]
            : [],
      assignedToExternalName: task.assignedToExternalName ?? '',
      isInTaskBank: Boolean(task.isInTaskBank),
      startDate: toDateInputValue(task.startDate) || toDateInputValue(task.createdAt),
      estimatedFinishDate: toDateInputValue(task.estimatedFinishDate),
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

  const getAssignDraft = (taskId: string) => assignDrafts[taskId] ?? { userId: '', externalName: '' }

  const setAssignDraftUserId = (taskId: string, userId: string) => {
    setAssignDrafts((previous) => ({
      ...previous,
      [taskId]: { userId, externalName: userId ? '' : (previous[taskId]?.externalName ?? '') },
    }))
  }

  const setAssignDraftExternalName = (taskId: string, externalName: string) => {
    setAssignDrafts((previous) => ({
      ...previous,
      [taskId]: { userId: externalName ? '' : (previous[taskId]?.userId ?? ''), externalName },
    }))
  }

  const handleAssignBankTask = async (taskId: string) => {
    const draft = getAssignDraft(taskId)
    const externalName = draft.externalName.trim()
    if (!draft.userId && !externalName) {
      setAppError('Elegi un usuario o escribi un tercero para asignar la tarea.')
      return
    }

    setAssigningTaskId(taskId)
    try {
      const updated = await apiRequest<TaskRecord>(`/tasks/${taskId}`, {
        method: 'PATCH',
        body: {
          assignedToUserId: draft.userId || null,
          assignedToExternalName: externalName,
          isInTaskBank: false,
        },
      })
      setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
      setAssignDrafts((previous) => {
        const next = { ...previous }
        delete next[taskId]
        return next
      })
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo asignar la tarea.'))
    } finally {
      setAssigningTaskId(null)
    }
  }

  const handleDeleteTask = async (taskId: string) => {
    if (!canDeleteTasks) {
      return
    }
    if (!window.confirm('¿Eliminar esta tarea? Esta acción no se puede deshacer.')) {
      return
    }
    setDeletingTaskId(taskId)
    try {
      await apiRequest(`/tasks/${taskId}`, { method: 'DELETE' })
      setTasks((previous) => previous.filter((task) => task.id !== taskId))
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo eliminar la tarea.'))
    } finally {
      setDeletingTaskId(null)
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

  const handleSendComment = async (taskId: string) => {
    const message = (commentDrafts[taskId] ?? '').trim()
    if (!message) {
      return
    }
    setSendingCommentTaskId(taskId)
    try {
      const updated = await apiRequest<TaskRecord>(`/tasks/${taskId}/comments`, {
        method: 'POST',
        body: { message },
      })
      setTasks((previous) => previous.map((task) => (task.id === updated.id ? updated : task)))
      setCommentDrafts((previous) => ({ ...previous, [taskId]: '' }))
    } catch (error) {
      setAppError(String((error as Error)?.message ?? 'No se pudo enviar el mensaje.'))
    } finally {
      setSendingCommentTaskId(null)
    }
  }

  const handleOpenTaskDetail = (task: TaskRecord) => {
    if (!currentUser || !getTaskAssigneeIds(task).includes(currentUser.id) || task.viewedAt || markingViewedTaskIds.has(task.id)) {
      return
    }
    setMarkingViewedTaskIds((previous) => new Set(previous).add(task.id))
    apiRequest<TaskRecord>(`/tasks/${task.id}/view`, { method: 'POST', body: {} })
      .then((updated) => {
        setTasks((previous) => previous.map((item) => (item.id === updated.id ? updated : item)))
      })
      .catch(() => undefined)
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
      if (typeFilter !== 'ALL' && task.type !== typeFilter) {
        return false
      }
      if (unitFilter !== 'ALL' && !getTaskUnitIds(task).includes(unitFilter)) {
        return false
      }
      if (assigneeFilter !== 'ALL' && !getTaskAssigneeIds(task).includes(assigneeFilter)) {
        return false
      }
      if (workOrderFilter !== 'ALL' && task.workOrderId !== workOrderFilter) {
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
      const units = getTaskUnitIds(task).map((id) => fleetUnitById.get(id)).filter((unit): unit is (typeof fleetUnits)[number] => Boolean(unit))
      const haystack = [
        task.title,
        task.description,
        task.createdByUserName,
        ...(task.assignedToUserNames ?? [task.assignedToUserName]),
        task.assignedToExternalName,
        statusLabelMap[task.status],
        priorityLabelMap[task.priority],
        taskTypeLabelMap[task.type],
        ...units.map((unit) => unit.internalCode),
        ...units.map((unit) => unit.brand),
        ...units.map((unit) => unit.model),
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(query)
    })
  }, [tasks, statusFilter, priorityFilter, typeFilter, unitFilter, assigneeFilter, workOrderFilter, bankFilter, searchTerm, fleetUnitById])

  const bankTasks = useMemo(
    () => filteredTasks.filter((task) => task.isInTaskBank && getTaskAssigneeIds(task).length === 0),
    [filteredTasks],
  )
  const assignedTasks = useMemo(() => filteredTasks.filter((task) => !task.isInTaskBank), [filteredTasks])

  // Separado en 3 apartados en vez de una sola lista mezclada: asignadas
  // (todavia sin arrancar), en curso (incluye bloqueadas) y finalizadas
  // (terminadas o canceladas) -- pedido explicito para no mezclar todo.
  const pendingAssignedTasks = useMemo(() => assignedTasks.filter((task) => task.status === 'ASSIGNED'), [assignedTasks])
  const inProgressTasks = useMemo(
    () => assignedTasks.filter((task) => task.status === 'IN_PROGRESS' || task.status === 'BLOCKED'),
    [assignedTasks],
  )
  const finishedTasks = useMemo(
    () => assignedTasks.filter((task) => task.status === 'DONE' || task.status === 'CANCELED'),
    [assignedTasks],
  )

  const currentUserCanTake = currentUser?.role === 'AUDITOR' || currentUser?.role === 'MECANICO'

  const renderTaskCard = (task: TaskRecord) => {
    const taskAssigneeIds = getTaskAssigneeIds(task)
    const taskUnitIds = getTaskUnitIds(task)
    const taskUnits = taskUnitIds.map((id) => fleetUnitById.get(id)).filter((unit): unit is (typeof fleetUnits)[number] => Boolean(unit))
    const linkedWorkOrder = task.workOrderId ? workOrderById.get(task.workOrderId) : undefined
    const assigneeNames = task.assignedToUserNames && task.assignedToUserNames.length > 0 ? task.assignedToUserNames : task.assignedToUserName ? [task.assignedToUserName] : []
    const canEditThisTask = isManager || (currentUser?.id && taskAssigneeIds.includes(currentUser.id) && can('TASKS', 'edit'))
    const canCommentOnTask =
      isManager ||
      Boolean(
        currentUser?.id &&
          (taskAssigneeIds.includes(currentUser.id) ||
            task.assignedByUserId === currentUser.id ||
            task.createdByUserId === currentUser.id),
      )
    const overdue = isTaskOverdue(task)
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
              <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                {taskTypeLabelMap[task.type]}
              </span>
              {taskUnits.map((unit) => (
                <span
                  key={unit.id}
                  className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                >
                  {unit.internalCode}
                </span>
              ))}
              {task.workOrderId ? (
                <Link
                  to={`${ROUTE_PATHS.workOrders}?search=${encodeURIComponent(linkedWorkOrder?.code ?? '')}`}
                  className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700 hover:bg-violet-100"
                >
                  OT: {linkedWorkOrder?.code ?? task.workOrderId}
                </Link>
              ) : null}
              {overdue ? (
                <span className="rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-700">
                  Vencida
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900">{task.title || 'Tarea sin titulo'}</p>
            <p className="mt-1 text-sm text-slate-600">{task.description}</p>
            <p className="mt-2 text-xs text-slate-500">
              Asignada a{' '}
              {assigneeNames.length > 0
                ? assigneeNames.join(', ')
                : task.assignedToExternalName
                  ? `${task.assignedToExternalName} (externo)`
                  : 'Sin asignar'}{' '}
              | Creada por {task.createdByUserName || task.createdByUserId}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Inicio: {formatDateOnly(task.startDate || task.createdAt)} | Fin aprox.:{' '}
              {formatDateOnly(task.estimatedFinishDate)}
            </p>
            {task.assignedAt ? (
              <p className="mt-1 text-xs font-semibold text-slate-600">
                {typeof task.durationMinutes === 'number'
                  ? `Tiempo de ejecucion: ${formatDurationMinutes(task.durationMinutes)}`
                  : `En curso desde ${formatDateTime(task.assignedAt)}`}
              </p>
            ) : null}
            {taskAssigneeIds.length > 0 && isTaskAdmin ? (
              <p className="mt-1 text-xs">
                {task.viewedAt ? (
                  <span className="font-semibold text-emerald-700">
                    Vista por {task.viewedByUserName || task.assignedToUserName} el {formatDateTime(task.viewedAt)}
                  </span>
                ) : (
                  <span className="font-semibold text-amber-700">Todavia no la vio el asignado</span>
                )}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => downloadTaskPdf(task)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Descargar PDF
            </button>
            {isManager ? (
              <button
                type="button"
                onClick={() => startEdit(task.id)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
              >
                Editar
              </button>
            ) : null}
            {canDeleteTasks ? (
              <button
                type="button"
                onClick={() => handleDeleteTask(task.id)}
                disabled={deletingTaskId === task.id}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
              >
                {deletingTaskId === task.id ? 'Eliminando...' : 'Eliminar'}
              </button>
            ) : null}
          </div>
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

        <details
          className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-2"
          onToggle={(event) => {
            if (event.currentTarget.open) {
              handleOpenTaskDetail(task)
            }
          }}
        >
          <summary className="cursor-pointer text-xs font-semibold text-slate-700">
            Historico y mensajes ({task.events.length})
          </summary>
          <div className="mt-2 space-y-2">
            {task.events.length === 0 ? (
              <p className="text-xs text-slate-500">Sin eventos registrados.</p>
            ) : (
              [...task.events]
                .sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())
                .map((event) =>
                  event.type === 'COMMENT' ? (
                    <div
                      key={event.id}
                      className="rounded-md border border-sky-200 bg-sky-50 px-2 py-2 text-xs text-slate-700"
                    >
                      <p className="font-semibold text-sky-800">{event.actorName || event.actorUserId}</p>
                      <p className="mt-0.5 whitespace-pre-wrap">{event.notes}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{formatDateTime(event.createdAt)}</p>
                    </div>
                  ) : (
                    <div
                      key={event.id}
                      className="rounded-md border border-slate-200 bg-white px-2 py-2 text-xs text-slate-600"
                    >
                      <p className="font-semibold text-slate-800">
                        {taskEventTypeLabelMap[event.type] ?? event.type} | {event.actorName || event.actorUserId}
                      </p>
                      <p>{formatDateTime(event.createdAt)}</p>
                      {event.fromStatus || event.toStatus ? (
                        <p>
                          Estado: {event.fromStatus ? statusLabelMap[event.fromStatus] : '-'} {'->'}{' '}
                          {event.toStatus ? statusLabelMap[event.toStatus] : '-'}
                        </p>
                      ) : null}
                    </div>
                  ),
                )
            )}
          </div>

          {canCommentOnTask ? (
            <div className="mt-3 flex flex-col gap-2 border-t border-slate-200 pt-2">
              <textarea
                rows={2}
                value={commentDrafts[task.id] ?? ''}
                onChange={(event) =>
                  setCommentDrafts((previous) => ({ ...previous, [task.id]: event.target.value }))
                }
                placeholder="Escribir un mensaje o aclaracion..."
                className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-400"
              />
              <button
                type="button"
                onClick={() => handleSendComment(task.id)}
                disabled={sendingCommentTaskId === task.id || !(commentDrafts[task.id] ?? '').trim()}
                className="self-end rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
              >
                {sendingCommentTaskId === task.id ? 'Enviando...' : 'Enviar mensaje'}
              </button>
            </div>
          ) : null}
        </details>
      </div>
    )
  }

  const renderTaskSection = (key: string, title: string, subtitle: string, sectionTasks: TaskRecord[]) => {
    const isExpanded = expandedTaskSections[key] ?? false
    const visibleTasks = isExpanded ? sectionTasks : sectionTasks.slice(0, TASKS_PAGE_SIZE)
    return (
      <article className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">{title}</h3>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">
            {sectionTasks.length}
          </span>
        </div>

        <div className="mt-3 space-y-3">
          {isLoading ? (
            <p className="text-sm text-slate-500">Cargando tareas...</p>
          ) : sectionTasks.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500">
              No hay tareas para el filtro seleccionado.
            </p>
          ) : (
            <>
              {visibleTasks.map(renderTaskCard)}
              {sectionTasks.length > TASKS_PAGE_SIZE ? (
                <button
                  type="button"
                  onClick={() => setExpandedTaskSections((previous) => ({ ...previous, [key]: !isExpanded }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  {isExpanded ? 'Ver menos' : `Ver todas (${sectionTasks.length})`}
                </button>
              ) : null}
            </>
          )}
        </div>
      </article>
    )
  }

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

              <div className="mt-4 grid gap-3 md:grid-cols-3">
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

                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Tipo de tarea
                  <select
                    value={formData.type}
                    onChange={(event) => handleFormChange('type', event.target.value as TaskType)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    {(Object.keys(taskTypeLabelMap) as TaskType[]).map((type) => (
                      <option key={type} value={type}>
                        {taskTypeLabelMap[type]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Unidades relacionadas (opcional, se pueden elegir varias)
                {selectedFormUnits.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {selectedFormUnits.map((unit) => (
                      <span
                        key={unit.id}
                        className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800"
                      >
                        {unit.internalCode} · {unit.brand} {unit.model}
                        <button
                          type="button"
                          onClick={() => removeFormUnit(unit.id)}
                          className="font-semibold text-amber-700 hover:underline"
                        >
                          Quitar
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}
                <input
                  value={unitSearch}
                  onChange={(event) => setUnitSearch(event.target.value)}
                  placeholder="Buscar por dominio, marca o modelo..."
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {filteredFormUnits.map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => addFormUnit(unit.id)}
                      className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                    >
                      {unit.internalCode} · {unit.brand} {unit.model}
                    </button>
                  ))}
                  {filteredFormUnits.length === 0 ? (
                    <p className="px-1 text-xs text-slate-400">Sin resultados.</p>
                  ) : null}
                </div>
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Orden de trabajo vinculada (opcional)
                <select
                  value={formData.workOrderId}
                  onChange={(event) => handleFormChange('workOrderId', event.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                >
                  <option value="">Sin OT vinculada</option>
                  {workOrders.map((order) => (
                    <option key={order.id} value={order.id}>
                      {order.code}
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Fecha de inicio
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(event) => handleFormChange('startDate', event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  />
                </label>

                <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                  Fecha aprox. de finalizacion
                  <input
                    type="date"
                    value={formData.estimatedFinishDate}
                    onChange={(event) => handleFormChange('estimatedFinishDate', event.target.value)}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  />
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
                Asignar a usuarios del sistema (opcional, se pueden elegir varios)
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
                  {assignableUsers.map((user) => {
                    const isSelected = formData.assignedToUserIds.includes(user.id)
                    return (
                      <button
                        key={user.id}
                        type="button"
                        onClick={() => toggleFormAssignee(user.id)}
                        disabled={formData.isInTaskBank}
                        className={`block w-full rounded-lg border px-3 py-1.5 text-left text-xs disabled:opacity-50 ${
                          isSelected
                            ? 'border-amber-300 bg-amber-50 text-amber-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {isSelected ? '✓ ' : ''}
                        {user.fullName}
                      </button>
                    )
                  })}
                </div>
              </label>

              <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-slate-700">
                O asignar a un tercero sin usuario (opcional)
                <input
                  value={formData.assignedToExternalName}
                  onChange={(event) => {
                    const value = event.target.value
                    setFormData((previous) => ({
                      ...previous,
                      assignedToExternalName: value,
                      assignedToUserIds: value ? [] : previous.assignedToUserIds,
                    }))
                  }}
                  disabled={formData.isInTaskBank || formData.assignedToUserIds.length > 0}
                  placeholder="Nombre y apellido del contratista/tercero"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                />
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-bold text-slate-900">Listado de tareas</h3>
            <button
              type="button"
              onClick={() => downloadTasksSummaryPdf(filteredTasks)}
              disabled={filteredTasks.length === 0}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50"
            >
              Descargar resumen PDF
            </button>
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-3">
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
              Tipo
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value as 'ALL' | TaskType)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todos</option>
                {(Object.keys(taskTypeLabelMap) as TaskType[]).map((type) => (
                  <option key={type} value={type}>
                    {taskTypeLabelMap[type]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Unidad
              <select
                value={unitFilter}
                onChange={(event) => setUnitFilter(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todas</option>
                {fleetUnits.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.internalCode}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              OT vinculada
              <select
                value={workOrderFilter}
                onChange={(event) => setWorkOrderFilter(event.target.value)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="ALL">Todas</option>
                {workOrders.map((order) => (
                  <option key={order.id} value={order.id}>
                    {order.code}
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
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                          {taskTypeLabelMap[task.type]}
                        </span>
                        {getTaskUnitIds(task).map((unitId) => {
                          const unit = fleetUnitById.get(unitId)
                          return unit ? (
                            <span
                              key={unitId}
                              className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700"
                            >
                              {unit.internalCode}
                            </span>
                          ) : null
                        })}
                      </div>
                      <p className="mt-2 text-sm font-semibold text-slate-900">{task.title || 'Tarea sin titulo'}</p>
                      <p className="mt-1 text-sm text-slate-600">{task.description}</p>
                      <p className="mt-2 text-xs text-slate-500">
                        Creada por {task.createdByUserName || task.createdByUserId} | {formatDateTime(task.createdAt)}
                      </p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {currentUserCanTake ? (
                          <button
                            type="button"
                            onClick={() => handleTakeFromBank(task.id)}
                            className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                          >
                            Tomar tarea
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => downloadTaskPdf(task)}
                          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                        >
                          Descargar PDF
                        </button>
                        {canDeleteTasks ? (
                          <button
                            type="button"
                            onClick={() => handleDeleteTask(task.id)}
                            disabled={deletingTaskId === task.id}
                            className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100 disabled:opacity-50"
                          >
                            {deletingTaskId === task.id ? 'Eliminando...' : 'Eliminar'}
                          </button>
                        ) : null}
                      </div>

                      {isManager ? (
                        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-amber-300 bg-amber-50/40 p-2">
                          <p className="text-xs font-semibold text-slate-600">Asignar</p>
                          <select
                            value={getAssignDraft(task.id).userId}
                            onChange={(event) => setAssignDraftUserId(task.id, event.target.value)}
                            disabled={Boolean(getAssignDraft(task.id).externalName)}
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                          >
                            <option value="">Seleccionar usuario...</option>
                            {assignableUsers.map((user) => (
                              <option key={user.id} value={user.id}>
                                {user.fullName}
                              </option>
                            ))}
                          </select>
                          <input
                            value={getAssignDraft(task.id).externalName}
                            onChange={(event) => setAssignDraftExternalName(task.id, event.target.value)}
                            disabled={Boolean(getAssignDraft(task.id).userId)}
                            placeholder="...o tercero sin usuario"
                            className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                          />
                          <button
                            type="button"
                            onClick={() => handleAssignBankTask(task.id)}
                            disabled={assigningTaskId === task.id}
                            className="w-full rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
                          >
                            {assigningTaskId === task.id ? 'Asignando...' : 'Asignar'}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            </article>

            {renderTaskSection('pending', 'Asignadas', 'Aceptadas, todavia sin arrancar.', pendingAssignedTasks)}
            {renderTaskSection('inProgress', 'En curso', 'En progreso o bloqueadas.', inProgressTasks)}
            {renderTaskSection('finished', 'Finalizadas', 'Terminadas o canceladas.', finishedTasks)}
          </div>
        </section>
      </div>
    </section>
  )
}
