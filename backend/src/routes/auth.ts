import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verifyPassword } from '../utils/password.js'

const router = Router()
const LAST_LOGIN_BY_USER_KEY = '__lastLoginByUser'
const LAST_ACTIVITY_BY_USER_KEY = '__lastActivityByUser'

const toFeatureFlagsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const readLastLoginByUser = (featureFlagsValue: unknown): Record<string, string> => {
  const source = toFeatureFlagsRecord(featureFlagsValue)
  const rawMap = source[LAST_LOGIN_BY_USER_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }

  return Object.entries(rawMap as Record<string, unknown>).reduce<Record<string, string>>((acc, [userId, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[userId] = value
    }
    return acc
  }, {})
}

const readLastActivityByUser = (featureFlagsValue: unknown): Record<string, string> => {
  const source = toFeatureFlagsRecord(featureFlagsValue)
  const rawMap = source[LAST_ACTIVITY_BY_USER_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }

  return Object.entries(rawMap as Record<string, unknown>).reduce<Record<string, string>>((acc, [userId, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[userId] = value
    }
    return acc
  }, {})
}

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const { username, password } = parsed.data
  const user = await prisma.user.findUnique({ where: { username } })

  if (!user) {
    return res.status(401).json({ message: 'Usuario o contrasena incorrectos.' })
  }

  const valid = await verifyPassword(password, user.passwordHash)
  if (!valid) {
    return res.status(401).json({ message: 'Usuario o contrasena incorrectos.' })
  }

  let settings:
    | {
        maintenanceEnabled: boolean
        maintenanceMessage: string | null
        featureFlags: unknown
      }
    | null = null
  try {
    settings = await prisma.appSettings.findUnique({ where: { id: 'app' } })
    if (settings?.maintenanceEnabled && user.role !== 'DEV') {
      return res
        .status(503)
        .json({
          message:
            settings.maintenanceMessage ||
            'La aplicacion se encuentra en mantenimiento, contacte con el area de soporte.',
        })
    }
  } catch {
    // If settings table is unavailable, allow login to avoid 500s.
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    return res.status(500).json({ message: 'JWT_SECRET no configurado.' })
  }

  const lastLoginAt = new Date().toISOString()
  try {
    const featureFlags = toFeatureFlagsRecord(settings?.featureFlags)
    const lastLogins = readLastLoginByUser(featureFlags)
    const lastActivityByUser = readLastActivityByUser(featureFlags)
    const nextFeatureFlags = {
      ...featureFlags,
      [LAST_LOGIN_BY_USER_KEY]: {
        ...lastLogins,
        [user.id]: lastLoginAt,
      },
      [LAST_ACTIVITY_BY_USER_KEY]: {
        ...lastActivityByUser,
        [user.id]: lastLoginAt,
      },
    }
    await prisma.appSettings.upsert({
      where: { id: 'app' },
      update: { featureFlags: nextFeatureFlags },
      create: { id: 'app', featureFlags: nextFeatureFlags },
    })
  } catch (error) {
    console.error('No se pudo guardar ultimo login:', error)
  }

  const token = jwt.sign({ sub: user.id, role: user.role }, secret, { expiresIn: '30d' })

  return res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      permissions: user.permissions,
      permissionOverrides: user.permissionOverrides,
      lastLoginAt,
    },
  })
})

export default router
