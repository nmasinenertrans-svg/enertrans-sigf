import { Router } from 'express'
import { TaskEventType, TaskPriority, TaskStatus, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { sendPushToUser } from '../services/webPush.js'
import { pushUserNotifications } from '../services/userNotifications.js'

const router = Router()

const taskStatusValues = ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED'] as const
const taskPriorityValues = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const taskTypeValues = [
  'REVISION_CHECKLIST',
  'RTO',
  'ENTREGA',
  'RETIRO_DEVOLUCION',
  'REPARACION',
  'MANTENIMIENTO',
  'ADMINISTRATIVA',
  'OTRA',
] as const

const createTaskSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().optional().default(''),
  description: z.string().min(1),
  status: z.enum(taskStatusValues).optional().default('UNASSIGNED'),
  priority: z.enum(taskPriorityValues).optional().default('MEDIUM'),
  type: z.enum(taskTypeValues).optional().default('OTRA'),
  unitId: z.string().nullable().optional(),
  unitIds: z.array(z.string()).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  assignedToUserIds: z.array(z.string().uuid()).optional(),
  assignedToExternalName: z.string().max(120).optional().default(''),
  isInTaskBank: z.boolean().optional().default(false),
  startDate: z.string().nullable().optional(),
  estimatedFinishDate: z.string().nullable().optional(),
})

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().min(1).optional(),
  status: z.enum(taskStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  type: z.enum(taskTypeValues).optional(),
  unitId: z.string().nullable().optional(),
  unitIds: z.array(z.string()).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  assignedToUserIds: z.array(z.string().uuid()).optional(),
  assignedToExternalName: z.string().max(120).optional(),
  isInTaskBank: z.boolean().optional(),
  startDate: z.string().nullable().optional(),
  estimatedFinishDate: z.string().nullable().optional(),
})

// Unifica el campo viejo (singular) con el nuevo (array): si viene el array
// se usa tal cual, si no se arma un array de 0 o 1 elemento con el singular
// -- asi conviven tareas viejas (un solo asignado/unidad) con las nuevas
// (multiples) sin duplicar logica en cada lugar que lee esto.
const normalizeIdArray = (arrayValue: unknown, singularValue: string | null | undefined): string[] => {
  if (Array.isArray(arrayValue)) {
    const cleaned = arrayValue.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    if (cleaned.length > 0) {
      return Array.from(new Set(cleaned))
    }
  }
  return singularValue ? [singularValue] : []
}

const parseOptionalDate = (value: string | null | undefined): Date | null => {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

const takeTaskSchema = z.object({
  status: z.enum(taskStatusValues).optional().default('ASSIGNED'),
})

const commentSchema = z.object({
  message: z.string().trim().min(1).max(2000),
})

const managerRoles = new Set<UserRole>(['DEV', 'GERENTE'])
const bankTakerRoles = new Set<UserRole>(['AUDITOR', 'MECANICO'])
const taskDeleteAllowedUsernames = new Set(['nmasin', 'rbottero'])
const taskFullVisibilityUsernames = new Set(['rbottero', 'nmasin', 'emoreno', 'crivas', 'mpinto'])

const isManagerRole = (role: UserRole) => managerRoles.has(role)
const canTakeFromBankRole = (role: UserRole) => bankTakerRoles.has(role)
const canDeleteTasks = (username: string) => taskDeleteAllowedUsernames.has(username.trim().toLowerCase())
const hasFullTaskVisibility = (username: string) => taskFullVisibilityUsernames.has(username.trim().toLowerCase())

const canAccessTask = (
  actor: { id: string; role: UserRole },
  task: {
    assignedToUserId: string | null
    assignedToUserIds?: unknown
    assignedByUserId: string | null
    createdByUserId: string
  },
): boolean =>
  isManagerRole(actor.role) ||
  normalizeIdArray(task.assignedToUserIds, task.assignedToUserId).includes(actor.id) ||
  task.assignedByUserId === actor.id ||
  task.createdByUserId === actor.id

const normalizeExternalName = (value: string | null | undefined): string => (value ?? '').trim().replace(/\s+/g, ' ')

const getAuthenticatedUser = async (req: AuthenticatedRequest) => {
  if (!req.userId) {
    return null
  }
  return prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, role: true, fullName: true, username: true },
  })
}

