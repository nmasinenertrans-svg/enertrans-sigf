import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../db.js'

export interface AuthenticatedRequest extends Request {
  userId?: string
}

const LAST_ACTIVITY_BY_USER_KEY = '__lastActivityByUser'
const ACTIVITY_WRITE_THROTTLE_MS = 5 * 60 * 1000
const activityWriteCache = new Map<string, number>()

const toFeatureFlagsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const readLastActivityByUser = (featureFlagsValue: unknown): Record<string, string> => {
  const source = toFeatureFlagsRecord(featureFlagsValue)
  const rawMap = source[LAST_ACTIVITY_BY_USER_KEY]
  if (!rawMap || typeof rawMap !== 'object' || Array.isArray(rawMap)) {
    return {}
  }
  return Object.entries(rawMap as Record<string, unknown>).reduce<Record<string, string>>((acc, [id, value]) => {
    if (typeof value === 'string' && value.trim().length > 0) {
      acc[id] = value
    }
    return acc
  }, {})
}

const touchUserActivity = (userId: string) => {
  const nowMs = Date.now()
  const lastWrite = activityWriteCache.get(userId) ?? 0
  if (nowMs - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) {
    return
  }
  activityWriteCache.set(userId, nowMs)

  void prisma.appSettings
    .findUnique({ where: { id: 'app' }, select: { featureFlags: true } })
    .then((settings) => {
      const featureFlags = toFeatureFlagsRecord(settings?.featureFlags)
      const lastActivityByUser = readLastActivityByUser(featureFlags)
      const nextFeatureFlags = {
        ...featureFlags,
        [LAST_ACTIVITY_BY_USER_KEY]: {
          ...lastActivityByUser,
          [userId]: new Date(nowMs).toISOString(),
        },
      }
      return prisma.appSettings.upsert({
        where: { id: 'app' },
        update: { featureFlags: nextFeatureFlags },
        create: { id: 'app', featureFlags: nextFeatureFlags },
      })
    })
    .catch(() => {
      // ignore activity tracking failures
    })
}

export const requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token requerido.' })
  }

  const token = header.slice(7)
  const secret = process.env.JWT_SECRET
  if (!secret) {
    return res.status(500).json({ message: 'JWT_SECRET no configurado.' })
  }

  try {
    const decoded = jwt.verify(token, secret) as { sub: string }
    const userId = decoded.sub
    if (!userId) {
      return res.status(401).json({ message: 'Token invalido.' })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) {
      return res.status(401).json({ message: 'Usuario no encontrado.' })
    }

    req.userId = userId
    touchUserActivity(userId)
    return next()
  } catch {
    return res.status(401).json({ message: 'Token invalido.' })
  }
}
