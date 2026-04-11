import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'

const router = Router()

const maintenanceSchema = z.object({
  id: z.string().uuid().optional(),
  unitId: z.string().min(1),
  currentKilometers: z.number().int().nonnegative(),
  currentHours: z.number().int().nonnegative(),
  nextServiceByKilometers: z.number().int().nonnegative(),
  nextServiceByHours: z.number().int().nonnegative(),
  oils: z.array(z.string()).optional().default([]),
  filters: z.array(z.string()).optional().default([]),
  notes: z.string().optional().default(''),
  status: z.enum(['OVERDUE', 'OK', 'DUE_SOON']),
  serviceSchedule: z.record(z.string(), z.any()).optional().default({}),
})

router.get('/', async (_req, res) => {
  const plans = await prisma.maintenancePlan.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(plans)
})

router.post('/', async (req, res) => {
  const parsed = maintenanceSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const plan = await prisma.maintenancePlan.create({
      data: {
        ...parsed.data,
        serviceSchedule: parsed.data.serviceSchedule as any,
      },
    })
    return res.status(201).json(plan)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear el plan.' })
  }
})

export default router