// Cuanto tardo la tarea desde que se asigno hasta que se termino. No hay
// columna propia para esto -- se calcula del historial de eventos (primera
// vez que entro en ASSIGNED, ultima vez que llego a DONE), asi que sigue
// siendo correcto aunque la tarea se haya reabierto y vuelto a cerrar.
const computeTaskDuration = (events: Array<{ toStatus: string | null; createdAt: string }>) => {
  const sorted = [...events].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
  const assignedEvent = sorted.find((event) => event.toStatus === 'ASSIGNED')
  const finishedEvents = sorted.filter((event) => event.toStatus === 'DONE')
  const finishedEvent = finishedEvents[finishedEvents.length - 1]
  const assignedAt = assignedEvent?.createdAt ?? null
  const finishedAt = finishedEvent?.createdAt ?? null
  let durationMinutes: number | null = null
  if (assignedAt && finishedAt) {
    const delta = new Date(finishedAt).getTime() - new Date(assignedAt).getTime()
    if (delta >= 0) {
      durationMinutes = Math.round(delta / 60000)
    }
  }
  return { assignedAt, finishedAt, durationMinutes }
}

const mapTask = (
  task: any,
  userNameById: Map<string, string> = new Map(),
  unitCodeById: Map<string, string> = new Map(),
) => {
  const events = Array.isArray(task.events)
    ? task.events.map((event: any) => ({
        id: event.id,
        taskId: event.taskId,
        type: event.type,
        actorUserId: event.actorUserId,
        actorName: event.actor?.fullName ?? '',
        notes: event.notes ?? '',
        fromStatus: event.fromStatus ?? '',
        toStatus: event.toStatus ?? '',
        fromAssignedToUserId: event.fromAssignedToUserId ?? null,
        toAssignedToUserId: event.toAssignedToUserId ?? null,
        createdAt: event.createdAt?.toISOString?.() ?? event.createdAt,
      }))
    : []
  const { assignedAt, finishedAt, durationMinutes } = computeTaskDuration(events)

  const assignedToUserIds = normalizeIdArray(task.assignedToUserIds, task.assignedToUserId ?? null)
  const unitIds = normalizeIdArray(task.unitIds, task.unitId ?? null)
  const assignedToUserNames = assignedToUserIds.map((id) => userNameById.get(id) ?? task.assignedTo?.fullName ?? '')
  const unitLabels = unitIds.map((id) => unitCodeById.get(id) ?? '')

  return {
    id: task.id,
    title: task.title ?? '',
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    type: task.type ?? 'OTRA',
    unitId: unitIds[0] ?? null,
    unitIds,
    unitLabels,
    assignedToUserId: assignedToUserIds[0] ?? null,
    assignedToUserIds,
    assignedToUserName: assignedToUserNames[0] ?? '',
    assignedToUserNames,
    assignedToExternalName: task.assignedToExternalName ?? '',
    assignedByUserId: task.assignedByUserId ?? null,
    createdByUserId: task.createdByUserId,
    createdByUserName: task.createdBy?.fullName ?? '',
    isInTaskBank: Boolean(task.isInTaskBank),
    startDate: task.startDate ? (task.startDate.toISOString?.() ?? task.startDate) : null,
    estimatedFinishDate: task.estimatedFinishDate ? (task.estimatedFinishDate.toISOString?.() ?? task.estimatedFinishDate) : null,
    createdAt: task.createdAt?.toISOString?.() ?? task.createdAt,
    updatedAt: task.updatedAt?.toISOString?.() ?? task.updatedAt,
    closedAt: task.closedAt ? (task.closedAt.toISOString?.() ?? task.closedAt) : null,
    viewedAt: task.viewedAt ? (task.viewedAt.toISOString?.() ?? task.viewedAt) : null,
    viewedByUserId: task.viewedByUserId ?? null,
    viewedByUserName: task.viewedBy?.fullName ?? '',
    assignedAt,
    finishedAt,
    durationMinutes,
    events,
  }
}

