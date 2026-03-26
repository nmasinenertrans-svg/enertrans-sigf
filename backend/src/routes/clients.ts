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
const normalizeClientKey = (value: string | undefined) => normalize(value).replace(/\s+/g, ' ').toLowerCase()

const isSchemaMismatchError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false
  }
  const maybeError = error as { code?: string; message?: string }
  if (maybeError.code === 'P2021' || maybeError.code === 'P2022') {
    return true
  }
  const message = String(maybeError.message ?? '').toLowerCase()
  return message.includes('does not exist in the current database')
}

const syncClientsFromFleet = async (): Promise<{ created: number; linkedUnits: number }> => {
  return runWithSchemaFailover(async () => {
    const units = await prisma.fleetUnit.findMany({
      select: { id: true, clientId: true, clientName: true },
    })

    const nameByKey = new Map<string, string>()
    units.forEach((unit) => {
      const nextName = normalize(unit.clientName)
      if (!nextName) {
        return
      }
      const key = normalizeClientKey(nextName)
      if (!key) {
        return
      }
      if (!nameByKey.has(key)) {
        nameByKey.set(key, nextName)
      }
    })

    if (nameByKey.size === 0) {
      return { created: 0, linkedUnits: 0 }
    }

    const existingClients = await prisma.clientAccount.findMany({
      select: { id: true, name: true },
    })
    const clientByKey = new Map<string, { id: string; name: string }>()
    existingClients.forEach((client) => {
      const key = normalizeClientKey(client.name)
      if (key) {
        clientByKey.set(key, { id: client.id, name: client.name })
      }
    })

    const missingClients: { name: string }[] = []
    nameByKey.forEach((name, key) => {
      if (!clientByKey.has(key)) {
        missingClients.push({ name })
      }
    })

    let created = 0
    if (missingClients.length > 0) {
      const result = await prisma.clientAccount.createMany({
        data: missingClients.map((item) => ({
          name: item.name,
          legalName: '',
          taxId: '',
          contactName: '',
          contactPhone: '',
          contactEmail: '',
          notes: '',
          isActive: true,
        })),
        skipDuplicates: true,
      })
      created = result.count
    }

    const refreshedClients = await prisma.clientAccount.findMany({
      select: { id: true, name: true },
    })
    refreshedClients.forEach((client) => {
      const key = normalizeClientKey(client.name)
      if (key) {
        clientByKey.set(key, { id: client.id, name: client.name })
      }
    })

    const clientById = new Map<string, { id: string; name: string }>()
    refreshedClients.forEach((client) => clientById.set(client.id, { id: client.id, name: client.name }))

    const unitIdsByClient = new Map<string, string[]>()
    units.forEach((unit) => {
      const key = normalizeClientKey(unit.clientName)
      if (!key) {
        return
      }
      const client = clientByKey.get(key)
      if (!client) {
        return
      }

      const currentName = normalize(unit.clientName)
      const needsLink = unit.clientId !== client.id
      const needsNameNormalize = currentName !== client.name
      if (!needsLink && !needsNameNormalize) {
        return
      }

      const list = unitIdsByClient.get(client.id) ?? []
      list.push(unit.id)
      unitIdsByClient.set(client.id, list)
    })

    let linkedUnits = 0
    for (const [clientId, unitIds] of unitIdsByClient.entries()) {
      const client = clientById.get(clientId)
      if (!client) {
        continue
      }
      const result = await prisma.fleetUnit.updateMany({
        where: { id: { in: unitIds } },
        data: { clientId: client.id, clientName: client.name },
      })
      linkedUnits += result.count
    }

    return { created, linkedUnits }
  })
}

router.get('/', async (_req, res) => {
  try {
    try {
      await syncClientsFromFleet()
    } catch (syncError) {
      console.error('Clients sync from fleet error:', syncError)
    }

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
    if (isSchemaMismatchError(error)) {
      return res.json([])
    }
    console.error('Clients GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los clientes.' })
  }
})

router.post('/sync-from-fleet', async (_req, res) => {
  try {
    const result = await syncClientsFromFleet()
    return res.json({
      message: 'Sincronizacion de clientes desde flota completada.',
      ...result,
    })
  } catch (error) {
    console.error('Clients manual sync from fleet error:', error)
    return res.status(500).json({ message: 'No se pudo sincronizar clientes desde flota.' })
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
