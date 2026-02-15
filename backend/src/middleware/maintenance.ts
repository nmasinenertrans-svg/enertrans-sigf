import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../db.js'

const isBypassedPath = (path: string) => {
  if (path.startsWith('/auth')) {
    return true
  }
  if (path.startsWith('/health')) {
    return true
  }
  if (path.startsWith('/settings/maintenance')) {
    return true
  }
  return false
}

export const maintenanceGuard = async (req: Request, res: Response, next: NextFunction) => {
  const method = req.method.toUpperCase()
  if (isBypassedPath(req.path)) {
    return next()
  }

  let settings: { maintenanceEnabled?: boolean; maintenanceMessage?: string } | null = null
  try {
    settings = await prisma.appSettings.findUnique({ where: { id: 'app' } })
  } catch {
    settings = null
  }

  if (!settings?.maintenanceEnabled) {
    return next()
  }

  const message =
    settings.maintenanceMessage ||
    'La aplicacion se encuentra en mantenimiento, contacte con el area de soporte.'

  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(503).json({ message })
  }

  const secret = process.env.JWT_SECRET
  if (!secret) {
    return res.status(503).json({ message })
  }

  try {
    const decoded = jwt.verify(header.slice(7), secret) as { sub?: string }
    if (!decoded?.sub) {
      return res.status(503).json({ message })
    }
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } })
    if (!user || user.role !== 'DEV') {
      return res.status(503).json({ message })
    }
  } catch {
    return res.status(503).json({ message })
  }

  return next()
}
