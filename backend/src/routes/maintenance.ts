import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import { maintenanceTypeValues, notifyMaintenanceStatus } from '../services/maintenancePlans.js'

const router = Router()

const maintenanceSchema = z.object({
  id: z.string().uuid().optional(),
  unitId: z.string().min(1),
  maintenanceType: z.enum(maintenanceTypeValues).optional().default('MOTOR'),
  currentKilometers: z.number().int().nonnegative(),
  currentHours: z.number().int().nonnegative(),
  serviceIntervalKilometers: z.number().int().positive().nullable().optional(),
  serviceIntervalHours: z.number().int().positive().nullable().optional(),
  nextServiceByKilometers: z.number().int().nonnegative(),
  nextServiceByHours: z.number().int().nonnegative(),
  oils: z.array(z.string()).optional().default([]),
  filters: z.array(z.string()).optional().default([]),
  notes: z.string().optional().default(''),
  status: z.enum(['OVERDUE', 'OK', 'DUE_SOON']),
  serviceSchedule: z.record(z.string(), z.any()).optional().default({}),
})

const maintenanceUpdateSchema = maintenanceSchema.partial()

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
    void notifyMaintenanceStatus(plan.unitId, plan.maintenanceType, plan.status)
    return res.status(201).json(plan)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear el plan.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = maintenanceUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const existing = await prisma.maintenancePlan.findUnique({ where: { id: req.params.id }, select: { status: true } })
    const plan = await prisma.maintenancePlan.update({
      where: { id: req.params.id },
      data: {
        ...parsed.data,
        serviceSchedule: parsed.data.serviceSchedule !== undefined ? (parsed.data.serviceSchedule as any) : undefined,
      },
    })
    if (plan.status !== existing?.status) {
      void notifyMaintenanceStatus(plan.unitId, plan.maintenanceType, plan.status)
    }
    return res.json(plan)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El plan de mantenimiento no existe.' })
    }
    console.error('MaintenancePlan PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el plan.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.maintenancePlan.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El plan de mantenimiento no existe.' })
    }
    console.error('MaintenancePlan DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el plan.' })
  }
})

export default router
