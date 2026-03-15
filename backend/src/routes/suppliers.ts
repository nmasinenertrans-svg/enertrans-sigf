import { Router } from 'express'
import { z } from 'zod'
import { prisma } from '../db.js'

const router = Router()

const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  serviceType: z.string().max(120).optional().default(''),
  contactName: z.string().max(120).optional().default(''),
  contactPhone: z.string().max(60).optional().default(''),
  contactEmail: z.string().max(120).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
  isActive: z.boolean().optional().default(true),
})

const updateSchema = supplierSchema.partial()

const normalize = (value: string | undefined) => (value ?? '').trim()

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.supplier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })
    return res.json(items)
  } catch (error) {
    console.error('Suppliers GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los proveedores.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const name = normalize(parsed.data.name)
    const existing = await prisma.supplier.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    })
    if (existing) {
      return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
    }

    const created = await prisma.supplier.create({
      data: {
        name,
        serviceType: normalize(parsed.data.serviceType),
        contactName: normalize(parsed.data.contactName),
        contactPhone: normalize(parsed.data.contactPhone),
        contactEmail: normalize(parsed.data.contactEmail),
        notes: normalize(parsed.data.notes),
        isActive: parsed.data.isActive,
      },
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })
    return res.status(201).json(created)
  } catch (error) {
    console.error('Suppliers POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el proveedor.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const supplierId = req.params.id
  if (!supplierId) {
    return res.status(400).json({ message: 'Id de proveedor requerido.' })
  }

  try {
    const current = await prisma.supplier.findUnique({ where: { id: supplierId } })
    if (!current) {
      return res.status(404).json({ message: 'Proveedor no encontrado.' })
    }

    const nextName =
      parsed.data.name !== undefined && normalize(parsed.data.name)
        ? normalize(parsed.data.name)
        : current.name

    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      const conflict = await prisma.supplier.findFirst({
        where: {
          id: { not: supplierId },
          name: { equals: nextName, mode: 'insensitive' },
        },
      })
      if (conflict) {
        return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
      }
    }

    const updated = await prisma.supplier.update({
      where: { id: supplierId },
      data: {
        name: nextName,
        serviceType: parsed.data.serviceType !== undefined ? normalize(parsed.data.serviceType) : undefined,
        contactName: parsed.data.contactName !== undefined ? normalize(parsed.data.contactName) : undefined,
        contactPhone: parsed.data.contactPhone !== undefined ? normalize(parsed.data.contactPhone) : undefined,
        contactEmail: parsed.data.contactEmail !== undefined ? normalize(parsed.data.contactEmail) : undefined,
        notes: parsed.data.notes !== undefined ? normalize(parsed.data.notes) : undefined,
        isActive: parsed.data.isActive,
      },
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })

    if (nextName !== current.name) {
      await prisma.repairRecord.updateMany({
        where: { supplierId: supplierId },
        data: { supplierName: nextName },
      })
    }

    return res.json(updated)
  } catch (error) {
    console.error('Suppliers PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el proveedor.' })
  }
})

router.delete('/:id', async (req, res) => {
  const supplierId = req.params.id
  if (!supplierId) {
    return res.status(400).json({ message: 'Id de proveedor requerido.' })
  }

  try {
    const current = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })
    if (!current) {
      return res.status(404).json({ message: 'Proveedor no encontrado.' })
    }
    if (current._count.repairs > 0) {
      return res.status(409).json({ message: 'No se puede eliminar un proveedor con reparaciones cargadas.' })
    }

    await prisma.supplier.delete({ where: { id: supplierId } })
    return res.status(204).send()
  } catch (error) {
    console.error('Suppliers DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el proveedor.' })
  }
})

export default router