// Trae nombres de usuarios/codigos de unidad para una tanda de tareas de una
// sola vez (en vez de una consulta por tarea) para armar assignedToUserNames/
// unitLabels en mapTask.
const buildTaskLabelMaps = async (tasks: Array<{ assignedToUserIds: unknown; assignedToUserId: string | null; unitIds: unknown; unitId: string | null }>) => {
  const userIds = new Set<string>()
  const unitIds = new Set<string>()
  tasks.forEach((task) => {
    normalizeIdArray(task.assignedToUserIds, task.assignedToUserId).forEach((id) => userIds.add(id))
    normalizeIdArray(task.unitIds, task.unitId).forEach((id) => unitIds.add(id))
  })

  const [users, units] = await Promise.all([
    userIds.size > 0
      ? prisma.user.findMany({ where: { id: { in: Array.from(userIds) } }, select: { id: true, fullName: true } })
      : Promise.resolve([]),
    unitIds.size > 0
      ? prisma.fleetUnit.findMany({ where: { id: { in: Array.from(unitIds) } }, select: { id: true, internalCode: true } })
      : Promise.resolve([]),
  ])

  return {
    userNameById: new Map(users.map((user) => [user.id, user.fullName])),
    unitCodeById: new Map(units.map((unit) => [unit.id, unit.internalCode])),
  }
}

const includeTaskRelations = {
  assignedTo: { select: { id: true, fullName: true } },
  assignedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  viewedBy: { select: { id: true, fullName: true } },
  events: {
    orderBy: { createdAt: 'desc' as const },
    include: { actor: { select: { id: true, fullName: true } } },
  },
}

const buildTaskEventsFromDiff = (params: {
  actorUserId: string
  previous: any
  next: {
    status: TaskStatus
    assignedToUserId: string | null
    assignedToExternalName: string
    isInTaskBank: boolean
  }
}) => {
  const { actorUserId, previous, next } = params
  const events: any[] = []

  if (!previous) {
    return events
  }

  if (previous.status !== next.status) {
    events.push({
      type: TaskEventType.STATUS_CHANGED,
      actorUserId,
      fromStatus: previous.status,
      toStatus: next.status,
      notes: '',
    })
  }

  const previousExternalName = previous.assignedToExternalName ?? ''
  if (
    (previous.assignedToUserId ?? null) !== (next.assignedToUserId ?? null) ||
    previousExternalName !== next.assignedToExternalName
  ) {
    const isNowAssigned = Boolean(next.assignedToUserId) || Boolean(next.assignedToExternalName)
    events.push({
      type: isNowAssigned ? TaskEventType.ASSIGNED : TaskEventType.UNASSIGNED,
      actorUserId,
      fromAssignedToUserId: previous.assignedToUserId ?? null,
      toAssignedToUserId: next.assignedToUserId ?? null,
      notes: next.assignedToExternalName
        ? `Asignado a: ${next.assignedToExternalName} (externo)`
        : previousExternalName
          ? `Se quito la asignacion externa: ${previousExternalName}`
          : '',
    })
  }

  if (Boolean(previous.isInTaskBank) !== Boolean(next.isInTaskBank)) {
    events.push({
      type: next.isInTaskBank ? TaskEventType.MOVED_TO_BANK : TaskEventType.REMOVED_FROM_BANK,
      actorUserId,
      notes: '',
    })
  }

  return events
}

