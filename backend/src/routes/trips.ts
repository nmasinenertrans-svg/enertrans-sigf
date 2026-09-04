import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'
import { calculateRouteDistanceKm } from '../services/routing.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Modulo en construccion/prueba: solo DEV mientras se termina de validar,
// igual que contratos, checklists, cubiertas e importacion de reparaciones.
router.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }
  const requester = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
  if (!requester || requester.role !== 'DEV') {
    return res.status(403).json({ message: 'Modulo en prueba, disponible solo para DEV por ahora.' })
  }
  return next()
})

const geoPointSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
})

const legSchema = z
  .object({
    label: z.string().optional().default(''),
    unitId: z.string().nullable().optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    originLabel: z.string().optional().default(''),
    origin: geoPointSchema,
    destinationLabel: z.string().optional().default(''),
    destination: geoPointSchema,
  })
  .refine((data) => new Date(data.endDate).getTime() >= new Date(data.startDate).getTime(), {
    message: 'La fecha de fin de un tramo no puede ser anterior a la de inicio.',
    path: ['endDate'],
  })

const tripCreateSchema = z
  .object({
    driverUserId: z.string().nullable().optional(),
    driverExternalName: z.string().optional().default(''),
    notes: z.string().optional().default(''),
    legs: z.array(legSchema).min(1, 'Agregá al menos un tramo (ida).'),
  })
  .refine((data) => Boolean(data.driverUserId) || Boolean(data.driverExternalName.trim()), {
    message: 'Elegi un chofer del sistema o escribi el nombre.',
    path: ['driverExternalName'],
  })

const tripUpdateSchema = z.object({
  driverUserId: z.string().nullable().optional(),
  driverExternalName: z.string().optional(),
  notes: z.string().optional(),
  legs: z.array(legSchema).min(1, 'Agregá al menos un tramo (ida).').optional(),
})

const defaultLegLabel = (index: number): string => {
  if (index === 0) return 'Ida'
  if (index === 1) return 'Vuelta'
  return `Tramo ${index + 1}`
}

const includeRelations = {
  driver: { select: { id: true, fullName: true } },
  createdBy: { select: { fullName: true } },
  legs: {
    orderBy: { order: 'asc' as const },
    include: { unit: { select: { id: true, internalCode: true, brand: true, model: true } } },
  },
} as const

const mapTrip = (trip: any) => {
  const legs = (trip.legs ?? []).map((leg: any) => ({
    id: leg.id,
    order: leg.order,
    label: leg.label,
    unitId: leg.unitId,
    unitLabel: leg.unit?.internalCode ?? '',
    startDate: leg.startDate.toISOString(),
    endDate: leg.endDate.toISOString(),
    originLabel: leg.originLabel,
    originLat: leg.originLat,
    originLng: leg.originLng,
    destinationLabel: leg.destinationLabel,
    destinationLat: leg.destinationLat,
    destinationLng: leg.destinationLng,
    distanceKm: leg.distanceKm,
    distanceSource: leg.distanceSource,
  }))

  return {
    id: trip.id,
    code: trip.code,
    driverUserId: trip.driverUserId,
    driverName: trip.driver?.fullName ?? '',
    driverExternalName: trip.driverExternalName,
    startDate: trip.startDate.toISOString(),
    endDate: trip.endDate.toISOString(),
    notes: trip.notes,
    totalDistanceKm: Math.round(legs.reduce((sum: number, leg: any) => sum + leg.distanceKm, 0) * 100) / 100,
    legs,
    createdByUserName: trip.createdBy?.fullName ?? '',
    createdAt: trip.createdAt.toISOString(),
    updatedAt: trip.updatedAt.toISOString(),
  }
}

type LegInput = z.infer<typeof legSchema>

