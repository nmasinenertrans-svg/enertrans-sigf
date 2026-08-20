import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { recalculateMaintenancePlansForUnit } from '../services/maintenancePlans.js'

const router = Router()

const MAX_POSITIONS_PER_REQUEST = 500

const normalizeUnitCode = (value: string): string => value.trim().toUpperCase().replace(/\s+/g, '')

/**
 * Autenticacion de proveedores (RSV, Microtrack, etc.): secreto compartido por
 * header, NO el JWT de usuarios de la app. Si el secreto no esta configurado en
 * el servidor devolvemos 503 (config faltante) en vez de dejar pasar todo o
 * fallar con un 401 enganoso.
 */
const requireGpsWebhookSecret = (req: Request, res: Response, next: NextFunction) => {
  const configuredSecret = process.env.GPS_WEBHOOK_SECRET?.trim()
  if (!configuredSecret) {
    return res.status(503).json({ message: 'GPS_WEBHOOK_SECRET no esta configurado en el servidor.' })
  }

  const provided = req.headers['x-gps-webhook-secret']
  const providedValue = Array.isArray(provided) ? provided[0] : provided
  if (!providedValue || providedValue !== configuredSecret) {
    return res.status(401).json({ message: 'Secreto invalido o faltante.' })
  }

  return next()
}

const positionSchema = z.object({
  deviceExternalId: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  imei: z.string().trim().optional(),
  unitCode: z.string().trim().optional(),
  capturedAt: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  speedKph: z.number().optional(),
  heading: z.number().optional(),
  altitudeM: z.number().optional(),
  accuracyM: z.number().optional(),
  rawPayload: z.unknown().optional(),
})

const canbusSchema = z.object({
  odometerKm: z.number().optional(),
  fuelLevelPct: z.number().optional(),
  engineOn: z.boolean().optional(),
  dtcCodes: z.array(z.string()).optional(),
})

const telemetryPositionSchema = positionSchema.extend({
  canbus: canbusSchema.optional(),
})

// A nivel del body solo se valida el "sobre" (que venga position o positions,
// y el limite de cantidad) con items sueltos y sin tipar todavia. Cada item se
// valida individualmente adentro de processPosition — asi un item mal formado
// no tira abajo el envio entero: se cuenta como fallido y el resto se procesa
// igual, tal como pide el resumen (recibidas/procesadas/fallidas).
const envelopeSchema = z
  .object({
    tenantSlug: z.string().trim().optional(),
    position: z.unknown().optional(),
    positions: z.array(z.unknown()).max(MAX_POSITIONS_PER_REQUEST).optional(),
  })
  .refine((data) => Boolean(data.position) || (data.positions && data.positions.length > 0), {
    message: 'Debe incluir "position" o "positions" con al menos un elemento.',
  })

type ProcessOutcome = {
  index: number
  deviceExternalId?: string
  ok: boolean
  message?: string
}

const processPosition = async (
  rawItem: unknown,
  index: number,
  itemSchema: typeof positionSchema | typeof telemetryPositionSchema,
): Promise<ProcessOutcome> => {
  const parsedItem = itemSchema.safeParse(rawItem)
  if (!parsedItem.success) {
    const firstIssue = parsedItem.error.issues[0]
    const rawDeviceExternalId =
      rawItem && typeof rawItem === 'object' && 'deviceExternalId' in rawItem
        ? String((rawItem as Record<string, unknown>).deviceExternalId ?? '')
        : undefined
    return {
      index,
      deviceExternalId: rawDeviceExternalId || undefined,
      ok: false,
      message: firstIssue ? `${firstIssue.path.join('.')}: ${firstIssue.message}` : 'Datos invalidos.',
    }
  }

  const item = parsedItem.data
  const deviceExternalId = item.deviceExternalId.trim()
  const provider = item.provider.trim()

  try {
    let capturedAt = new Date()
    if (item.capturedAt) {
      const parsed = new Date(item.capturedAt)
      if (Number.isNaN(parsed.getTime())) {
        return { index, deviceExternalId, ok: false, message: 'capturedAt invalido.' }
      }
      capturedAt = parsed
    }

    let unitId: string | null = null
    if (item.unitCode) {
      const normalized = normalizeUnitCode(item.unitCode)
      const unit = normalized
        ? await prisma.fleetUnit.findFirst({
            where: { internalCode: { equals: normalized, mode: 'insensitive' } },
            select: { id: true },
          })
        : null
      unitId = unit?.id ?? null
    }

    const device = await prisma.telemetryDevice.upsert({
      where: { deviceExternalId_provider: { deviceExternalId, provider } },
      update: {
        imei: item.imei || undefined,
        unitId: unitId ?? undefined,
        lastSeenAt: new Date(),
      },
      create: {
        deviceExternalId,
        provider,
        imei: item.imei || null,
        unitId,
        lastSeenAt: new Date(),
      },
    })

    const canbus = (item as { canbus?: z.infer<typeof canbusSchema> }).canbus

    await prisma.telemetryPosition.create({
      data: {
        deviceId: device.id,
        capturedAt,
        latitude: item.latitude,
        longitude: item.longitude,
        speedKph: item.speedKph ?? null,
        heading: item.heading ?? null,
        altitudeM: item.altitudeM ?? null,
        accuracyM: item.accuracyM ?? null,
        odometerKm: canbus?.odometerKm ?? null,
        fuelLevelPct: canbus?.fuelLevelPct ?? null,
        engineOn: canbus?.engineOn ?? null,
        dtcCodes: canbus?.dtcCodes ?? undefined,
        rawPayload: item.rawPayload ?? undefined,
      },
    })

    // El odometro del CAN bus nunca deberia bajar, asi que solo lo tomamos si
    // supera el valor actual — evita que una lectura ruidosa o un dispositivo
    // mal calibrado le pise el kilometraje real a la unidad. Reusa el mismo
    // recalculo de planes de mantenimiento que usa la edicion manual (fleet.ts),
    // para que las alertas queden al dia sin depender de que el cliente informe km.
    if (device.unitId && canbus?.odometerKm !== undefined) {
      const nextKm = Math.round(canbus.odometerKm)
      const unit = await prisma.fleetUnit.findUnique({
        where: { id: device.unitId },
        select: { currentKilometers: true },
      })
      if (unit && nextKm > unit.currentKilometers) {
        await prisma.fleetUnit.update({
          where: { id: device.unitId },
          data: { currentKilometers: nextKm },
        })
        void recalculateMaintenancePlansForUnit(device.unitId, { unitKilometers: nextKm })
      }
    }

    return { index, deviceExternalId, ok: true }
  } catch (error) {
    console.error('Telemetry position processing error:', error)
    return { index, deviceExternalId, ok: false, message: 'Error interno al procesar la posicion.' }
  }
}