router.get('/', async (req: AuthenticatedRequest, res) => {
  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  try {
    const { unitId } = req.query
    const where: Record<string, unknown> = {}
    if (typeof unitId === 'string' && unitId) {
      where.unitId = unitId
    }

    // El filtro de "solo lo mio + banco" no se puede expresar bien contra un
    // array JSON en Prisma/Postgres de forma simple, asi que se trae todo lo
    // que matchea el resto de los filtros y se filtra en memoria -- el
    // volumen de tareas de esta empresa no amerita una consulta SQL mas
    // compleja.
    const candidates = await prisma.task.findMany({
      where,
      orderBy: [{ isInTaskBank: 'desc' }, { updatedAt: 'desc' }],
      include: includeTaskRelations,
    })

    const hasFullVisibility = hasFullTaskVisibility(actor.username)
    const items = hasFullVisibility
      ? candidates
      : candidates.filter(
          (task) => task.isInTaskBank || normalizeIdArray(task.assignedToUserIds, task.assignedToUserId).includes(actor.id),
        )

    // Se marca "vista" automaticamente apenas el asignado consulta su lista de
    // tareas, no hace falta que abra a mano el detalle/historico.
    const idsToMarkViewed = items
      .filter((task) => !task.viewedAt && normalizeIdArray(task.assignedToUserIds, task.assignedToUserId).includes(actor.id))
      .map((task) => task.id)
    if (idsToMarkViewed.length > 0) {
      await prisma.task.updateMany({
        where: { id: { in: idsToMarkViewed } },
        data: { viewedAt: new Date(), viewedByUserId: actor.id },
      })
      idsToMarkViewed.forEach((id) => {
        const task = items.find((item) => item.id === id)
        if (task) {
          task.viewedAt = new Date()
          task.viewedByUserId = actor.id
        }
      })
    }

    const { userNameById, unitCodeById } = await buildTaskLabelMaps(items)
    return res.json(items.map((task) => mapTask(task, userNameById, unitCodeById)))
  } catch (error) {
    console.error('Tasks GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las tareas.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''
    return res.status(400).json({ message: `Datos invalidos.${detail}` })
  }

  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }
  if (!isManagerRole(actor.role)) {
    return res.status(403).json({ message: 'Solo DEV o GERENTE pueden crear/asignar tareas.' })
  }

  // Si viene con id (creada offline y ya sincronizada, o un reintento de la
  // cola tras un corte a mitad de camino) y ya existe, devolvemos la que ya
  // esta en vez de duplicarla.
  if (parsed.data.id) {
    const existing = await prisma.task.findUnique({ where: { id: parsed.data.id }, include: includeTaskRelations })
    if (existing) {
      const { userNameById, unitCodeById } = await buildTaskLabelMaps([existing])
      return res.status(201).json(mapTask(existing, userNameById, unitCodeById))
    }
  }

  const shouldGoToBank = parsed.data.isInTaskBank
  const requestedAssignedToIds = parsed.data.assignedToUserIds ?? (parsed.data.assignedToUserId ? [parsed.data.assignedToUserId] : [])
  const validAssignees = requestedAssignedToIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: requestedAssignedToIds } }, select: { id: true } })
    : []
  const assignedToUserIds = shouldGoToBank ? [] : validAssignees.map((user) => user.id)
  const requestedUnitIds = parsed.data.unitIds ?? (parsed.data.unitId ? [parsed.data.unitId] : [])
  // La asignacion a un tercero externo solo aplica si no hay usuario del sistema asignado.
  const assignedToExternalName =
    shouldGoToBank || assignedToUserIds.length > 0 ? '' : normalizeExternalName(parsed.data.assignedToExternalName)
  const isAssigned = assignedToUserIds.length > 0 || Boolean(assignedToExternalName)
  const assignedByUserId = isAssigned ? actor.id : null
  const status =
    shouldGoToBank
      ? TaskStatus.UNASSIGNED
      : isAssigned && parsed.data.status === 'UNASSIGNED'
        ? TaskStatus.ASSIGNED
        : (parsed.data.status as TaskStatus)
  const closedAt = status === TaskStatus.DONE ? new Date() : null
  const startDate = parseOptionalDate(parsed.data.startDate) ?? new Date()
  const estimatedFinishDate = parseOptionalDate(parsed.data.estimatedFinishDate)

  try {
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          id: parsed.data.id,
          title: parsed.data.title.trim(),
          description: parsed.data.description.trim(),
          status,
          priority: parsed.data.priority as TaskPriority,
          type: parsed.data.type,
          unitId: requestedUnitIds[0] ?? null,
          unitIds: requestedUnitIds,
          assignedToUserId: assignedToUserIds[0] ?? null,
          assignedToUserIds,
          assignedToExternalName,
          assignedByUserId,
          createdByUserId: actor.id,
          isInTaskBank: shouldGoToBank,
          startDate,
          estimatedFinishDate,
          closedAt,
        },
      })

      await tx.taskEvent.create({
        data: {
          taskId: created.id,
          type: TaskEventType.CREATED,
          actorUserId: actor.id,
          toStatus: status,
          toAssignedToUserId: assignedToUserIds[0] ?? null,
          notes: '',
        },
      })

      if (isAssigned) {
        await tx.taskEvent.create({
          data: {
            taskId: created.id,
            type: TaskEventType.ASSIGNED,
            actorUserId: actor.id,
            toAssignedToUserId: assignedToUserIds[0] ?? null,
            notes: assignedToExternalName
              ? `Asignado a: ${assignedToExternalName} (externo)`
              : assignedToUserIds.length > 1
                ? `Asignado a ${assignedToUserIds.length} personas.`
                : '',
          },
        })
      } else if (shouldGoToBank) {
        await tx.taskEvent.create({
          data: {
            taskId: created.id,
            type: TaskEventType.MOVED_TO_BANK,
            actorUserId: actor.id,
          },
        })
      }

      return tx.task.findUniqueOrThrow({
        where: { id: created.id },
        include: includeTaskRelations,
      })
    })

    const taskLabel = parsed.data.title.trim() || parsed.data.description.trim()
    assignedToUserIds.forEach((userId) => {
      void sendPushToUser(userId, {
        title: 'Te asignaron una tarea',
        body: taskLabel,
        url: '/tasks',
        tag: 'task-assigned',
      }).catch(() => undefined)
      void pushUserNotifications([userId], {
        title: 'Te asignaron una tarea',
        description: taskLabel,
        severity: 'info',
        target: '/tasks',
        eventType: 'TASK_ASSIGNED',
        actorUserId: actor.id,
      }).catch(() => undefined)
    })

    const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
    return res.status(201).json(mapTask(task, userNameById, unitCodeById))
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'La unidad vinculada no es valida.' })
    }
    console.error('Tasks POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la tarea.' })
  }
})

