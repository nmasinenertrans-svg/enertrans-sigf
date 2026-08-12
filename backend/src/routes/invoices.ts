import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'
import { formatCode, getNextSequence } from '../utils/sequence.js'
import { getErrorCode } from '../utils/errors.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'

const router = Router()

const invoiceCreateSchema = z.object({
  providerName: z.string().min(1),
  supplierId: z.string().nullable().optional(),
  invoiceNumber: z.string().optional().default(''),
  amount: z.number().min(0).optional().default(0),
  currency: z.enum(['ARS', 'USD']).optional().default('ARS'),
  issuedAt: z.string().datetime().nullable().optional(),
  notes: z.string().optional().default(''),
  fileName: z.string().optional().default(''),
  fileBase64: z.string().optional().default(''),
  fileUrl: z.string().optional().default(''),
  repairId: z.string().nullable().optional(),
  inventoryItemIds: z.array(z.string()).optional().default([]),
  inventoryItemQuantities: z.record(z.string(), z.number().positive()).optional().default({}),
})

const invoiceUpdateSchema = invoiceCreateSchema.partial()

const mapInvoice = (invoice: Record<string, unknown> & { createdBy?: { fullName?: string } | null }) => {
  const { createdBy, ...rest } = invoice
  return {
    ...rest,
    createdByUserName: createdBy?.fullName ?? '',
    inventoryItemIds: Array.isArray(invoice.inventoryItemIds) ? invoice.inventoryItemIds : [],
    inventoryItemQuantities:
      invoice.inventoryItemQuantities && typeof invoice.inventoryItemQuantities === 'object'
        ? invoice.inventoryItemQuantities
        : {},
  }
}

const parseQuantitiesMap = (raw: unknown): Record<string, number> => {
  if (!raw || typeof raw !== 'object') {
    return {}
  }
  const result: Record<string, number> = {}
  Object.entries(raw as Record<string, unknown>).forEach(([id, value]) => {
    const quantity = Number(value)
    if (id && Number.isFinite(quantity) && quantity > 0) {
      result[id] = quantity
    }
  })
  return result
}

/** increment a aplicar a stock = cantidades nuevas - cantidades previas (compra suma stock) */
const buildInvoiceStockIncrementMap = (
  previous: Record<string, number>,
  next: Record<string, number>,
): Map<string, number> => {
  const ids = new Set([...Object.keys(previous), ...Object.keys(next)])
  const increments = new Map<string, number>()
  ids.forEach((id) => {
    const delta = (next[id] ?? 0) - (previous[id] ?? 0)
    if (delta !== 0) {
      increments.set(id, delta)
    }
  })
  return increments
}

const applyInvoiceStockDeltas = async (
  tx: { inventoryItem: { update: (args: any) => Promise<unknown> } },
  incrementByItemId: Map<string, number>,
) => {
  for (const [inventoryItemId, delta] of incrementByItemId.entries()) {
    if (!delta) {
      continue
    }
    try {
      await tx.inventoryItem.update({
        where: { id: inventoryItemId },
        data: { stock: { increment: delta } },
      })
    } catch (error) {
      console.warn(`No se pudo sumar stock del producto ${inventoryItemId}:`, error)
    }
  }
}

router.get('/', async (req, res) => {
  try {
    const { repairId, inventoryItemId } = req.query

    const where: Record<string, unknown> = {}
    if (typeof repairId === 'string' && repairId) {
      where.repairId = repairId
    }

    const items = await prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { fullName: true } } },
    })

    const mapped = items.map((item) => mapInvoice(item as unknown as Record<string, unknown>))
    const filtered =
      typeof inventoryItemId === 'string' && inventoryItemId
        ? mapped.filter((item) => (item.inventoryItemIds as string[]).includes(inventoryItemId))
        : mapped

    return res.json(filtered)
  } catch (error) {
    console.error('Invoice GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar las facturas.' })
  }
})

