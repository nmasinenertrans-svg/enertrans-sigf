import { Router } from 'express'
import { TaskEventType, TaskPriority, TaskStatus, UserRole } from '@prisma/client'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const taskStatusValues = ['UNASSIGNED', 'ASSIGNED', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELED'] as const
const taskPriorityValues = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const

const createTaskSchema = z.object({
  title: z.string().optional().default(''),
  description: z.string().min(1),
  status: z.enum(taskStatusValues).optional().default('UNASSIGNED'),
  priority: z.enum(taskPriorityValues).optional().default('MEDIUM'),
  assignedToUserId: z.string().uuid().nullable().optional(),
  isInTaskBank: z.boolean().optional().default(false),
})

const updateTaskSchema = z.object({
  title: z.string().optional(),
  description: z.string().min(1).optional(),
  status: z.enum(taskStatusValues).optional(),
  priority: z.enum(taskPriorityValues).optional(),
  assignedToUserId: z.string().uuid().nullable().optional(),
  isInTaskBank: z.boolean().optional(),
})

const takeTaskSchema = z.object({
  status: z.enum(taskStatusValues).optional().default('ASSIGNED'),
})

const managerRoles = new Set<UserRole>(['DEV', 'GERENTE'])
const bankTakerRoles = new Set<UserRole>(['AUDITOR', 'MECANICO'])

const isManagerRole = (role: UserRole) => managerRoles.has(role)
const canTakeFromBankRole = (role: UserRole) => bankTakerRoles.has(role)

const getAuthenticatedUser = async (req: AuthenticatedRequest) => {
  if (!req.userId) {
    return null
  }
  return prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, role: true, fullName: true },
  })
}

const mapTask = (task: any) => ({
  id: task.id,
  title: task.title ?? '',
  description: task.description ?? '',
  status: task.status,
  priority: task.priority,
  assignedToUserId: task.assignedToUserId ?? null,
  assignedToUserName: task.assignedTo?.fullName ?? '',
  assignedByUserId: task.assignedByUserId ?? null,
  createdByUserId: task.createdByUserId,
  createdByUserName: task.createdBy?.fullName ?? '',
  isInTaskBank: Boolean(task.isInTaskBank),
  createdAt: task.createdAt?.toISOString?.() ?? task.createdAt,
  updatedAt: task.updatedAt?.toISOString?.() ?? task.updatedAt,
  closedAt: task.closedAt ? (task.closedAt.toISOString?.() ?? task.closedAt) : null,
  events: Array.isArray(task.events)
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
    : [],
})

