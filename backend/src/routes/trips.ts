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

const tripCreateSchema = z
  .object({
    driverUserId: z.string().nullable().optional(),
    driverExternalName: z.string().optional().default(''),
    unitId: z.string().nullable().optional(),
    startDate: z.string().datetime(),
    endDate: z.string().datetime(),
    originLabel: z.string().optional().default(''),
    origin: geoPointSchema,
    destinationLabel: z.string().optional().default(''),
    destination: geoPointSchema,
    notes: z.string().optional().default(''),
  })
  .refine((data) => Boolean(data.driverUserId) || Boolean(data.driverExternalName.trim()), {
    message: 'Elegi un chofer del sistema o escribi el nombre.',
    path: ['driverExternalName'],
  })
  .refine((data) => new Date(data.endDate).getTime() >= new Date(data.startDate).getTime(), {
    message: 'La fecha de fin no puede ser anterior a la de inicio.',
    path: ['endDate'],
  })

const tripUpdateSchema = z.object({
  driverUserId: z.string().nullable().optional(),
  driverExternalName: z.string().optional(),
  unitId: z.string().nullable().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  originLabel: z.string().optional(),
  origin: geoPointSchema.optional(),
  destinationLabel: z.string().optional(),
  destination: geoPointSchema.optional(),
  notes: z.string().optional(),
})

const includeRelations = {
  driver: { select: { id: true, fullName: true } },
  unit: { select: { id: true, internalCode: true, brand: true, model: true } },
  createdBy: { select: { fullName: true } },
} as const

const mapTrip = (trip: any) => ({
  id: trip.id,
  code: trip.code,
  driverUserId: trip.driverUserId,
  driverName: trip.driver?.fullName ?? '',
  driverExternalName: trip.driverExternalName,
  unitId: trip.unitId,
  unitLabel: trip.unit?.internalCode ?? '',
  startDate: trip.startDate.toISOString(),
  endDate: trip.endDate.toISOString(),
  originLabel: trip.originLabel,
  originLat: trip.originLat,
  originLng: trip.originLng,
  destinationLabel: trip.destinationLabel,
  destinationLat: trip.destinationLat,
  destinationLng: trip.destinationLng,
  distanceKm: trip.distanceKm,
  distanceSource: trip.distanceSource,
  notes: trip.notes,
  createdByUserName: trip.createdBy?.fullName ?? '',
  createdAt: trip.createdAt.toISOString(),
  updatedAt: trip.updatedAt.toISOString(),
})

router.get('/', async (req, res) => {
  try {
    const { driverUserId, unitId } = req.query
    const where: Record<string, unknown> = {}
    if (typeof driverUserId === 'string' && driverUserId) {
      where.driverUserId = driverUserId
    }
    if (typeof unitId === 'string' && unitId) {
      where.unitId = unitId
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
    const { distanceKm, source } = await calculateRouteDistanceKm(parsed.data.origin, parsed.data.destination)
    const code = formatCode('VIA', await getNextSequence('trip'))

    const item = await prisma.trip.create({
      data: {
        code,
        driverUserId: parsed.data.driverUserId || null,
        driverExternalName: parsed.data.driverUserId ? '' : parsed.data.driverExternalName.trim(),
        unitId: parsed.data.unitId || null,
        startDate: new Date(parsed.data.startDate),
        endDate: new Date(parsed.data.endDate),
        originLabel: parsed.data.originLabel.trim(),
        originLat: parsed.data.origin.lat,
        originLng: parsed.data.origin.lng,
        destinationLabel: parsed.data.destinationLabel.trim(),
        destinationLat: parsed.data.destination.lat,
        destinationLng: parsed.data.destination.lng,
        distanceKm,
        distanceSource: source,
        notes: parsed.data.notes.trim(),
        createdByUserId: req.userId,
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
    return res.status(400).json({ message: 'Datos invalidos.' })
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
    if (parsed.data.unitId !== undefined) data.unitId = parsed.data.unitId || null
    if (parsed.data.startDate !== undefined) data.startDate = new Date(parsed.data.startDate)
    if (parsed.data.endDate !== undefined) data.endDate = new Date(parsed.data.endDate)
    if (parsed.data.originLabel !== undefined) data.originLabel = parsed.data.originLabel.trim()
    if (parsed.data.destinationLabel !== undefined) data.destinationLabel = parsed.data.destinationLabel.trim()
    if (parsed.data.notes !== undefined) data.notes = parsed.data.notes.trim()

    const nextOrigin = parsed.data.origin ?? { lat: current.originLat, lng: current.originLng }
    const nextDestination = parsed.data.destination ?? { lat: current.destinationLat, lng: current.destinationLng }
    const originChanged = Boolean(parsed.data.origin)
    const destinationChanged = Boolean(parsed.data.destination)

    if (originChanged) {
      data.originLat = nextOrigin.lat
      data.originLng = nextOrigin.lng
    }
    if (destinationChanged) {
      data.destinationLat = nextDestination.lat
      data.destinationLng = nextDestination.lng
    }

    if (originChanged || destinationChanged) {
      const { distanceKm, source } = await calculateRouteDistanceKm(nextOrigin, nextDestination)
      data.distanceKm = distanceKm
      data.distanceSource = source
    }

    const item = await prisma.trip.update({
      where: { id: req.params.id },
      data,
      include: includeRelations,
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
    await prisma.trip.delete({ where: { id: req.params.id } })
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