router.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''
    return res.status(400).json({ message: `Datos invalidos.${detail}` })
  }

  const rawBody = (req.body ?? {}) as Record<string, unknown>
  const patchData = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) => Object.prototype.hasOwnProperty.call(rawBody, key)),
  ) as Partial<z.infer<typeof updateTaskSchema>>

  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }
  const rawTaskId = req.params.id
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId
  if (!taskId) {
    return res.status(400).json({ message: 'Id de tarea requerido.' })
  }

  try {
    const current = await prisma.task.findUnique({ where: { id: taskId } })
    if (!current) {
      return res.status(404).json({ message: 'Tarea no encontrada.' })
    }

    const currentAssignedToUserIds = normalizeIdArray(current.assignedToUserIds, current.assignedToUserId)
    const currentUnitIds = normalizeIdArray(current.unitIds, current.unitId)
    const isManager = isManagerRole(actor.role)
    const isSelfAssigned = currentAssignedToUserIds.includes(actor.id)

    if (!isManager) {
      const onlyStatusPatch = Object.keys(patchData).every((key) => key === 'status')
      if (!isSelfAssigned || !onlyStatusPatch) {
        return res.status(403).json({ message: 'No tenes permisos para editar esta tarea.' })
      }
    }

    const nextTitle = patchData.title !== undefined ? patchData.title.trim() : current.title
    const nextDescription = patchData.description !== undefined ? patchData.description.trim() : current.description
    let nextAssignedToUserIds =
      patchData.assignedToUserIds !== undefined
        ? patchData.assignedToUserIds
        : patchData.assignedToUserId !== undefined
          ? (patchData.assignedToUserId ? [patchData.assignedToUserId] : [])
          : currentAssignedToUserIds
    let nextAssignedToExternalName =
      patchData.assignedToExternalName !== undefined
        ? normalizeExternalName(patchData.assignedToExternalName)
        : (current.assignedToExternalName ?? '')
    let nextAssignedByUserId = current.assignedByUserId
    let nextIsInTaskBank = patchData.isInTaskBank !== undefined ? patchData.isInTaskBank : current.isInTaskBank
    let nextStatus = (patchData.status ?? current.status) as TaskStatus
    const nextPriority = (patchData.priority ?? current.priority) as TaskPriority
    const nextType = patchData.type ?? current.type
    const nextUnitIds =
      patchData.unitIds !== undefined
        ? patchData.unitIds
        : patchData.unitId !== undefined
          ? (patchData.unitId ? [patchData.unitId] : [])
          : currentUnitIds
    let nextStartDate =
      patchData.startDate !== undefined ? (parseOptionalDate(patchData.startDate) ?? current.startDate) : current.startDate
    let nextEstimatedFinishDate =
      patchData.estimatedFinishDate !== undefined
        ? parseOptionalDate(patchData.estimatedFinishDate)
        : current.estimatedFinishDate

    if (!isManager) {
      nextStartDate = current.startDate
      nextEstimatedFinishDate = current.estimatedFinishDate
    }

    if (isManager && nextAssignedToUserIds.length > 0) {
      const validUsers = await prisma.user.findMany({
        where: { id: { in: nextAssignedToUserIds } },
        select: { id: true },
      })
      nextAssignedToUserIds = validUsers.map((user) => user.id)
    }

    if (!isManager) {
      nextAssignedToUserIds = currentAssignedToUserIds
      nextAssignedToExternalName = current.assignedToExternalName ?? ''
      nextIsInTaskBank = current.isInTaskBank
    }

    // La asignacion a un usuario del sistema y a un tercero externo son mutuamente excluyentes.
    if (nextAssignedToUserIds.length > 0) {
      nextAssignedToExternalName = ''
    }

    const wasAssigned = currentAssignedToUserIds.length > 0 || Boolean(current.assignedToExternalName)
    const willBeAssigned = nextAssignedToUserIds.length > 0 || Boolean(nextAssignedToExternalName)

    if (nextIsInTaskBank) {
      nextAssignedToUserIds = []
      nextAssignedToExternalName = ''
      nextAssignedByUserId = null
      nextStatus = TaskStatus.UNASSIGNED
    } else if (willBeAssigned && !wasAssigned && nextStatus === TaskStatus.UNASSIGNED) {
      nextStatus = TaskStatus.ASSIGNED
      if (isManager) {
        nextAssignedByUserId = actor.id
      }
    } else if (!willBeAssigned && nextStatus === TaskStatus.ASSIGNED) {
      nextStatus = TaskStatus.UNASSIGNED
      nextAssignedByUserId = null
    } else if (
      isManager &&
      (patchData.assignedToUserId !== undefined ||
        patchData.assignedToUserIds !== undefined ||
        patchData.assignedToExternalName !== undefined)
    ) {
      nextAssignedByUserId = willBeAssigned ? actor.id : null
    }

    const closedAt = nextStatus === TaskStatus.DONE ? (current.closedAt ?? new Date()) : null
    // Si cambia quien esta asignado (se agrega o saca gente), el "visto" ya
    // no aplica tal cual — vuelve a quedar pendiente hasta que alguien de la
    // nueva lista la abra.
    const assigneeSetChanged =
      JSON.stringify([...nextAssignedToUserIds].sort()) !== JSON.stringify([...currentAssignedToUserIds].sort())
    const nextViewedAt = assigneeSetChanged ? null : current.viewedAt
    const nextViewedByUserId = assigneeSetChanged ? null : current.viewedByUserId
    const newlyAddedAssigneeIds = nextAssignedToUserIds.filter((id) => !currentAssignedToUserIds.includes(id))

    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          title: nextTitle,
          description: nextDescription,
          status: nextStatus,
          priority: nextPriority,
          type: nextType,
          unitId: nextUnitIds[0] ?? null,
          unitIds: nextUnitIds,
          assignedToUserId: nextAssignedToUserIds[0] ?? null,
          assignedToUserIds: nextAssignedToUserIds,
          assignedToExternalName: nextAssignedToExternalName,
          assignedByUserId: nextAssignedByUserId,
          viewedAt: nextViewedAt,
          viewedByUserId: nextViewedByUserId,
          isInTaskBank: nextIsInTaskBank,
          startDate: nextStartDate,
          estimatedFinishDate: nextEstimatedFinishDate,
          closedAt,
        },
      })

      const events = buildTaskEventsFromDiff({
        actorUserId: actor.id,
        previous: { ...current, assignedToUserId: currentAssignedToUserIds[0] ?? null },
        next: {
          status: nextStatus,
          assignedToUserId: nextAssignedToUserIds[0] ?? null,
          assignedToExternalName: nextAssignedToExternalName,
          isInTaskBank: nextIsInTaskBank,
        },
      })

      const changedTextOrPriority =
        current.title !== nextTitle ||
        current.description !== nextDescription ||
        current.priority !== nextPriority ||
        current.type !== nextType ||
        JSON.stringify([...currentUnitIds].sort()) !== JSON.stringify([...nextUnitIds].sort())

      if (changedTextOrPriority) {
        events.push({
          type: TaskEventType.UPDATED,
          actorUserId: actor.id,
          notes: '',
        })
      }

      if (events.length > 0) {
        await tx.taskEvent.createMany({
          data: events.map((event) => ({
            taskId: updated.id,
            type: event.type,
            actorUserId: event.actorUserId,
            notes: event.notes ?? '',
            fromStatus: event.fromStatus ?? null,
            toStatus: event.toStatus ?? null,
            fromAssignedToUserId: event.fromAssignedToUserId ?? null,
            toAssignedToUserId: event.toAssignedToUserId ?? null,
          })),
        })
      }

      return tx.task.findUniqueOrThrow({
        where: { id: updated.id },
        include: includeTaskRelations,
      })
    })

    const taskLabel = nextTitle || nextDescription
    newlyAddedAssigneeIds.forEach((userId) => {
      void sendPushToUser(userId, {
        title: 'Te asignaron una tarea',
        body: taskLabel,
        url: '/tasks',
        tag: 'task-assigned',
      }).catch(() => undefined)
      void pushUserNotifications([userId], {
        title: 'Te asignaron una tarea',
        description: taskLabel,
        severity: 'info',
        target: '/tasks',
        eventType: 'TASK_ASSIGNED',
        actorUserId: actor.id,
      }).catch(() => undefined)
    })

    const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
    return res.json(mapTask(task, userNameById, unitCodeById))
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'La unidad vinculada no es valida.' })
    }
    console.error('Tasks PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la tarea.' })
  }
})

