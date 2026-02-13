import type { Response, NextFunction } from 'express'
import { prisma } from '../db.js'
import type { PermissionAction, PermissionModule } from '../auth/permissions.js'
import { canUser } from '../auth/permissions.js'
import type { AuthenticatedRequest } from './auth.js'

export const requirePermission = (moduleKey: PermissionModule, action: PermissionAction) => {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.userId) {
      return res.status(401).json({ message: 'No autorizado.' })
    }

    const user = await prisma.user.findUnique({ where: { id: req.userId } })
    if (!user) {
      return res.status(401).json({ message: 'Usuario no encontrado.' })
    }

    if (!canUser(user, moduleKey, action)) {
      return res.status(403).json({ message: 'No tenes permisos para esta accion.' })
    }

    return next()
  }
}