import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const projectTypes = [
  'HYDROCRANE_CHANGE',
  'THIRD_AXLE',
  'BOX_EXTENSION',
  'BODY_MODIFICATION',
  'ENGINE_OVERHAUL',
  'TRANSMISSION',
  'SUSPENSION',
  'ELECTRICAL',
  'BRAKE_SYSTEM',
  'OTHER',
] as const

const projectStatuses = ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELED'] as const
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
const itemStatuses = ['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED'] as const

const createProjectSchema = z.object({
  title: z.string().min(1),
  projectTypes: z.array(z.enum(projectTypes)).min(1),
  status: z.enum(projectStatuses).optional().default('PENDING'),
  priority: z.enum(priorities).optional().default('MEDIUM'),
  unitId: z.string().min(1),
  description: z.string().optional().default(''),
  estimatedCost: z.number().nonnegative().optional().default(0),
  actualCost: z.number().nonnegative().optional().default(0),
  currency: z.string().optional().default('ARS'),
  externalRequestId: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  modificationNotes: z.string().optional().default(''),
})

const updateProjectSchema = z.object({
  title: z.string().min(1).optional(),
  projectTypes: z.array(z.enum(projectTypes)).min(1).optional(),
  status: z.enum(projectStatuses).optional(),
  priority: z.enum(priorities).optional(),
  unitId: z.string().min(1).optional(),
  description: z.string().optional(),
  estimatedCost: z.number().nonnegative().optional(),
  actualCost: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  externalRequestId: z.string().nullable().optional(),
  targetDate: z.string().nullable().optional(),
  modificationNotes: z.string().optional(),
})

const createItemSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().default(''),
  status: z.enum(itemStatuses).optional().default('PENDING'),
  assignedToUserId: z.string().nullable().optional(),
})

const updateItemSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  status: z.enum(itemStatuses).optional(),
  assignedToUserId: z.string().nullable().optional(),
})

const itemInclude = {
  assignedTo: { select: { id: true, fullName: true } },
} as const

