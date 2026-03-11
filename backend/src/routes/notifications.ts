import { Router } from 'express'
import type { Response } from 'express'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { getUserInboxNotifications } from '../services/userNotifications.js'

const router = Router()

router.get('/', async (req: AuthenticatedRequest, res: Response) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  try {
    const items = await getUserInboxNotifications(req.userId)
    return res.json(items)
  } catch (error) {
    console.error('Notifications GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las notificaciones.' })
  }
})

export default router
