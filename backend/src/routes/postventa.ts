import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest as AuthRequest } from '../middleware/auth.js'

const router = Router()

const eventInclude = {
  unit: { select: { internalCode: true, brand: true, model: true } },
  createdBy: { select: { fullName: true } },
}

const mapEvent = (e: any) => ({
  id: e.id,
  title: e.title,
  startDate: e.startDate.toISOString().split('T')[0],
  endDate: e.endDate ? e.endDate.toISOString().split('T')[0] : null,
  notes: e.notes,
  unitId: e.unitId,
  unitLabel: e.unit ? `${e.unit.brand} ${e.unit.model} — ${e.unit.internalCode}` : null,
  externalVehicle: e.externalVehicle,
  workOrderId: e.workOrderId,
  color: e.color,
  createdByUserId: e.createdByUserId,
  createdByUserName: e.createdBy?.fullName ?? '',
  createdAt: e.createdAt.toISOString(),
  updatedAt: e.updatedAt.toISOString(),
})

const createSchema = z.object({
  title: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  notes: z.string().optional().default(''),
  unitId: z.string().nullable().optional(),
  externalVehicle: z.string().nullable().optional(),
  workOrderId: z.string().nullable().optional(),
  color: z.string().optional().default('amber'),
})

const updateSchema = createSchema.partial()

// GET /postventa?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', async (req, res) => {
  try {
    const from = req.query.from as string | undefined
    const to = req.query.to as string | undefined
    const where: any = {}
    if (from && to) {
      where.startDate = { lte: new Date(`${to}T23:59:59.999Z`) }
      where.OR = [
        { endDate: { gte: new Date(`${from}T00:00:00.000Z`) } },
        { endDate: null, startDate: { gte: new Date(`${from}T00:00:00.000Z`) } },
      ]
    }
    const events = await prisma.postventaEvent.findMany({
      where,
      include: eventInclude,
      orderBy: { startDate: 'asc' },
    })
    res.json(events.map(mapEvent))
  } catch (err) {
    console.error('Postventa GET error:', err)
    res.status(500).json({ message: 'Error al obtener eventos' })
  }
})

// POST /postventa
router.post('/', async (req: AuthRequest, res) => {
  const parsed = createSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const data = parsed.data
  try {
    const event = await prisma.postventaEvent.create({
      data: {
        title: data.title,
        startDate: new Date(`${data.startDate}T12:00:00.000Z`),
        endDate: data.endDate ? new Date(`${data.endDate}T12:00:00.000Z`) : null,
        notes: data.notes ?? '',
        unitId: data.unitId ?? null,
        externalVehicle: data.externalVehicle ?? null,
        workOrderId: data.workOrderId ?? null,
        color: data.color ?? 'amber',
        createdByUserId: req.userId!,
      },
      include: eventInclude,
    })
    res.status(201).json(mapEvent(event))
  } catch (err) {
    console.error('Postventa POST error:', err)
    res.status(500).json({ message: 'Error al crear evento' })
  }
})

// PATCH /postventa/:id
router.patch('/:id', async (req: AuthRequest, res) => {
  const id = String(req.params.id)
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ message: 'Datos inválidos' })
  const data = parsed.data
  try {
    const event = await prisma.postventaEvent.update({
      where: { id },
      data: {
        ...(data.title !== undefined && { title: data.title }),
        ...(data.startDate !== undefined && { startDate: new Date(`${data.startDate}T12:00:00.000Z`) }),
        ...(data.endDate !== undefined && { endDate: data.endDate ? new Date(`${data.endDate}T12:00:00.000Z`) : null }),
        ...(data.notes !== undefined && { notes: data.notes }),
        ...(data.unitId !== undefined && { unitId: data.unitId ?? null }),
        ...(data.externalVehicle !== undefined && { externalVehicle: data.externalVehicle ?? null }),
        ...(data.workOrderId !== undefined && { workOrderId: data.workOrderId ?? null }),
        ...(data.color !== undefined && { color: data.color }),
      },
      include: eventInclude,
    })
    res.json(mapEvent(event))
  } catch (err) {
    console.error('Postventa PATCH error:', err)
    res.status(500).json({ message: 'Error al actualizar evento' })
  }
})

// DELETE /postventa/:id
router.delete('/:id', async (req, res) => {
  const id = String(req.params.id)
  try {
    await prisma.postventaEvent.delete({ where: { id } })
    res.status(204).end()
  } catch (err) {
    console.error('Postventa DELETE error:', err)
    res.status(500).json({ message: 'Error al eliminar evento' })
  }
})

export default router
