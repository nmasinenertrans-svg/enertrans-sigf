import { Router } from 'express'
import type { NextFunction, Response } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getInspectionScanJob, startInspectionScanJob } from '../services/inspectionScanJobs.js'
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

// Arranca el escaneo en segundo plano y devuelve enseguida un id de trabajo
// -- ver inspectionScanJobs.ts para el motivo (evitar depender de una sola
// conexion HTTP larga, fragil ante timeouts de cualquier capa intermedia).
router.post('/', (req: AuthenticatedRequest, res) => {
  const parsed = scanSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const jobId = startInspectionScanJob(parsed.data.dataUrls, req.userId!)
  return res.status(202).json({ jobId })
})

router.get('/:jobId', (req: AuthenticatedRequest, res) => {
  const job = getInspectionScanJob(String(req.params.jobId), req.userId!)
  if (!job) {
    return res.status(404).json({ message: 'No se encontro el pedido de escaneo (puede haber expirado).' })
  }

  if (job.status === 'ERROR') {
    return res.json({ status: 'ERROR', message: job.message })
  }
  if (job.status === 'DONE') {
    return res.json({ status: 'DONE', result: job.result })
  }
  return res.json({ status: 'PENDING' })
})

export default router
