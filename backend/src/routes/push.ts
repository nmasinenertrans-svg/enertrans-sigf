import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { getVapidPublicKey, isPushConfigured } from '../services/webPush.js'

const router = Router()

const subscribeSchema = z.object({
  endpoint: z.string().min(1),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
  userAgent: z.string().optional().default(''),
})

const unsubscribeSchema = z.object({
  endpoint: z.string().min(1),
})

router.get('/public-key', (_req, res) => {
  if (!isPushConfigured()) {
    return res.json({ enabled: false, publicKey: '' })
  }
  return res.json({ enabled: true, publicKey: getVapidPublicKey() })
})

router.post('/subscribe', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }
  const parsed = subscribeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      update: {
        userId: req.userId,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? '',
      },
      create: {
        userId: req.userId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: parsed.data.userAgent ?? '',
      },
    })
    return res.status(201).json({ ok: true })
  } catch (error) {
    console.error('Push subscribe error:', error)
    return res.status(500).json({ message: 'No se pudo guardar la suscripcion.' })
  }
})

router.post('/unsubscribe', async (req: AuthenticatedRequest, res) => {
  const parsed = unsubscribeSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint: parsed.data.endpoint } })
    return res.status(204).send()
  } catch (error) {
    console.error('Push unsubscribe error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la suscripcion.' })
  }
})

export default router