router.post('/', async (req: AuthenticatedRequest, res) => {
  if (!req.userId) {
    return res.status(401).json({ message: 'No autenticado.' })
  }

  const parsed = invoiceCreateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const userId = req.userId
  try {
    const code = formatCode('FC', await getNextSequence('invoice'))
    const quantities = parseQuantitiesMap(parsed.data.inventoryItemQuantities)
    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          code,
          providerName: parsed.data.providerName.trim(),
          supplierId: parsed.data.supplierId || null,
          invoiceNumber: parsed.data.invoiceNumber.trim(),
          amount: parsed.data.amount,
          currency: parsed.data.currency,
          issuedAt: parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : null,
          notes: parsed.data.notes.trim(),
          fileName: parsed.data.fileName,
          fileBase64: parsed.data.fileBase64,
          fileUrl: parsed.data.fileUrl,
          repairId: parsed.data.repairId || null,
          inventoryItemIds: parsed.data.inventoryItemIds,
          inventoryItemQuantities: quantities,
          createdByUserId: userId,
        },
        include: { createdBy: { select: { fullName: true } } },
      })
      await applyInvoiceStockDeltas(tx, buildInvoiceStockIncrementMap({}, quantities))
      return created
    })
    return res.status(201).json(mapInvoice(item as unknown as Record<string, unknown>))
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Reparacion vinculada invalida.' })
    }
    console.error('Invoice POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear la factura.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = invoiceUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const data: Record<string, unknown> = { ...parsed.data }
  if (parsed.data.providerName !== undefined) {
    data.providerName = parsed.data.providerName.trim()
  }
  if (parsed.data.invoiceNumber !== undefined) {
    data.invoiceNumber = parsed.data.invoiceNumber.trim()
  }
  if (parsed.data.notes !== undefined) {
    data.notes = parsed.data.notes.trim()
  }
  if (parsed.data.issuedAt !== undefined) {
    data.issuedAt = parsed.data.issuedAt ? new Date(parsed.data.issuedAt) : null
  }
  if (parsed.data.repairId !== undefined) {
    data.repairId = parsed.data.repairId || null
  }
  if (parsed.data.supplierId !== undefined) {
    data.supplierId = parsed.data.supplierId || null
  }

  const nextQuantities =
    parsed.data.inventoryItemQuantities !== undefined ? parseQuantitiesMap(parsed.data.inventoryItemQuantities) : undefined
  if (nextQuantities !== undefined) {
    data.inventoryItemQuantities = nextQuantities
  }

  try {
    const item = await prisma.$transaction(async (tx) => {
      if (nextQuantities !== undefined) {
        const existing = await tx.invoice.findUnique({
          where: { id: req.params.id },
          select: { inventoryItemQuantities: true },
        })
        if (!existing) {
          throw Object.assign(new Error('La factura no existe.'), { code: 'P2025' })
        }
        const previousQuantities = parseQuantitiesMap((existing as any).inventoryItemQuantities)
        await applyInvoiceStockDeltas(tx, buildInvoiceStockIncrementMap(previousQuantities, nextQuantities))
      }

      return tx.invoice.update({
        where: { id: req.params.id },
        data,
        include: { createdBy: { select: { fullName: true } } },
      })
    })
    return res.json(mapInvoice(item as unknown as Record<string, unknown>))
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'La factura no existe.' })
    }
    if (getErrorCode(error) === 'P2003') {
      return res.status(400).json({ message: 'Reparacion vinculada invalida.' })
    }
    console.error('Invoice PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la factura.' })
  }
})

router.delete('/:id', async (req, res) => {
  try {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.invoice.findUnique({
        where: { id: req.params.id },
        select: { inventoryItemQuantities: true },
      })
      if (!existing) {
        throw Object.assign(new Error('La factura no existe.'), { code: 'P2025' })
      }
      const quantities = parseQuantitiesMap((existing as any).inventoryItemQuantities)
      await applyInvoiceStockDeltas(tx, buildInvoiceStockIncrementMap(quantities, {}))
      await tx.invoice.delete({ where: { id: req.params.id } })
    })
    return res.status(204).send()
  } catch (error: unknown) {
    if (getErrorCode(error) === 'P2025') {
      return res.status(404).json({ message: 'La factura no existe.' })
    }
    console.error('Invoice DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar la factura.' })
  }
})

export default router
