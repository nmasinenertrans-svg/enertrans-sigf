import { Router } from 'express'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { prisma } from '../db.js'
import { verifyPassword } from '../utils/password.js'

const router = Router()

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

  try {
    const settings = await prisma.appSettings.findUnique({ where: { id: 'app' } })
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
    },
  })
})

export default router