const buildLegRows = async (legs: LegInput[]) => {
  const computed = await Promise.all(
    legs.map(async (leg) => {
      const { distanceKm, source } = await calculateRouteDistanceKm(leg.origin, leg.destination)
      return { leg, distanceKm, source }
    }),
  )

  return computed.map(({ leg, distanceKm, source }, index) => ({
    order: index + 1,
    label: leg.label.trim() || defaultLegLabel(index),
    unitId: leg.unitId || null,
    startDate: new Date(leg.startDate),
    endDate: new Date(leg.endDate),
    originLabel: leg.originLabel.trim(),
    originLat: leg.origin.lat,
    originLng: leg.origin.lng,
    destinationLabel: leg.destinationLabel.trim(),
    destinationLat: leg.destination.lat,
    destinationLng: leg.destination.lng,
    distanceKm,
    distanceSource: source,
  }))
}

const tripDateRange = (legRows: { startDate: Date; endDate: Date }[]) => ({
  startDate: new Date(Math.min(...legRows.map((leg) => leg.startDate.getTime()))),
  endDate: new Date(Math.max(...legRows.map((leg) => leg.endDate.getTime()))),
})

router.get('/', async (req, res) => {
  try {
    const { driverUserId } = req.query
    const where: Record<string, unknown> = {}
    if (typeof driverUserId === 'string' && driverUserId) {
      where.driverUserId = driverUserId
    }
    const items = await prisma.trip.findMany({
      where,
      orderBy: { startDate: 'desc' },
      include: includeRelations,
    })
    return res.json(items.map(mapTrip))
  } catch (error) {
    console.error('Trips GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los viajes.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  const parsed = tripCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Datos invalidos.' })
  }

  try {
    const legRows = await buildLegRows(parsed.data.legs)
    const { startDate, endDate } = tripDateRange(legRows)
    const code = formatCode('VIA', await getNextSequence('trip'))

    const item = await prisma.trip.create({
      data: {
        code,
        driverUserId: parsed.data.driverUserId || null,
        driverExternalName: parsed.data.driverUserId ? '' : parsed.data.driverExternalName.trim(),
        notes: parsed.data.notes.trim(),
        startDate,
        endDate,
        createdByUserId: req.userId,
        legs: { create: legRows },
      },
      include: includeRelations,
    })
    return res.status(201).json(mapTrip(item))
  } catch (error) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Chofer o unidad invalida.' })
    }
    console.error('Trips POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el viaje.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = tripUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: parsed.error.issues[0]?.message ?? 'Datos invalidos.' })
  }

  try {
    const current = await prisma.trip.findUnique({ where: { id: req.params.id } })
    if (!current) {
      return res.status(404).json({ message: 'El viaje no existe.' })
    }

    const data: Record<string, unknown> = {}
    if (parsed.data.driverUserId !== undefined) {
      data.driverUserId = parsed.data.driverUserId || null
      if (parsed.data.driverUserId) {
        data.driverExternalName = ''
      }
    }
    if (parsed.data.driverExternalName !== undefined && !data.driverUserId) {
      data.driverExternalName = parsed.data.driverExternalName.trim()
    }
    if (parsed.data.notes !== undefined) {
      data.notes = parsed.data.notes.trim()
    }

    const item = await prisma.$transaction(async (tx) => {
      if (parsed.data.legs) {
        const legRows = await buildLegRows(parsed.data.legs!)
        const { startDate, endDate } = tripDateRange(legRows)
        data.startDate = startDate
        data.endDate = endDate
        await tx.tripLeg.deleteMany({ where: { tripId: current.id } })
        await tx.trip.update({
          where: { id: current.id },
          data: { ...data, legs: { create: legRows } },
        })
      } else {
        await tx.trip.update({ where: { id: current.id }, data })
      }

      return tx.trip.findUniqueOrThrow({ where: { id: current.id }, include: includeRelations })
    })

    return res.json(mapTrip(item))
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El viaje no existe.' })
    }
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Chofer o unidad invalida.' })
    }
    console.error('Trips PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el viaje.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.tripLeg.deleteMany({ where: { tripId: req.params.id } })
      await tx.trip.delete({ where: { id: req.params.id } })
    })
    return res.status(204).send()
  } catch (error) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'El viaje no existe.' })
    }
    console.error('Trips DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el viaje.' })
  }
})

export default router
