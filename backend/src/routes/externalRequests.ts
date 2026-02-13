import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'

const router = Router()

const externalRequestSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1),
  unitId: z.string().min(1),
  companyName: z.string().min(1),
  description: z.string().min(1),
  tasks: z.array(z.string().min(1)),
  providerFileName: z.string().optional(),
  providerFileUrl: z.string().optional(),
  createdAt: z.string().optional(),
})

const externalRequestUpdateSchema = externalRequestSchema.partial()

router.get('/', async (_req, res) => {
  const items = await prisma.externalRequest.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.post('/', async (req, res) => {
  const parsed = externalRequestSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await prisma.externalRequest.create({ data: parsed.data })
    return res.status(201).json(item)
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    if (error?.code === 'P2003') {
      return res.status(409).json({ message: 'Unidad no valida.' })
    }
    return res.status(500).json({ message: 'No se pudo crear la nota de pedido.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = externalRequestUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const item = await prisma.externalRequest.update({ where: { id: req.params.id }, data: parsed.data })
  return res.json(item)
})

router.delete('/:id', async (req, res) => {
  await prisma.externalRequest.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
