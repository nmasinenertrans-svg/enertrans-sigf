import { Router } from 'express'
import { z } from 'zod'
import { prisma, runWithSchemaFailover } from '../db.js'

const router = Router()

const clientSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  legalName: z.string().max(160).optional().default(''),
  taxId: z.string().max(40).optional().default(''),
  contactName: z.string().max(120).optional().default(''),
  contactPhone: z.string().max(60).optional().default(''),
  contactEmail: z.string().max(120).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
  isActive: z.boolean().optional().default(true),
})

const updateSchema = clientSchema.partial()

const normalize = (value: string | undefined) => (value ?? '').trim()

router.get('/', async (_req, res) => {
  try {
    const items = await runWithSchemaFailover(() =>
      prisma.clientAccount.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: {
          _count: {
            select: {
              units: true,
              deliveries: true,
            },
          },
        },
      }),
    )
    return res.json(items)
  } catch (error) {
    console.error('Clients GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los clientes.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = clientSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const name = normalize(parsed.data.name)
    const existing = await prisma.clientAccount.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    })
    if (existing) {
      return res.status(409).json({ message: 'Ya existe un cliente con ese nombre.' })
    }

    const created = await prisma.clientAccount.create({
      data: {
        name,
        legalName: normalize(parsed.data.legalName),
        taxId: normalize(parsed.data.taxId),
        contactName: normalize(parsed.data.contactName),
        contactPhone: normalize(parsed.data.contactPhone),
        contactEmail: normalize(parsed.data.contactEmail),
        notes: normalize(parsed.data.notes),
        isActive: parsed.data.isActive,
      },
      include: {
        _count: {
          select: {
            units: true,
            deliveries: true,
          },
        },
      },
    })
    return res.status(201).json(created)
  } catch (error) {
    console.error('Clients POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el cliente.' })
  }
})

router.patch('/:id', async (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const clientId = req.params.id
  if (!clientId) {
    return res.status(400).json({ message: 'Id de cliente requerido.' })
  }

  try {
    const current = await prisma.clientAccount.findUnique({ where: { id: clientId } })
    if (!current) {
      return res.status(404).json({ message: 'Cliente no encontrado.' })
    }

    const nextName =
      parsed.data.name !== undefined && normalize(parsed.data.name)
        ? normalize(parsed.data.name)
        : current.name

    if (nextName.toLowerCase() !== current.name.toLowerCase()) {
      const conflict = await prisma.clientAccount.findFirst({
        where: {
          id: { not: clientId },
          name: { equals: nextName, mode: 'insensitive' },
        },
      })
      if (conflict) {
        return res.status(409).json({ message: 'Ya existe un cliente con ese nombre.' })
      }
    }

    const updated = await prisma.clientAccount.update({
      where: { id: clientId },
      data: {
        name: nextName,
        legalName: parsed.data.legalName !== undefined ? normalize(parsed.data.legalName) : undefined,
        taxId: parsed.data.taxId !== undefined ? normalize(parsed.data.taxId) : undefined,
        contactName: parsed.data.contactName !== undefined ? normalize(parsed.data.contactName) : undefined,
        contactPhone: parsed.data.contactPhone !== undefined ? normalize(parsed.data.contactPhone) : undefined,
        contactEmail: parsed.data.contactEmail !== undefined ? normalize(parsed.data.contactEmail) : undefined,
        notes: parsed.data.notes !== undefined ? normalize(parsed.data.notes) : undefined,
        isActive: parsed.data.isActive,
      },
      include: {
        _count: {
          select: {
            units: true,
            deliveries: true,
          },
        },
      },
    })

    if (nextName !== current.name) {
      await prisma.fleetUnit.updateMany({
        where: { clientId: clientId },
        data: { clientName: nextName },
      })
    }

    return res.json(updated)
  } catch (error) {
    console.error('Clients PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar el cliente.' })
  }
})

router.patch('/:id/assign-units', async (req, res) => {
  const schema = z.object({ unitIds: z.array(z.string()).default([]) })
  const parsed = schema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const clientId = req.params.id
  if (!clientId) {
    return res.status(400).json({ message: 'Id de cliente requerido.' })
  }

  try {
    const client = await prisma.clientAccount.findUnique({ where: { id: clientId } })
    if (!client) {
      return res.status(404).json({ message: 'Cliente no encontrado.' })
    }

    const targetUnitIds = Array.from(new Set(parsed.data.unitIds.filter(Boolean)))

    await prisma.$transaction(async (tx) => {
      await tx.fleetUnit.updateMany({
        where: { clientId },
        data: { clientId: null, clientName: '' },
      })

      if (targetUnitIds.length > 0) {
        await tx.fleetUnit.updateMany({
          where: { id: { in: targetUnitIds } },
          data: { clientId, clientName: client.name },
        })
      }
    })

    const refreshed = await prisma.clientAccount.findUnique({
      where: { id: clientId },
      include: {
        _count: {
          select: {
            units: true,
            deliveries: true,
          },
        },
      },
    })
    return res.json(refreshed)
  } catch (error) {
    console.error('Clients assign units error:', error)
    return res.status(500).json({ message: 'No se pudo actualizar la asignacion de unidades.' })
  }
})

router.delete('/:id', async (req, res) => {
  const clientId = req.params.id
  if (!clientId) {
    return res.status(400).json({ message: 'Id de cliente requerido.' })
  }

  try {
    const current = await prisma.clientAccount.findUnique({
      where: { id: clientId },
      include: {
        _count: {
          select: {
            units: true,
            deliveries: true,
          },
        },
      },
    })
    if (!current) {
      return res.status(404).json({ message: 'Cliente no encontrado.' })
    }
    if (current._count.units > 0 || current._count.deliveries > 0) {
      return res.status(409).json({ message: 'No se puede eliminar un cliente con historial o unidades asignadas.' })
    }

    await prisma.clientAccount.delete({ where: { id: clientId } })
    return res.status(204).send()
  } catch (error) {
    console.error('Clients DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el cliente.' })
  }
})

export default router