const includeTaskRelations = {
  assignedTo: { select: { id: true, fullName: true } },
  assignedBy: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
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

  if ((previous.assignedToUserId ?? null) !== (next.assignedToUserId ?? null)) {
    events.push({
      type: next.assignedToUserId ? TaskEventType.ASSIGNED : TaskEventType.UNASSIGNED,
      actorUserId,
      fromAssignedToUserId: previous.assignedToUserId ?? null,
      toAssignedToUserId: next.assignedToUserId ?? null,
      notes: '',
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

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.task.findMany({
      orderBy: [{ isInTaskBank: 'desc' }, { updatedAt: 'desc' }],
      include: includeTaskRelations,
    })
    return res.json(items.map(mapTask))
  } catch (error) {
    console.error('Tasks GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las tareas.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const actor = await getAuthenticatedUser(req)
  if (!actor) {
    return res.status(401).json({ message: 'No autorizado.' })
  }
  if (!isManagerRole(actor.role)) {
    return res.status(403).json({ message: 'Solo DEV o GERENTE pueden crear/asignar tareas.' })
  }

  const requestedAssignedTo = parsed.data.assignedToUserId ?? null
  const assignedExists = requestedAssignedTo
    ? await prisma.user.findUnique({ where: { id: requestedAssignedTo }, select: { id: true } })
    : null
  const shouldGoToBank = parsed.data.isInTaskBank
  const assignedToUserId = shouldGoToBank ? null : assignedExists?.id ?? null
  const assignedByUserId = assignedToUserId ? actor.id : null
  const status =
    shouldGoToBank
      ? TaskStatus.UNASSIGNED
      : assignedToUserId && parsed.data.status === 'UNASSIGNED'
        ? TaskStatus.ASSIGNED
        : (parsed.data.status as TaskStatus)
  const closedAt = status === TaskStatus.DONE ? new Date() : null

  try {
    const task = await prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: parsed.data.title.trim(),
          description: parsed.data.description.trim(),
          status,
          priority: parsed.data.priority as TaskPriority,
          assignedToUserId,
          assignedByUserId,
          createdByUserId: actor.id,
          isInTaskBank: shouldGoToBank,
          closedAt,
        },
      })

      await tx.taskEvent.create({
        data: {
          taskId: created.id,
          type: TaskEventType.CREATED,
          actorUserId: actor.id,
          toStatus: status,
          toAssignedToUserId: assignedToUserId,
          notes: '',
        },
      })

      if (assignedToUserId) {
        await tx.taskEvent.create({
          data: {
            taskId: created.id,
            type: TaskEventType.ASSIGNED,
            actorUserId: actor.id,
            toAssignedToUserId: assignedToUserId,
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

    return res.status(201).json(mapTask(task))
  } catch (error) {
    console.error('Tasks POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la tarea.' })
  }
})

router.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateTaskSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
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

    const isManager = isManagerRole(actor.role)
    const isSelfAssigned = current.assignedToUserId === actor.id

    if (!isManager) {
      const onlyStatusPatch = Object.keys(patchData).every((key) => key === 'status')
      if (!isSelfAssigned || !onlyStatusPatch) {
        return res.status(403).json({ message: 'No tenes permisos para editar esta tarea.' })
      }
    }

    const nextTitle = patchData.title !== undefined ? patchData.title.trim() : current.title
    const nextDescription = patchData.description !== undefined ? patchData.description.trim() : current.description
    let nextAssignedToUserId =
      patchData.assignedToUserId !== undefined ? (patchData.assignedToUserId ?? null) : (current.assignedToUserId ?? null)
    let nextAssignedByUserId = current.assignedByUserId
    let nextIsInTaskBank = patchData.isInTaskBank !== undefined ? patchData.isInTaskBank : current.isInTaskBank
    let nextStatus = (patchData.status ?? current.status) as TaskStatus
    const nextPriority = (patchData.priority ?? current.priority) as TaskPriority

    if (isManager && nextAssignedToUserId) {
      const assignedUser = await prisma.user.findUnique({ where: { id: nextAssignedToUserId }, select: { id: true } })
      nextAssignedToUserId = assignedUser?.id ?? null
    }

    if (!isManager) {
      nextAssignedToUserId = current.assignedToUserId
      nextIsInTaskBank = current.isInTaskBank
    }

    if (nextIsInTaskBank) {
      nextAssignedToUserId = null
      nextAssignedByUserId = null
      nextStatus = TaskStatus.UNASSIGNED
    } else if (nextAssignedToUserId && nextStatus === TaskStatus.UNASSIGNED) {
      nextStatus = TaskStatus.ASSIGNED
      if (isManager) {
        nextAssignedByUserId = actor.id
      }
    } else if (!nextAssignedToUserId && nextStatus === TaskStatus.ASSIGNED) {
      nextStatus = TaskStatus.UNASSIGNED
      nextAssignedByUserId = null
    } else if (isManager && patchData.assignedToUserId !== undefined) {
      nextAssignedByUserId = nextAssignedToUserId ? actor.id : null
    }

    const closedAt = nextStatus === TaskStatus.DONE ? (current.closedAt ?? new Date()) : null

    const task = await prisma.$transaction(async (tx) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          title: nextTitle,
          description: nextDescription,
          status: nextStatus,
          priority: nextPriority,
          assignedToUserId: nextAssignedToUserId,
          assignedByUserId: nextAssignedByUserId,
          isInTaskBank: nextIsInTaskBank,
          closedAt,
        },
      })

      const events = buildTaskEventsFromDiff({
        actorUserId: actor.id,
        previous: current,
        next: {
          status: nextStatus,
          assignedToUserId: nextAssignedToUserId,
          isInTaskBank: nextIsInTaskBank,
        },
      })

      const changedTextOrPriority =
        current.title !== nextTitle ||
        current.description !== nextDescription ||
        current.priority !== nextPriority

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

    return res.json(mapTask(task))
  } catch (error) {
    console.error('Tasks PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la tarea.' })
  }
})

router.post('/:id/take', async (req: AuthenticatedRequest, res) => {
  const parsed = takeTaskSchema.safeParse(req.body ?? {})
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
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
      if (!current.isInTaskBank || current.assignedToUserId) {
        throw new Error('TASK_NOT_AVAILABLE')
      }

      const nextStatus = parsed.data.status === 'UNASSIGNED' ? TaskStatus.ASSIGNED : (parsed.data.status as TaskStatus)
      const updated = await tx.task.update({
        where: { id: current.id },
        data: {
          assignedToUserId: actor.id,
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

    return res.json(mapTask(task))
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

export default router
