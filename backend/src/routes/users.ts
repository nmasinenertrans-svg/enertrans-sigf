import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { hashPassword } from '../utils/password.js'

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

const createUserSchema = z.object({
  username: z.string().min(1),
  fullName: z.string().min(1),
  role: z.enum(['DEV', 'GERENTE', 'COORDINADOR', 'AUDITOR', 'MECANICO']),
  password: z.string().min(6),
  avatarUrl: z.string().optional(),
  permissions: z.any().optional(),
  permissionOverrides: z.any().optional(),
})

const updateUserSchema = z.object({
  fullName: z.string().min(1).optional(),
  role: z.enum(['DEV', 'GERENTE', 'COORDINADOR', 'AUDITOR', 'MECANICO']).optional(),
  password: z.string().min(6).optional(),
  avatarUrl: z.string().optional(),
  permissions: z.any().optional(),
  permissionOverrides: z.any().optional(),
})

router.get('/', async (_req, res) => {
  const [users, settings] = await Promise.all([
    prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        avatarUrl: true,
        permissions: true,
        permissionOverrides: true,
        createdAt: true,
      },
    }),
    prisma.appSettings.findUnique({
      where: { id: 'app' },
      select: { featureFlags: true },
    }),
  ])

  const lastLogins = readLastLoginByUser(settings?.featureFlags)
  const lastActivity = readLastActivityByUser(settings?.featureFlags)
  return res.json(
    users.map((user) => ({
      ...user,
      lastLoginAt: lastLogins[user.id],
      lastActivityAt: lastActivity[user.id],
    })),
  )
})

router.post('/', async (req, res) => {
  const parsed = createUserSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const exists = await prisma.user.findUnique({ where: { username: parsed.data.username } })
  if (exists) {
    return res.status(409).json({ message: 'Usuario ya existe.' })
  }

  const passwordHash = await hashPassword(parsed.data.password)

  const user = await prisma.user.create({
    data: {
      username: parsed.data.username,
      fullName: parsed.data.fullName,
      role: parsed.data.role,
      passwordHash,
      avatarUrl: parsed.data.avatarUrl ?? '',
      permissions: parsed.data.permissions ?? null,
      permissionOverrides: parsed.data.permissionOverrides ?? null,
    },
  })

  return res.status(201).json({
    id: user.id,
    username: user.username,
    fullName: user.fullName,
      role: user.role,
      avatarUrl: user.avatarUrl,
      permissions: user.permissions,
      permissionOverrides: user.permissionOverrides,
  })
})

router.patch('/:id', async (req, res) => {
  const parsed = updateUserSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const updateData: any = { ...parsed.data }
  if (parsed.data.password) {
    updateData.passwordHash = await hashPassword(parsed.data.password)
    delete updateData.password
  }

  const existingUser = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (existingUser?.role === 'DEV' && parsed.data.role && parsed.data.role !== 'DEV') {
    delete updateData.role
  }

  const user = await prisma.user.update({
    where: { id: req.params.id },
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

router.delete('/:id', async (req, res) => {
  const existingUser = await prisma.user.findUnique({ where: { id: req.params.id } })
  if (!existingUser) {
    return res.status(404).json({ message: 'Usuario no encontrado.' })
  }
  if (existingUser?.role === 'DEV') {
    return res.status(403).json({ message: 'No se puede eliminar un usuario DEV.' })
  }

  try {
    await prisma.user.delete({ where: { id: req.params.id } })
    return res.status(204).send()
  } catch (error: any) {
    if (error?.code === 'P2003') {
      return res.status(409).json({
        message:
          'No se puede eliminar este usuario porque tiene historial asociado (auditorias/tareas).',
      })
    }
    return res.status(500).json({ message: 'No se pudo eliminar el usuario.' })
  }
})

export default router