const handleIngest = (itemSchema: typeof positionSchema | typeof telemetryPositionSchema) =>
  async (req: Request, res: Response) => {
    const parsed = envelopeSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({
        message: 'Datos invalidos.',
        issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      })
    }

    const items = [...(parsed.data.position ? [parsed.data.position] : []), ...(parsed.data.positions ?? [])]

    if (items.length > MAX_POSITIONS_PER_REQUEST) {
      return res.status(400).json({ message: `Maximo ${MAX_POSITIONS_PER_REQUEST} posiciones por envio.` })
    }

    const results: ProcessOutcome[] = []
    for (let index = 0; index < items.length; index += 1) {
      results.push(await processPosition(items[index], index, itemSchema))
    }

    const processed = results.filter((result) => result.ok).length
    const failed = results.length - processed
    const status = failed > 0 && processed === 0 ? 422 : 200

    return res.status(status).json({
      received: items.length,
      processed,
      failed,
      errors: results
        .filter((result) => !result.ok)
        .map(({ index, deviceExternalId, message }) => ({ index, deviceExternalId, message })),
    })
  }

router.post('/gps/webhook', requireGpsWebhookSecret, handleIngest(positionSchema))
router.post('/telemetry/ingest', requireGpsWebhookSecret, handleIngest(telemetryPositionSchema))

// ─── Lectura interna (requiere sesion de la app, no el secreto de proveedores) ───

router.get('/gps/devices', requireAuth, async (_req, res) => {
  try {
    const devices = await prisma.telemetryDevice.findMany({
      orderBy: { lastSeenAt: 'desc' },
      include: { unit: { select: { id: true, internalCode: true, ownerCompany: true } } },
    })
    return res.json(
      devices.map((device) => ({
        id: device.id,
        deviceExternalId: device.deviceExternalId,
        provider: device.provider,
        imei: device.imei,
        unitId: device.unitId,
        unitCode: device.unit?.internalCode ?? null,
        ownerCompany: device.unit?.ownerCompany ?? null,
        lastSeenAt: device.lastSeenAt,
        createdAt: device.createdAt,
      })),
    )
  } catch (error) {
    console.error('Integrations devices GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los dispositivos.' })
  }
})

router.get('/gps/positions', requireAuth, async (req, res) => {
  try {
    const { deviceId, unitId, limit } = req.query
    const parsedLimit = Number(limit)
    const take = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, MAX_POSITIONS_PER_REQUEST) : 100

    const where: Record<string, unknown> = {}
    if (typeof deviceId === 'string' && deviceId) {
      where.deviceId = deviceId
    }
    if (typeof unitId === 'string' && unitId) {
      where.device = { unitId }
    }

    const positions = await prisma.telemetryPosition.findMany({
      where,
      orderBy: { capturedAt: 'desc' },
      take,
      include: {
        device: {
          select: { deviceExternalId: true, provider: true, unitId: true, unit: { select: { internalCode: true } } },
        },
      },
    })

    return res.json(
      positions.map((position) => ({
        id: position.id,
        deviceId: position.deviceId,
        deviceExternalId: position.device.deviceExternalId,
        provider: position.device.provider,
        unitId: position.device.unitId,
        unitCode: position.device.unit?.internalCode ?? null,
        capturedAt: position.capturedAt,
        receivedAt: position.receivedAt,
        latitude: position.latitude,
        longitude: position.longitude,
        speedKph: position.speedKph,
        heading: position.heading,
        altitudeM: position.altitudeM,
        accuracyM: position.accuracyM,
        odometerKm: position.odometerKm,
        fuelLevelPct: position.fuelLevelPct,
        engineOn: position.engineOn,
        dtcCodes: position.dtcCodes,
      })),
    )
  } catch (error) {
    console.error('Integrations positions GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las posiciones.' })
  }
})

export default router