router.post('/:id/take', async (req: AuthenticatedRequest, res) => {
  const parsed = takeTaskSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const detail = issue ? ` (${issue.path.join('.')}: ${issue.message})` : ''
    return res.status(400).json({ message: `Datos invalidos.${detail}` })
  }

  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  if (!canTakeFromBankRole(actor.role)) {
    return res.status(403).json({ message: 'Solo auditores o mecanicos pueden tomar tareas del banco.' })
  }
  const rawTaskId = req.params.id
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId
  if (!taskId) {
    return res.status(400).json({ message: 'Id de tarea requerido.' })
  }

  try {
    const task = await prisma.$transaction(async (tx) => {
      const current = await tx.task.findUnique({ where: { id: taskId } })
      if (!current) {
        throw new Error('TASK_NOT_FOUND')
      }
      if (!current.isInTaskBank || normalizeIdArray(current.assignedToUserIds, current.assignedToUserId).length > 0) {
        throw new Error('TASK_NOT_AVAILABLE')
      }

      const nextStatus = parsed.data.status === 'UNASSIGNED' ? TaskStatus.ASSIGNED : (parsed.data.status as TaskStatus)
      const updated = await tx.task.update({
        where: { id: current.id },
        data: {
          assignedToUserId: actor.id,
          assignedToUserIds: [actor.id],
          assignedByUserId: null,
          isInTaskBank: false,
          status: nextStatus,
          closedAt: nextStatus === TaskStatus.DONE ? new Date() : null,
        },
      })

      await tx.taskEvent.create({
        data: {
          taskId: updated.id,
          type: TaskEventType.TAKEN_FROM_BANK,
          actorUserId: actor.id,
          fromAssignedToUserId: current.assignedToUserId,
          toAssignedToUserId: actor.id,
          fromStatus: current.status,
          toStatus: nextStatus,
        },
      })

      return tx.task.findUniqueOrThrow({
        where: { id: updated.id },
        include: includeTaskRelations,
      })
    })

    const takerLabel = actor.fullName || actor.username
    const taskLabel = task.title.trim() || task.description.trim()
    const notifyUsers = await prisma.user.findMany({
      where: { username: { in: Array.from(taskFullVisibilityUsernames), mode: 'insensitive' } },
      select: { id: true },
    })
    notifyUsers
      .filter((user) => user.id !== actor.id)
      .forEach((user) => {
        void sendPushToUser(user.id, {
          title: 'Tarea tomada del banco',
          body: `${takerLabel} tomo: ${taskLabel}`,
          url: '/tasks',
          tag: 'task-taken',
        }).catch(() => undefined)
        void pushUserNotifications([user.id], {
          title: 'Tarea tomada del banco',
          description: `${takerLabel} tomo: ${taskLabel}`,
          severity: 'info',
          target: '/tasks',
          eventType: 'TASK_TAKEN_FROM_BANK',
          actorUserId: actor.id,
        }).catch(() => undefined)
      })

    const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
    return res.json(mapTask(task, userNameById, unitCodeById))
  } catch (error) {
    if ((error as Error).message === 'TASK_NOT_FOUND') {
      return res.status(404).json({ message: 'Tarea no encontrada.' })
    }
    if ((error as Error).message === 'TASK_NOT_AVAILABLE') {
      return res.status(409).json({ message: 'La tarea ya no esta disponible en el banco.' })
    }
    console.error('Tasks TAKE error:', error)
    return res.status(500).json({ message: 'No se pudo tomar la tarea.' })
  }
})

