import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

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
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const withRetry = async <T,>(fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (error) {
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
  const stored = (settings?.featureFlags as Record<string, boolean> | null) ?? {}
  return res.json({
    ...defaultFeatureFlags,
    ...stored,
  })
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
