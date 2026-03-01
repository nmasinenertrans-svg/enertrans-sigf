import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()
const NOTIFICATIONS_READ_BY_USER_KEY = '__notificationsReadByUser'

const maintenanceSchema = z.object({
  enabled: z.boolean(),
  message: z.string().optional(),
})

const featureFlagsSchema = z.object({
  showDemoUnitButton: z.boolean().optional(),
  showFleetModule: z.boolean().optional(),
  showMaintenanceModule: z.boolean().optional(),
  showAuditsModule: z.boolean().optional(),
  showMovementsModule: z.boolean().optional(),
  showWorkOrdersModule: z.boolean().optional(),
  showTasksModule: z.boolean().optional(),
  showExternalRequestsModule: z.boolean().optional(),
  showRepairsModule: z.boolean().optional(),
  showReportsModule: z.boolean().optional(),
  showInventoryModule: z.boolean().optional(),
  showUsersModule: z.boolean().optional(),
  manualAuditMode: z.boolean().optional(),
})

const defaultFeatureFlags = {
  showDemoUnitButton: true,
  showFleetModule: true,
  showMaintenanceModule: true,
  showAuditsModule: true,
  showMovementsModule: true,
  showWorkOrdersModule: true,
  showTasksModule: true,
  showExternalRequestsModule: true,
  showRepairsModule: true,
  showReportsModule: true,
  showInventoryModule: true,
  showUsersModule: true,
  manualAuditMode: false,
}

const notificationsReadSchema = z.object({
  ids: z.array(z.string()).max(5000),
})

const normalizeReadIds = (ids: unknown): string[] => {
  if (!Array.isArray(ids)) {
    return []
  }
  const safe = ids
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, 5000)
  return Array.from(new Set(safe))
}

const toFeatureFlagsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const readNotificationsByUser = (featureFlagsValue: unknown): Record<string, string[]> => {
  const source = toFeatureFlagsRecord(featureFlagsValue)
  const rawMap = source[NOTIFICATIONS_READ_BY_USER_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }

  return Object.entries(rawMap as Record<string, unknown>).reduce<Record<string, string[]>>((acc, [userId, ids]) => {
    acc[userId] = normalizeReadIds(ids)
    return acc
  }, {})
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch {
    await wait(600)
    return await fn()
  }
}

const loadSettings = async () => {
  try {
    return await withRetry(() =>
      prisma.appSettings.upsert({
        where: { id: 'app' },
        update: {},
        create: { id: 'app' },
      }),
    )
  } catch {
    return null
  }
}

router.get('/maintenance', async (_req, res) => {
  const settings = await loadSettings()
  return res.json({
    enabled: settings?.maintenanceEnabled ?? false,
    message: settings?.maintenanceMessage ?? '',
  })
})

router.get('/features', async (_req, res) => {
  const settings = await loadSettings()
  const raw = toFeatureFlagsRecord(settings?.featureFlags)
  const stored = Object.keys(defaultFeatureFlags).reduce<Record<string, boolean>>((acc, key) => {
    const value = raw[key]
    if (typeof value === 'boolean') {
      acc[key] = value
    }
    return acc
  }, {})
  return res.json({
    ...defaultFeatureFlags,
    ...stored,
  })
})

router.get('/notifications-read', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const settings = await loadSettings()
  const notificationsByUser = readNotificationsByUser(settings?.featureFlags)
  return res.json({
    ids: notificationsByUser[req.userId] ?? [],
  })
})

router.put('/notifications-read', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const parsed = notificationsReadSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const settings = await loadSettings()
    const featureFlags = toFeatureFlagsRecord(settings?.featureFlags)
    const notificationsByUser = readNotificationsByUser(featureFlags)
    notificationsByUser[req.userId] = normalizeReadIds(parsed.data.ids)

    const nextFeatureFlags = {
      ...featureFlags,
      [NOTIFICATIONS_READ_BY_USER_KEY]: notificationsByUser,
    }

    await withRetry(() =>
      prisma.appSettings.upsert({
        where: { id: 'app' },
        update: { featureFlags: nextFeatureFlags },
        create: { id: 'app', featureFlags: nextFeatureFlags },
      }),
    )

    return res.json({ ids: notificationsByUser[req.userId] })
  } catch (error) {
    console.error('Error guardando notificaciones leidas:', error)
    return res.status(503).json({ message: 'No se pudo guardar la configuracion. Reintenta en 1 minuto.' })
  }
})

router.put('/maintenance', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user || user.role !== 'DEV') {
    return res.status(403).json({ message: 'Solo un usuario DEV puede activar mantenimiento.' })
  }

  const parsed = maintenanceSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const next = await withRetry(() =>
      prisma.appSettings.upsert({
        where: { id: 'app' },
        update: {
          maintenanceEnabled: parsed.data.enabled,
          maintenanceMessage: parsed.data.message ?? '',
        },
        create: {
          id: 'app',
          maintenanceEnabled: parsed.data.enabled,
          maintenanceMessage: parsed.data.message ?? '',
        },
      }),
    )

    return res.json({
      enabled: next.maintenanceEnabled,
      message: next.maintenanceMessage ?? '',
    })
  } catch (error) {
    console.error('Error actualizando mantenimiento:', error)
    return res.status(503).json({ message: 'No se pudo actualizar mantenimiento. Reintentá en 1 minuto.' })
  }
})

router.put('/features', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autorizado.' })
  }

  const user = await prisma.user.findUnique({ where: { id: req.userId } })
  if (!user || user.role !== 'DEV') {
    return res.status(403).json({ message: 'Solo un usuario DEV puede actualizar la configuración.' })
  }

  const parsed = featureFlagsSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const settings = await loadSettings()
    const current = (settings?.featureFlags as Record<string, boolean> | null) ?? {}
    const merged = { ...defaultFeatureFlags, ...current, ...parsed.data }

    const next = await withRetry(() =>
      prisma.appSettings.update({
        where: { id: 'app' },
        data: { featureFlags: merged },
      }),
    )

    return res.json({
      ...defaultFeatureFlags,
      ...(next.featureFlags as Record<string, boolean>),
    })
  } catch (error) {
    console.error('Error actualizando feature flags:', error)
    return res.status(503).json({ message: 'No se pudo actualizar la configuración. Reintentá en 1 minuto.' })
  }
})

export default router
