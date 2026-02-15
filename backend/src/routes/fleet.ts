import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'

const router = Router()

const isMissingOrExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return true
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date.getTime() < new Date().setHours(0, 0, 0, 0)
}

const hasInvalidDocuments = (documents: any): boolean => {
  if (!documents) {
    return true
  }
  return (
    isMissingOrExpired(documents?.rto?.expiresAt) ||
    isMissingOrExpired(documents?.insurance?.expiresAt) ||
    isMissingOrExpired(documents?.hoist?.expiresAt)
  )
}

type FleetOperationalStatus = 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE'

const deriveOperationalStatus = (requested: FleetOperationalStatus, documents: any): FleetOperationalStatus =>
  hasInvalidDocuments(documents) ? 'OUT_OF_SERVICE' : requested

const fleetSchema = z.object({
  id: z.string().uuid().optional(),
  qrId: z.string().min(1),
  internalCode: z.string().min(1),
  brand: z.string().optional().default(''),
  model: z.string().optional().default(''),
  year: z.number().int().optional().default(0),
  clientName: z.string().optional().default(''),
  location: z.string().optional().default(''),
  ownerCompany: z.string().min(1),
  operationalStatus: z.enum(['OPERATIONAL', 'MAINTENANCE', 'OUT_OF_SERVICE']),
  unitType: z.enum([
    'CHASSIS',
    'CHASSIS_WITH_HYDROCRANE',
    'TRACTOR',
    'TRACTOR_WITH_HYDROCRANE',
    'SEMI_TRAILER',
    'AUTOMOBILE',
    'VAN',
  ]),
  configurationNotes: z.string().optional().default(''),
  chassisNumber: z.string().min(1),
  engineNumber: z.string().optional().default(''),
  tareWeightKg: z.number().int().nonnegative(),
  maxLoadKg: z.number().int().nonnegative(),
  hasHydroCrane: z.boolean(),
  hydroCraneBrand: z.string().optional().default(''),
  hydroCraneModel: z.string().optional().default(''),
  hydroCraneSerialNumber: z.string().optional().default(''),
  hasSemiTrailer: z.boolean(),
  semiTrailerUnitId: z.string().nullable().optional(),
  semiTrailerLicensePlate: z.string().optional().default(''),
  semiTrailerBrand: z.string().optional().default(''),
  semiTrailerModel: z.string().optional().default(''),
  semiTrailerYear: z.number().int().optional().default(0),
  semiTrailerChassisNumber: z.string().optional().default(''),
  tractorHistoryIds: z.array(z.string()).optional().default([]),
  currentKilometers: z.number().int().nonnegative().optional().default(0),
  currentEngineHours: z.number().int().nonnegative().optional().default(0),
  currentHydroHours: z.number().int().nonnegative().optional().default(0),
  lubricants: z.any().optional().default({}),
  filters: z.any().optional().default({}),
  documents: z.any().optional().default({}),
})

router.get('/', async (_req, res) => {
  const units = await prisma.fleetUnit.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(units)
})

router.get('/:id', async (req, res) => {
  const unit = await prisma.fleetUnit.findUnique({ where: { id: req.params.id } })
  if (!unit) {
    return res.status(404).json({ message: 'Unidad no encontrada.' })
  }
  return res.json(unit)
})

router.post('/', async (req, res) => {
  const parsed = fleetSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const operationalStatus = deriveOperationalStatus(
      parsed.data.operationalStatus as FleetOperationalStatus,
      parsed.data.documents,
    )
    const unit = await prisma.fleetUnit.create({ data: { ...parsed.data, operationalStatus } })
    return res.status(201).json(unit)
  } catch (error: any) {
    console.error('Fleet POST error:', error)
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Unidad duplicada.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la unidad.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = fleetSchema.partial().safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const current = await prisma.fleetUnit.findUnique({ where: { id: req.params.id } })
    if (!current) {
      if (parsed.data.id && parsed.data.qrId) {
        const operationalStatus = deriveOperationalStatus(
          (parsed.data.operationalStatus ?? 'OPERATIONAL') as FleetOperationalStatus,
          parsed.data.documents ?? {},
        )
        const created = await prisma.fleetUnit.create({
          data: { ...parsed.data, operationalStatus } as any,
        })
        return res.status(201).json(created)
      }
      return res.status(404).json({ message: 'Unidad no encontrada.' })
    }
    const nextDocuments = parsed.data.documents ?? current.documents
    const requestedStatus = (parsed.data.operationalStatus ?? current.operationalStatus) as FleetOperationalStatus
    const operationalStatus = deriveOperationalStatus(requestedStatus, nextDocuments)
    const unit = await prisma.fleetUnit.update({
      where: { id: req.params.id },
      data: { ...parsed.data, documents: nextDocuments, operationalStatus },
    })
    return res.json(unit)
  } catch (error: any) {
    console.error('Fleet PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la unidad.' })
  }
})

router.delete('/:id', async (req, res) => {
  await prisma.fleetUnit.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
