import { Router } from 'express'
import { z } from 'zod'
import { getActiveDbSchema, prisma, runWithSchemaFailover } from '../db.js'

const router = Router()

const SUPPLIER_EXTENDED_COLUMNS = ['paymentMethod', 'paymentTerms', 'address', 'mapsUrl'] as const
const SUPPLIER_COLUMNS_CACHE_MS = 5 * 60 * 1000

let supplierColumnsSupportCache: { checkedAt: number; supported: boolean; schema: string } | null = null

const supplierSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(2).max(120),
  serviceType: z.string().max(120).optional().default(''),
  paymentMethod: z.string().max(120).optional().default(''),
  paymentTerms: z.string().max(120).optional().default(''),
  address: z.string().max(240).optional().default(''),
  mapsUrl: z.string().max(500).optional().default(''),
  contactName: z.string().max(120).optional().default(''),
  contactPhone: z.string().max(60).optional().default(''),
  contactEmail: z.string().max(120).optional().default(''),
  notes: z.string().max(1000).optional().default(''),
  isActive: z.boolean().optional().default(true),
})

const updateSchema = supplierSchema.partial()

const normalize = (value: string | undefined) => (value ?? '').trim()
const SUPPLIERS_FALLBACK_KEY = 'suppliersFallback'

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

const createSupplierId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `supplier-${Date.now()}-${Math.round(Math.random() * 100000)}`
}

const supplierLegacySelect = {
  id: true,
  name: true,
  serviceType: true,
  contactName: true,
  contactPhone: true,
  contactEmail: true,
  notes: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { repairs: true },
  },
} as const

const toSupplierPublicShape = (supplier: any) => ({
  ...supplier,
  paymentMethod: supplier.paymentMethod ?? '',
  paymentTerms: supplier.paymentTerms ?? '',
  address: supplier.address ?? '',
  mapsUrl: supplier.mapsUrl ?? '',
  _count: supplier._count ?? { repairs: 0 },
})

const readFallbackSuppliers = async () => {
  const settings = await prisma.appSettings.findUnique({
    where: { id: 'app' },
    select: { featureFlags: true },
  })
  const raw = (settings?.featureFlags ?? {}) as Record<string, unknown>
  const list = Array.isArray(raw[SUPPLIERS_FALLBACK_KEY]) ? (raw[SUPPLIERS_FALLBACK_KEY] as any[]) : []
  return list.map((item) =>
    toSupplierPublicShape({
      id: String(item.id ?? ''),
      name: String(item.name ?? ''),
      serviceType: String(item.serviceType ?? ''),
      paymentMethod: String(item.paymentMethod ?? ''),
      paymentTerms: String(item.paymentTerms ?? ''),
      address: String(item.address ?? ''),
      mapsUrl: String(item.mapsUrl ?? ''),
      contactName: String(item.contactName ?? ''),
      contactPhone: String(item.contactPhone ?? ''),
      contactEmail: String(item.contactEmail ?? ''),
      notes: String(item.notes ?? ''),
      isActive: Boolean(item.isActive ?? true),
      createdAt: item.createdAt ?? new Date().toISOString(),
      updatedAt: item.updatedAt ?? new Date().toISOString(),
      _count: { repairs: 0 },
    }),
  )
}

const writeFallbackSuppliers = async (suppliers: any[]) => {
  const current = await prisma.appSettings.findUnique({
    where: { id: 'app' },
    select: { featureFlags: true },
  })
  const flags = (current?.featureFlags ?? {}) as Record<string, unknown>
  const nextFlags = { ...flags, [SUPPLIERS_FALLBACK_KEY]: suppliers }
  if (!current) {
    await prisma.appSettings.create({
      data: {
        id: 'app',
        maintenanceEnabled: false,
        maintenanceMessage: '',
        featureFlags: nextFlags as any,
      },
    })
    return
  }
  await prisma.appSettings.update({
    where: { id: 'app' },
    data: { featureFlags: nextFlags as any },
  })
}