const projectInclude = {
  unit: { select: { id: true, internalCode: true, brand: true, model: true } },
  createdBy: { select: { id: true, fullName: true } },
  items: {
    orderBy: { createdAt: 'asc' as const },
    include: itemInclude,
  },
} as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapItem = (item: any) => ({
  id: item.id as string,
  projectId: item.projectId as string,
  title: item.title as string,
  description: (item.description as string) ?? '',
  status: item.status as string,
  assignedToUserId: (item.assignedToUserId as string | null) ?? null,
  assignedToUserName: (item.assignedTo?.fullName as string) ?? '',
  completedAt: item.completedAt ? (item.completedAt as Date).toISOString() : null,
  createdAt: (item.createdAt as Date).toISOString(),
  updatedAt: (item.updatedAt as Date).toISOString(),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mapProject = (p: any) => ({
  id: p.id as string,
  title: p.title as string,
  projectTypes: Array.isArray(p.projectTypes) ? (p.projectTypes as string[]) : [],
  status: p.status as string,
  priority: p.priority as string,
  unitId: p.unitId as string,
  unitInternalCode: (p.unit?.internalCode as string) ?? '',
  unitLabel: p.unit ? `${p.unit.brand as string} ${p.unit.model as string} — ${p.unit.internalCode as string}` : '',
  description: (p.description as string) ?? '',
  estimatedCost: (p.estimatedCost as number) ?? 0,
  actualCost: (p.actualCost as number) ?? 0,
  currency: (p.currency as string) ?? 'ARS',
  externalRequestId: (p.externalRequestId as string | null) ?? null,
  createdByUserId: p.createdByUserId as string,
  createdByUserName: (p.createdBy?.fullName as string) ?? '',
  targetDate: p.targetDate ? (p.targetDate as Date).toISOString() : null,
  startedAt: p.startedAt ? (p.startedAt as Date).toISOString() : null,
  completedAt: p.completedAt ? (p.completedAt as Date).toISOString() : null,
  modificationNotes: (p.modificationNotes as string) ?? '',
  linkedWorkOrderIds: Array.isArray(p.linkedWorkOrderIds) ? (p.linkedWorkOrderIds as string[]) : [],
  linkedExternalRequestIds: Array.isArray(p.linkedExternalRequestIds) ? (p.linkedExternalRequestIds as string[]) : [],
  createdAt: (p.createdAt as Date).toISOString(),
  updatedAt: (p.updatedAt as Date).toISOString(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: Array.isArray(p.items) ? p.items.map((i: any) => mapItem(i)) : [],
})

// GET /projects
router.get('/', async (_req, res) => {
  try {
    const projects = await prisma.fleetProject.findMany({
      orderBy: [{ createdAt: 'desc' }],
      include: projectInclude,
    })
    return res.json(projects.map(mapProject))
  } catch (error) {
    console.error('Projects GET error:', error)
    return res.status(500).json({ message: 'Error al obtener proyectos' })
  }
})

// GET /projects/:id
router.get('/:id', async (req, res) => {
  try {
    const project = await prisma.fleetProject.findUnique({
      where: { id: String(req.params.id) },
      include: projectInclude,
    })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })
    return res.json(mapProject(project))
  } catch (error) {
    console.error('Projects GET/:id error:', error)
    return res.status(500).json({ message: 'Error al obtener proyecto' })
  }
})

// POST /projects
router.post('/', async (req: AuthenticatedRequest, res) => {
  const parsed = createProjectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const actorId = req.userId
  if (!actorId) return res.status(401).json({ message: 'No autenticado' })

  const { targetDate, ...rest } = parsed.data

  try {
    const project = await prisma.fleetProject.create({
      data: {
        ...rest,
        createdByUserId: actorId,
        targetDate: targetDate ? new Date(targetDate) : null,
        startedAt: rest.status === 'IN_PROGRESS' ? new Date() : null,
        completedAt: rest.status === 'COMPLETED' ? new Date() : null,
      },
      include: projectInclude,
    })
    return res.status(201).json(mapProject(project))
  } catch (error) {
    console.error('Projects POST error:', error)
    return res.status(500).json({ message: 'Error al crear proyecto' })
  }
})

// PATCH /projects/:id
router.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const parsed = updateProjectSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const { targetDate, status, ...rest } = parsed.data

  try {
    const paramId = String(req.params.id)
    const current = await prisma.fleetProject.findUnique({ where: { id: paramId } })
    if (!current) return res.status(404).json({ message: 'Proyecto no encontrado' })

    const startedAt =
      status === 'IN_PROGRESS' && !current.startedAt ? new Date() : undefined
    const completedAt =
      status === 'COMPLETED' && !current.completedAt
        ? new Date()
        : status && status !== 'COMPLETED' && current.completedAt
          ? null
          : undefined

    const project = await prisma.fleetProject.update({
      where: { id: paramId },
      data: {
        ...rest,
        ...(status !== undefined && { status }),
        ...(targetDate !== undefined && { targetDate: targetDate ? new Date(targetDate) : null }),
        ...(startedAt !== undefined && { startedAt }),
        ...(completedAt !== undefined && { completedAt }),
        updatedAt: new Date(),
      },
      include: projectInclude,
    })
    return res.json(mapProject(project))
  } catch (error) {
    console.error('Projects PATCH error:', error)
    return res.status(500).json({ message: 'Error al actualizar proyecto' })
  }
})

// DELETE /projects/:id
router.delete('/:id', async (_req, res) => {
  try {
    const paramId = String(_req.params.id)
    await prisma.fleetProjectItem.deleteMany({ where: { projectId: paramId } })
    await prisma.fleetProject.delete({ where: { id: paramId } })
    return res.status(204).send()
  } catch (error) {
    console.error('Projects DELETE error:', error)
    return res.status(500).json({ message: 'Error al eliminar proyecto' })
  }
})

// POST /projects/:projectId/items
router.post('/:projectId/items', async (req: AuthenticatedRequest, res) => {
  const parsed = createItemSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const { assignedToUserId, ...rest } = parsed.data

  const resolvedAssignedTo = assignedToUserId
    ? ((await prisma.user.findUnique({ where: { id: assignedToUserId }, select: { id: true } }))?.id ?? null)
    : null

  try {
    const projectId = String(req.params.projectId)
    const project = await prisma.fleetProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })

    await prisma.fleetProjectItem.create({
      data: {
        ...rest,
        projectId,
        assignedToUserId: resolvedAssignedTo,
        completedAt: rest.status === 'DONE' ? new Date() : null,
      },
    })

    const updated = await prisma.fleetProject.findUniqueOrThrow({
      where: { id: projectId },
      include: projectInclude,
    })
    return res.status(201).json(mapProject(updated))
  } catch (error) {
    console.error('Projects items POST error:', error)
    return res.status(500).json({ message: 'Error al agregar tarea' })
  }
})

