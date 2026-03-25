import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../db.js'

const isBypassedPath = (path: string) => {
  if (path.startsWith('/auth')) {
    return true
  }
  if (path.startsWith('/health')) {
    return true
  }
  return false
}

const isReadMethod = (method: string) => {
  const normalized = method.trim().toUpperCase()
  return normalized === 'GET' || normalized === 'HEAD' || normalized === 'OPTIONS'
}

const toFeatureFlagsRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

export const basicViewModeGuard = async (req: Request, res: Response, next: NextFunction) => {
  if (isBypassedPath(req.path) || isReadMethod(req.method)) {
    return next()
  }

  let settings: { featureFlags?: unknown } | null = null
  try {
    settings = await prisma.appSettings.findUnique({
      where: { id: 'app' },
      select: { featureFlags: true },
    })
  } catch {
    settings = null
  }

  const featureFlags = toFeatureFlagsRecord(settings?.featureFlags)
  if (featureFlags.basicViewMode !== true) {
    return next()
  }

  const blockedMessage = 'Modo vista basica activo: esta accion esta bloqueada. Contacta al administrador.'
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(423).json({ message: blockedMessage })
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    return res.status(423).json({ message: blockedMessage })
  }

  try {
    const decoded = jwt.verify(header.slice(7), secret) as { sub?: string }
    if (!decoded?.sub) {
      return res.status(423).json({ message: blockedMessage })
    }

    const user = await prisma.user.findUnique({ where: { id: decoded.sub }, select: { role: true } })
    if (user?.role === 'DEV') {
      return next()
    }

    return res.status(423).json({ message: blockedMessage })
  } catch {
    return res.status(423).json({ message: blockedMessage })
  }
}
