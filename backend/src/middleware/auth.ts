import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { prisma } from '../db.js'

export interface AuthenticatedRequest extends Request {
  userId?: string
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
    return next()
  } catch {
    return res.status(401).json({ message: 'Token invalido.' })
  }
}