// PATCH /projects/:projectId/items/:itemId
router.patch('/:projectId/items/:itemId', async (req, res) => {
  const parsed = updateItemSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })

  const { assignedToUserId, status, ...rest } = parsed.data

  try {
    const itemId = String(req.params.itemId)
    const projectId = String(req.params.projectId)
    const current = await prisma.fleetProjectItem.findUnique({ where: { id: itemId } })
    if (!current) return res.status(404).json({ message: 'Tarea no encontrada' })

    const resolvedAssignedTo =
      assignedToUserId !== undefined
        ? assignedToUserId
          ? ((await prisma.user.findUnique({ where: { id: assignedToUserId }, select: { id: true } }))?.id ?? null)
          : null
        : undefined

    const completedAt =
      status === 'DONE' && !current.completedAt
        ? new Date()
        : status && status !== 'DONE' && current.completedAt
          ? null
          : undefined

    await prisma.fleetProjectItem.update({
      where: { id: itemId },
      data: {
        ...rest,
        ...(status !== undefined && { status }),
        ...(resolvedAssignedTo !== undefined && { assignedToUserId: resolvedAssignedTo }),
        ...(completedAt !== undefined && { completedAt }),
        updatedAt: new Date(),
      },
    })

    const updated = await prisma.fleetProject.findUniqueOrThrow({
      where: { id: projectId },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects items PATCH error:', error)
    return res.status(500).json({ message: 'Error al actualizar tarea' })
  }
})

// DELETE /projects/:projectId/items/:itemId
router.delete('/:projectId/items/:itemId', async (req, res) => {
  try {
    const itemId = String(req.params.itemId)
    const projectId = String(req.params.projectId)
    await prisma.fleetProjectItem.delete({ where: { id: itemId } })
    const updated = await prisma.fleetProject.findUniqueOrThrow({
      where: { id: projectId },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects items DELETE error:', error)
    return res.status(500).json({ message: 'Error al eliminar tarea' })
  }
})

// POST /projects/:id/work-orders/:woId — link
router.post('/:id/work-orders/:woId', async (req, res) => {
  try {
    const projectId = String(req.params.id)
    const woId = String(req.params.woId)
    const project = await prisma.fleetProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })
    const current = Array.isArray(project.linkedWorkOrderIds) ? (project.linkedWorkOrderIds as string[]) : []
    const updated = await prisma.fleetProject.update({
      where: { id: projectId },
      data: { linkedWorkOrderIds: current.includes(woId) ? current : [...current, woId], updatedAt: new Date() },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects link WO error:', error)
    return res.status(500).json({ message: 'Error al vincular orden de trabajo' })
  }
})

// DELETE /projects/:id/work-orders/:woId — unlink
router.delete('/:id/work-orders/:woId', async (req, res) => {
  try {
    const projectId = String(req.params.id)
    const woId = String(req.params.woId)
    const project = await prisma.fleetProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })
    const current = Array.isArray(project.linkedWorkOrderIds) ? (project.linkedWorkOrderIds as string[]) : []
    const updated = await prisma.fleetProject.update({
      where: { id: projectId },
      data: { linkedWorkOrderIds: current.filter((id) => id !== woId), updatedAt: new Date() },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects unlink WO error:', error)
    return res.status(500).json({ message: 'Error al desvincular orden de trabajo' })
  }
})

// POST /projects/:id/external-requests/:erId — link
router.post('/:id/external-requests/:erId', async (req, res) => {
  try {
    const projectId = String(req.params.id)
    const erId = String(req.params.erId)
    const project = await prisma.fleetProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })
    const current = Array.isArray(project.linkedExternalRequestIds) ? (project.linkedExternalRequestIds as string[]) : []
    const updated = await prisma.fleetProject.update({
      where: { id: projectId },
      data: { linkedExternalRequestIds: current.includes(erId) ? current : [...current, erId], updatedAt: new Date() },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects link NDP error:', error)
    return res.status(500).json({ message: 'Error al vincular nota de pedido' })
  }
})

// DELETE /projects/:id/external-requests/:erId — unlink
router.delete('/:id/external-requests/:erId', async (req, res) => {
  try {
    const projectId = String(req.params.id)
    const erId = String(req.params.erId)
    const project = await prisma.fleetProject.findUnique({ where: { id: projectId } })
    if (!project) return res.status(404).json({ message: 'Proyecto no encontrado' })
    const current = Array.isArray(project.linkedExternalRequestIds) ? (project.linkedExternalRequestIds as string[]) : []
    const updated = await prisma.fleetProject.update({
      where: { id: projectId },
      data: { linkedExternalRequestIds: current.filter((id) => id !== erId), updatedAt: new Date() },
      include: projectInclude,
    })
    return res.json(mapProject(updated))
  } catch (error) {
    console.error('Projects unlink NDP error:', error)
    return res.status(500).json({ message: 'Error al desvincular nota de pedido' })
  }
})

export default router
