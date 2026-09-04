import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { scanInspectionImages } from '../services/inspectionScan.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

// Funcion en prueba: solo DEV mientras se valida, igual que los otros
// modulos nuevos.
router.use(async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }
  const requester = await prisma.user.findUnique({ where: { id: req.userId }, select: { role: true } })
  if (!requester || requester.role !== 'DEV') {
    return res.status(403).json({ message: 'Funcion en prueba, disponible solo para DEV por ahora.' })
  }
  return next()
})

const scanSchema = z.object({ dataUrls: z.array(z.string().min(10)).min(1).max(3) })

router.post('/', async (req, res) => {
  const parsed = scanSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const result = await scanInspectionImages(parsed.data.dataUrls)
    return res.json(result)
  } catch (error) {
    console.error('Inspection scan error:', error)
    return res.status(500).json({ message: error instanceof Error ? error.message : 'No se pudo leer la imagen.' })
  }
})

export default router