router.post('/:id/comments', async (req: AuthenticatedRequest, res) => {
  const parsed = commentSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'El mensaje no puede estar vacio.' })
  }

  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const rawTaskId = req.params.id
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId
  if (!taskId) {
    return res.status(400).json({ message: 'Id de tarea requerido.' })
  }

  try {
    const current = await prisma.task.findUnique({ where: { id: taskId } })
    if (!current) {
      return res.status(404).json({ message: 'Tarea no encontrada.' })
    }
    if (!canAccessTask(actor, current)) {
      return res.status(403).json({ message: 'No tenes permisos para comentar esta tarea.' })
    }

    const task = await prisma.$transaction(async (tx) => {
      await tx.taskEvent.create({
        data: {
          taskId: current.id,
          type: TaskEventType.COMMENT,
          actorUserId: actor.id,
          notes: parsed.data.message,
        },
      })
      return tx.task.findUniqueOrThrow({
        where: { id: current.id },
        include: includeTaskRelations,
      })
    })

    // El chat es de ida y vuelta: si escribe alguno de los asignados le avisa a
    // quien asigno (o creo) la tarea; si escribe el que asigna/gerencia, les
    // avisa a todos los asignados.
    const currentAssigneeIds = normalizeIdArray(current.assignedToUserIds, current.assignedToUserId)
    const isActorAnAssignee = currentAssigneeIds.includes(actor.id)
    const notifyUserIds = isActorAnAssignee
      ? [current.assignedByUserId ?? current.createdByUserId].filter((id): id is string => Boolean(id))
      : currentAssigneeIds

    notifyUserIds
      .filter((userId) => userId !== actor.id)
      .forEach((userId) => {
        void sendPushToUser(userId, {
          title: `Nuevo mensaje de ${actor.fullName}`,
          body: parsed.data.message.slice(0, 140),
          url: '/tasks',
          tag: 'task-comment',
        }).catch(() => undefined)
        void pushUserNotifications([userId], {
          title: `Nuevo mensaje de ${actor.fullName}`,
          description: parsed.data.message.slice(0, 140),
          severity: 'info',
          target: '/tasks',
          eventType: 'TASK_COMMENT',
          actorUserId: actor.id,
        }).catch(() => undefined)
      })

    const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
    return res.status(201).json(mapTask(task, userNameById, unitCodeById))
  } catch (error) {
    console.error('Tasks COMMENT error:', error)
    return res.status(500).json({ message: 'No se pudo enviar el mensaje.' })
  }
})

