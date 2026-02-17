import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { hashPassword } from '../utils/password.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const updateProfileSchema = z.object({
  fullName: z.string().min(1).optional(),
  password: z.string().min(6).optional(),
  avatarUrl: z.string().optional(),
})

router.get('/', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  if (!authReq.userId) {
    return res.status(401).json({ message: 'Token requerido.' })
  }
  const user = await prisma.user.findUnique({ where: { id: authReq.userId } })
  if (!user) {
    return res.status(404).json({ message: 'Usuario no encontrado.' })
  }
  return res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    permissions: user.permissions,
    permissionOverrides: user.permissionOverrides,
  })
})

router.patch('/', async (req, res) => {
  const authReq = req as AuthenticatedRequest
  if (!authReq.userId) {
    return res.status(401).json({ message: 'Token requerido.' })
  }
  const parsed = updateProfileSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const updateData: any = {
    fullName: parsed.data.fullName,
    avatarUrl: parsed.data.avatarUrl,
  }

  if (parsed.data.password) {
    updateData.passwordHash = await hashPassword(parsed.data.password)
  }

  const user = await prisma.user.update({
    where: { id: authReq.userId },
    data: updateData,
  })

  return res.json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    avatarUrl: user.avatarUrl,
    permissions: user.permissions,
    permissionOverrides: user.permissionOverrides,
  })
})

export default router
