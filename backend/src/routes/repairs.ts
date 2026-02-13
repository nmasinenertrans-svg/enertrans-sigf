import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'

const router = Router()

const repairSchema = z.object({
  id: z.string().uuid().optional(),
  unitId: z.string().min(1),
  sourceType: z.enum(['WORK_ORDER', 'EXTERNAL_REQUEST']).optional().default('WORK_ORDER'),
  workOrderId: z.string().optional(),
  externalRequestId: z.string().optional(),
  supplierName: z.string().min(1),
  realCost: z.number(),
  invoicedToClient: z.number(),
  margin: z.number(),
  invoiceFileName: z.string().optional(),
  invoiceFileBase64: z.string().optional(),
  invoiceFileUrl: z.string().optional(),
})

const repairUpdateSchema = repairSchema.partial()

router.get('/', async (_req, res) => {
  const items = await prisma.repairRecord.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.post('/', async (req, res) => {
  const parsed = repairSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    if (parsed.data.sourceType === 'WORK_ORDER' && !parsed.data.workOrderId) {
      return res.status(400).json({ message: 'Debes seleccionar una OT.' })
    }
    if (parsed.data.sourceType === 'EXTERNAL_REQUEST' && !parsed.data.externalRequestId) {
      return res.status(400).json({ message: 'Debes seleccionar una nota externa.' })
    }

    const item = await prisma.repairRecord.create({ data: parsed.data })
    return res.status(201).json(item)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la reparacion.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = repairUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const item = await prisma.repairRecord.update({ where: { id: req.params.id }, data: parsed.data })
  return res.json(item)
})

router.delete('/:id', async (req, res) => {
  await prisma.repairRecord.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
