import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { getErrorCode } from '../utils/errors.js'

const router = Router()

const inventorySchema = z.object({
  id: z.string().uuid().optional(),
  sku: z.string().min(1),
  productName: z.string().min(1),
  stock: z.number().int().nonnegative(),
  movementHistory: z.array(z.string()).optional().default([]),
  linkedWorkOrderIds: z.array(z.string()).optional().default([]),
})

const inventoryUpdateSchema = inventorySchema.partial()

router.get('/', async (_req, res) => {
  const items = await prisma.inventoryItem.findMany({ orderBy: { createdAt: 'desc' } })
  return res.json(items)
})

router.post('/', async (req, res) => {
  const parsed = inventorySchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const item = await prisma.inventoryItem.create({ data: parsed.data })
    return res.status(201).json(item)
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2002') {
      return res.status(409).json({ message: 'Registro duplicado.' })
    }
    return res.status(500).json({ message: 'No se pudo crear el item.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = inventoryUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const item = await prisma.inventoryItem.update({ where: { id: req.params.id }, data: parsed.data })
  return res.json(item)
})

router.delete('/:id', async (req, res) => {
  await prisma.inventoryItem.delete({ where: { id: req.params.id } })
  return res.status(204).send()
})

export default router