const supportsSupplierExtendedColumns = async (): Promise<boolean> => {
  const now = Date.now()
  const activeSchema = getActiveDbSchema()
  if (
    supplierColumnsSupportCache &&
    supplierColumnsSupportCache.schema === activeSchema &&
    now - supplierColumnsSupportCache.checkedAt < SUPPLIER_COLUMNS_CACHE_MS
  ) {
    return supplierColumnsSupportCache.supported
  }

  try {
    const rows = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND lower(table_name) = lower('Supplier')
    `
    const available = new Set(rows.map((row) => row.column_name))
    const supported = SUPPLIER_EXTENDED_COLUMNS.every((columnName) => available.has(columnName))
    supplierColumnsSupportCache = { checkedAt: now, supported, schema: activeSchema }
    return supported
  } catch {
    return true
  }
}

const readSuppliers = async (supportsExtended: boolean) => {
  if (supportsExtended) {
    const items = await prisma.supplier.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })
    return items.map(toSupplierPublicShape)
  }

  const items = await prisma.supplier.findMany({
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    select: supplierLegacySelect,
  })
  return items.map(toSupplierPublicShape)
}

const readSupplierById = async (supplierId: string, supportsExtended: boolean) => {
  if (supportsExtended) {
    const item = await prisma.supplier.findUnique({
      where: { id: supplierId },
      include: {
        _count: {
          select: { repairs: true },
        },
      },
    })
    return item ? toSupplierPublicShape(item) : null
  }

  const item = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: supplierLegacySelect,
  })
  return item ? toSupplierPublicShape(item) : null
}

router.get('/', async (_req, res) => {
  try {
    const items = await runWithSchemaFailover(async () => {
      const supportsExtended = await supportsSupplierExtendedColumns()
      return readSuppliers(supportsExtended)
    })
    return res.json(items)
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const fallback = await readFallbackSuppliers()
        return res.json(fallback)
      } catch (fallbackError) {
        console.error('Suppliers fallback GET error:', fallbackError)
      }
    }
    console.error('Suppliers GET error:', error)
    return res.status(500).json({ message: 'No se pudieron cargar los proveedores.' })
  }
})

router.get('/:id', async (req, res) => {
  const supplierId = req.params.id
  if (!supplierId) {
    return res.status(400).json({ message: 'Id de proveedor requerido.' })
  }
  try {
    const supplier = await runWithSchemaFailover(async () => {
      const supportsExtended = await supportsSupplierExtendedColumns()
      return readSupplierById(supplierId, supportsExtended)
    })
    if (!supplier) {
      return res.status(404).json({ message: 'Proveedor no encontrado.' })
    }
    return res.json(supplier)
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const fallback = await readFallbackSuppliers()
        const supplier = fallback.find((item) => item.id === supplierId)
        if (!supplier) {
          return res.status(404).json({ message: 'Proveedor no encontrado.' })
        }
        return res.json(supplier)
      } catch (fallbackError) {
        console.error('Suppliers fallback GET by id error:', fallbackError)
      }
    }
    console.error('Suppliers GET by id error:', error)
    return res.status(500).json({ message: 'No se pudo cargar la ficha del proveedor.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = supplierSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  try {
    const created = await runWithSchemaFailover(async () => {
      const name = normalize(parsed.data.name)
      const existing = await prisma.supplier.findFirst({
        where: { name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      })
      if (existing) {
        return 'DUPLICATE' as const
      }

      const supportsExtended = await supportsSupplierExtendedColumns()
      const createData: Record<string, unknown> = {
        name,
        serviceType: normalize(parsed.data.serviceType),
        contactName: normalize(parsed.data.contactName),
        contactPhone: normalize(parsed.data.contactPhone),
        contactEmail: normalize(parsed.data.contactEmail),
        notes: normalize(parsed.data.notes),
        isActive: parsed.data.isActive,
      }

      if (supportsExtended) {
        createData.paymentMethod = normalize(parsed.data.paymentMethod)
        createData.paymentTerms = normalize(parsed.data.paymentTerms)
        createData.address = normalize(parsed.data.address)
        createData.mapsUrl = normalize(parsed.data.mapsUrl)
      }

      return supportsExtended
        ? prisma.supplier.create({
            data: createData as any,
            include: {
              _count: {
                select: { repairs: true },
              },
            },
          })
        : prisma.supplier.create({
            data: createData as any,
            select: supplierLegacySelect,
          })
    })

    if (created === 'DUPLICATE') {
      return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
    }
    return res.status(201).json(toSupplierPublicShape(created))
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const fallback = await readFallbackSuppliers()
        const name = normalize(parsed.data.name)
        const exists = fallback.some((item) => normalize(item.name).toLowerCase() === name.toLowerCase())
        if (exists) {
          return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
        }
        const now = new Date().toISOString()
        const created = toSupplierPublicShape({
          id: createSupplierId(),
          name,
          serviceType: normalize(parsed.data.serviceType),
          paymentMethod: normalize(parsed.data.paymentMethod),
          paymentTerms: normalize(parsed.data.paymentTerms),
          address: normalize(parsed.data.address),
          mapsUrl: normalize(parsed.data.mapsUrl),
          contactName: normalize(parsed.data.contactName),
          contactPhone: normalize(parsed.data.contactPhone),
          contactEmail: normalize(parsed.data.contactEmail),
          notes: normalize(parsed.data.notes),
          isActive: parsed.data.isActive,
          createdAt: now,
          updatedAt: now,
          _count: { repairs: 0 },
        })
        await writeFallbackSuppliers([created, ...fallback])
        return res.status(201).json(created)
      } catch (fallbackError) {
        console.error('Suppliers fallback POST error:', fallbackError)
      }
    }
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
    const current = await prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } })
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
        select: { id: true },
      })
      if (conflict) {
        return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
      }
    }

    const supportsExtended = await supportsSupplierExtendedColumns()
    const updateData: Record<string, unknown> = {
      name: nextName,
      serviceType: parsed.data.serviceType !== undefined ? normalize(parsed.data.serviceType) : undefined,
      contactName: parsed.data.contactName !== undefined ? normalize(parsed.data.contactName) : undefined,
      contactPhone: parsed.data.contactPhone !== undefined ? normalize(parsed.data.contactPhone) : undefined,
      contactEmail: parsed.data.contactEmail !== undefined ? normalize(parsed.data.contactEmail) : undefined,
      notes: parsed.data.notes !== undefined ? normalize(parsed.data.notes) : undefined,
      isActive: parsed.data.isActive,
    }

    if (supportsExtended) {
      updateData.paymentMethod = parsed.data.paymentMethod !== undefined ? normalize(parsed.data.paymentMethod) : undefined
      updateData.paymentTerms = parsed.data.paymentTerms !== undefined ? normalize(parsed.data.paymentTerms) : undefined
      updateData.address = parsed.data.address !== undefined ? normalize(parsed.data.address) : undefined
      updateData.mapsUrl = parsed.data.mapsUrl !== undefined ? normalize(parsed.data.mapsUrl) : undefined
    }

    const updated = supportsExtended
      ? await prisma.supplier.update({
          where: { id: supplierId },
          data: updateData as any,
          include: {
            _count: {
              select: { repairs: true },
            },
          },
        })
      : await prisma.supplier.update({
          where: { id: supplierId },
          data: updateData as any,
          select: supplierLegacySelect,
        })

    if (nextName !== current.name) {
      await prisma.repairRecord.updateMany({
        where: { supplierId: supplierId },
        data: { supplierName: nextName },
      })
    }

    return res.json(toSupplierPublicShape(updated))
  } catch (error) {
    if (isSchemaMismatchError(error)) {
      try {
        const fallback = await readFallbackSuppliers()
        const current = fallback.find((item) => item.id === supplierId)
        if (!current) {
          return res.status(404).json({ message: 'Proveedor no encontrado.' })
        }
        const nextName =
          parsed.data.name !== undefined && normalize(parsed.data.name)
            ? normalize(parsed.data.name)
            : current.name
        const conflict = fallback.find(
          (item) => item.id !== supplierId && normalize(item.name).toLowerCase() === nextName.toLowerCase(),
        )
        if (conflict) {
          return res.status(409).json({ message: 'Ya existe un proveedor con ese nombre.' })
        }
        const updated = toSupplierPublicShape({
          ...current,
          ...parsed.data,
          name: nextName,
          serviceType: parsed.data.serviceType !== undefined ? normalize(parsed.data.serviceType) : current.serviceType,
          paymentMethod:
            parsed.data.paymentMethod !== undefined ? normalize(parsed.data.paymentMethod) : current.paymentMethod,
          paymentTerms:
            parsed.data.paymentTerms !== undefined ? normalize(parsed.data.paymentTerms) : current.paymentTerms,
          address: parsed.data.address !== undefined ? normalize(parsed.data.address) : current.address,
          mapsUrl: parsed.data.mapsUrl !== undefined ? normalize(parsed.data.mapsUrl) : current.mapsUrl,
          contactName: parsed.data.contactName !== undefined ? normalize(parsed.data.contactName) : current.contactName,
          contactPhone:
            parsed.data.contactPhone !== undefined ? normalize(parsed.data.contactPhone) : current.contactPhone,
          contactEmail:
            parsed.data.contactEmail !== undefined ? normalize(parsed.data.contactEmail) : current.contactEmail,
          notes: parsed.data.notes !== undefined ? normalize(parsed.data.notes) : current.notes,
          updatedAt: new Date().toISOString(),
        })
        await writeFallbackSuppliers(fallback.map((item) => (item.id === supplierId ? updated : item)))
        return res.json(updated)
      } catch (fallbackError) {
        console.error('Suppliers fallback PATCH error:', fallbackError)
      }
    }
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
    const supportsExtended = await supportsSupplierExtendedColumns()
    const current = supportsExtended
      ? await prisma.supplier.findUnique({
          where: { id: supplierId },
          include: {
            _count: {
              select: { repairs: true },
            },
          },
        })
      : await prisma.supplier.findUnique({
          where: { id: supplierId },
          select: supplierLegacySelect,
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
    if (isSchemaMismatchError(error)) {
      try {
        const fallback = await readFallbackSuppliers()
        const current = fallback.find((item) => item.id === supplierId)
        if (!current) {
          return res.status(404).json({ message: 'Proveedor no encontrado.' })
        }
        await writeFallbackSuppliers(fallback.filter((item) => item.id !== supplierId))
        return res.status(204).send()
      } catch (fallbackError) {
        console.error('Suppliers fallback DELETE error:', fallbackError)
      }
    }
    console.error('Suppliers DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el proveedor.' })
  }
})

export default router