router.post('/:id/view', async (req: AuthenticatedRequest, res) => {
  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const rawTaskId = req.params.id
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId
  if (!taskId) {
    return res.status(400).json({ message: 'Id de tarea requerido.' })
  }

  try {
    const current = await prisma.task.findUnique({ where: { id: taskId } })
    if (!current) {
      return res.status(404).json({ message: 'Tarea no encontrada.' })
    }
    if (!normalizeIdArray(current.assignedToUserIds, current.assignedToUserId).includes(actor.id)) {
      return res.status(403).json({ message: 'Solo una persona asignada puede marcar la tarea como vista.' })
    }

    if (current.viewedAt) {
      const task = await prisma.task.findUniqueOrThrow({ where: { id: taskId }, include: includeTaskRelations })
      const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
      return res.json(mapTask(task, userNameById, unitCodeById))
    }

    const task = await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: taskId },
        data: { viewedAt: new Date(), viewedByUserId: actor.id },
      })
      await tx.taskEvent.create({
        data: {
          taskId: current.id,
          type: TaskEventType.VIEWED,
          actorUserId: actor.id,
        },
      })
      return tx.task.findUniqueOrThrow({
        where: { id: current.id },
        include: includeTaskRelations,
      })
    })

    const { userNameById, unitCodeById } = await buildTaskLabelMaps([task])
    return res.json(mapTask(task, userNameById, unitCodeById))
  } catch (error) {
    console.error('Tasks VIEW error:', error)
    return res.status(500).json({ message: 'No se pudo marcar la tarea como vista.' })
  }
})

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }
  if (!canDeleteTasks(actor.username)) {
    return res.status(403).json({ message: 'No tenes permisos para eliminar tareas.' })
  }

  const rawTaskId = req.params.id
  const taskId = Array.isArray(rawTaskId) ? rawTaskId[0] : rawTaskId
  if (!taskId) {
    return res.status(400).json({ message: 'Id de tarea requerido.' })
  }

  try {
    await prisma.task.delete({ where: { id: taskId } })
    return res.status(204).send()
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'Tarea no encontrada.' })
    }
    console.error('Tasks DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la tarea.' })
  }
})

export default router
