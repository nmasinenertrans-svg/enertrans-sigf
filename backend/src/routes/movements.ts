import { Router } from 'express'
import { z } from 'zod'
import pdfParse from 'pdf-parse'
import { prisma } from '../db.js'
import type { AuthenticatedRequest } from '../middleware/auth.js'
import { getNextSequence } from '../utils/sequence.js'

const router = Router()

const movementSchema = z.object({
  unitIds: z.array(z.string().min(1)).min(1),
  movementType: z.enum(['ENTRY', 'RETURN']),
  remitoNumber: z.string().optional().default(''),
  remitoDate: z.string().optional().default(''),
  clientName: z.string().optional().default(''),
  workLocation: z.string().optional().default(''),
  equipmentDescription: z.string().optional().default(''),
  observations: z.string().optional().default(''),
  deliveryContactName: z.string().optional().default(''),
  deliveryContactDni: z.string().optional().default(''),
  deliveryContactSector: z.string().optional().default(''),
  deliveryContactRole: z.string().optional().default(''),
  receiverContactName: z.string().optional().default(''),
  receiverContactDni: z.string().optional().default(''),
  receiverContactSector: z.string().optional().default(''),
  receiverContactRole: z.string().optional().default(''),
  pdfFileName: z.string().optional().default(''),
  pdfFileUrl: z.string().optional().default(''),
  parsedPayload: z.any().optional(),
})

const parseSchema = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  dataUrl: z.string().min(10),
})

const movementUpdateSchema = z.object({
  unitIds: z.array(z.string().min(1)).min(1).optional(),
  movementType: z.enum(['ENTRY', 'RETURN']).optional(),
  remitoNumber: z.string().optional(),
  remitoDate: z.string().optional(),
  clientName: z.string().optional(),
  workLocation: z.string().optional(),
  equipmentDescription: z.string().optional(),
  observations: z.string().optional(),
  deliveryContactName: z.string().optional(),
  deliveryContactDni: z.string().optional(),
  deliveryContactSector: z.string().optional(),
  deliveryContactRole: z.string().optional(),
  receiverContactName: z.string().optional(),
  receiverContactDni: z.string().optional(),
  receiverContactSector: z.string().optional(),
  receiverContactRole: z.string().optional(),
  pdfFileName: z.string().optional(),
  pdfFileUrl: z.string().optional(),
  parsedPayload: z.any().optional(),
})

const formatRemitoNumber = (value: number) => `R-${String(value).padStart(7, '0')}`

const resolveNextRemitoNumber = async (): Promise<string> => {
  const current = await prisma.sequence.findUnique({
    where: { key: 'remito' },
    select: { value: true },
  })
  return formatRemitoNumber((current?.value ?? 0) + 1)
}

const normalizeLine = (value: string) => value.replace(/\s+/g, ' ').trim()

const extractByLabel = (lines: string[], label: string) => {
  const regex = new RegExp(`${label}\\s*:?\\s*(.+)`, 'i')
  const line = lines.find((item) => regex.test(item))
  if (!line) {
    return ''
  }
  const match = line.match(regex)
  return normalizeLine(match?.[1] ?? '')
}

const extractRemitoNumber = (text: string) => {
  const match = text.match(/REM(?:I|Í)TO\s*N[°º]?\s*([0-9-]+)/i)
  return match ? normalizeLine(match[1]) : ''
}

const extractDate = (text: string) => {
  const match = text.match(/Fecha:\s*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i)
  if (match) {
    return normalizeLine(match[1])
  }
  const loose = text.match(/([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/)
  return loose ? normalizeLine(loose[1]) : ''
}

const toIsoDate = (value: string) => {
  const cleaned = value.trim()
  const datePrefix = cleaned.match(/^(\d{4}-\d{1,2}-\d{1,2})/)?.[1] ?? cleaned
  const isoMatch = datePrefix.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dmyMatch = datePrefix.match(/^(\d{1,2})[\/\-.]+(\d{1,2})[\/\-.]+(\d{2,4})$/)
  if (!isoMatch && !dmyMatch) {
    return ''
  }

  const day = Number(isoMatch ? isoMatch[3] : dmyMatch?.[1])
  const month = Number(isoMatch ? isoMatch[2] : dmyMatch?.[2])
  let year = Number(isoMatch ? isoMatch[1] : dmyMatch?.[3])
  if (year < 100) {
    year += 2000
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return ''
  }
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

const toDateForStorage = (value: string): Date | undefined => {
  const isoDate = toIsoDate(value)
  if (!isoDate) {
    return undefined
  }
  const date = new Date(`${isoDate}T12:00:00.000Z`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

const resolveAuthorizedRole = async (req: AuthenticatedRequest): Promise<'DEV' | 'GERENTE' | null> => {
  const userId = req.userId
  if (!userId) {
    return null
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  if (!user) {
    return null
  }
  if (user.role === 'DEV' || user.role === 'GERENTE') {
    return user.role
  }
  return null
}

const parseRemitoText = (rawText: string) => {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => normalizeLine(line))
    .filter(Boolean)

  const remitoNumber = extractRemitoNumber(rawText)
  const remitoDate = toIsoDate(extractDate(rawText))
  const clientName = extractByLabel(lines, 'CLIENTE')
  const workLocation = extractByLabel(lines, 'LUGAR DE TRABAJO')
  const equipmentDescription = extractByLabel(lines, 'EQUIPO')
  const observations = extractByLabel(lines, 'Observaciones')

  return {
    remitoNumber,
    remitoDate,
    clientName,
    workLocation,
    equipmentDescription,
    observations,
    rawText,
  }
}

router.get('/', async (_req, res) => {
  try {
    const items = await prisma.fleetMovement.findMany({
      orderBy: { createdAt: 'desc' },
      include: { units: { select: { unitId: true } } },
    })
    const mapped = items.map((item) => ({
      ...item,
      unitIds: item.units.map((unit) => unit.unitId),
    }))
    return res.json(mapped)
  } catch {
    return res.status(500).json({ message: 'No se pudieron cargar los movimientos.' })
  }
})

router.get('/next-remito', async (_req, res) => {
  try {
    const remitoNumber = await resolveNextRemitoNumber()
    return res.json({ remitoNumber })
  } catch {
    return res.status(500).json({ message: 'No se pudo calcular el siguiente remito.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = movementSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const remitoDateValue = parsed.data.remitoDate?.trim()
  const remitoDate = remitoDateValue ? toDateForStorage(remitoDateValue) : undefined
  if (remitoDateValue && !remitoDate) {
    return res.status(400).json({ message: 'Fecha de remito invalida.' })
  }

  try {
    const remitoNumber = formatRemitoNumber(await getNextSequence('remito'))
    const created = await prisma.fleetMovement.create({
      data: {
        movementType: parsed.data.movementType,
        remitoNumber,
        remitoDate: remitoDate ?? undefined,
        clientName: parsed.data.clientName?.trim() ?? '',
        workLocation: parsed.data.workLocation?.trim() ?? '',
        equipmentDescription: parsed.data.equipmentDescription?.trim() ?? '',
        observations: parsed.data.observations?.trim() ?? '',
        deliveryContactName: parsed.data.deliveryContactName?.trim() ?? '',
        deliveryContactDni: parsed.data.deliveryContactDni?.trim() ?? '',
        deliveryContactSector: parsed.data.deliveryContactSector?.trim() ?? '',
        deliveryContactRole: parsed.data.deliveryContactRole?.trim() ?? '',
        receiverContactName: parsed.data.receiverContactName?.trim() ?? '',
        receiverContactDni: parsed.data.receiverContactDni?.trim() ?? '',
        receiverContactSector: parsed.data.receiverContactSector?.trim() ?? '',
        receiverContactRole: parsed.data.receiverContactRole?.trim() ?? '',
        pdfFileName: parsed.data.pdfFileName ?? '',
        pdfFileUrl: parsed.data.pdfFileUrl ?? '',
        parsedPayload: parsed.data.parsedPayload ?? undefined,
        units: {
          create: parsed.data.unitIds.map((unitId) => ({ unitId })),
        },
      },
      include: { units: { select: { unitId: true } } },
    })
    return res.status(201).json({
      ...created,
      unitIds: created.units.map((unit) => unit.unitId),
    })
  } catch (error) {
    console.error('Movements POST error:', error)
    return res.status(500).json({ message: 'No se pudo crear el movimiento.' })
  }
})

router.post('/parse', async (req, res) => {
  const parsed = parseSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const { dataUrl } = parsed.data
  const base64Index = dataUrl.indexOf('base64,')
  const base64 = base64Index >= 0 ? dataUrl.slice(base64Index + 7) : dataUrl

  try {
    const buffer = Buffer.from(base64, 'base64')
    const result = await pdfParse(buffer)
    const parsedData = parseRemitoText(result.text ?? '')
    return res.json({ ...parsedData, pages: result.numpages ?? 0 })
  } catch {
    return res.json({
      remitoNumber: '',
      remitoDate: '',
      clientName: '',
      workLocation: '',
      equipmentDescription: '',
      observations: '',
      rawText: '',
      error: 'No se pudo leer el PDF automáticamente.',
    })
  }
})

router.patch('/:id', async (req: AuthenticatedRequest, res) => {
  const role = await resolveAuthorizedRole(req)
  if (!role) {
    return res.status(403).json({ message: 'Solo DEV y GERENTE pueden editar remitos.' })
  }

  const rawMovementId = req.params.id
  const movementId = Array.isArray(rawMovementId) ? rawMovementId[0] : rawMovementId
  if (!movementId) {
    return res.status(400).json({ message: 'Id de movimiento requerido.' })
  }

  const parsed = movementUpdateSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const remitoDateValue = parsed.data.remitoDate?.trim()
  const remitoDate = remitoDateValue ? toDateForStorage(remitoDateValue) : undefined
  const normalizedRemitoDate = remitoDateValue ? remitoDate : undefined
  if (remitoDateValue && !normalizedRemitoDate) {
    return res.status(400).json({ message: 'Fecha de remito invalida.' })
  }

  try {
    await prisma.fleetMovement.update({
      where: { id: movementId },
      data: {
        movementType: parsed.data.movementType,
        remitoNumber: parsed.data.remitoNumber?.trim(),
        remitoDate: remitoDateValue ? remitoDate : undefined,
        clientName: parsed.data.clientName?.trim(),
        workLocation: parsed.data.workLocation?.trim(),
        equipmentDescription: parsed.data.equipmentDescription?.trim(),
        observations: parsed.data.observations?.trim(),
        deliveryContactName: parsed.data.deliveryContactName?.trim(),
        deliveryContactDni: parsed.data.deliveryContactDni?.trim(),
        deliveryContactSector: parsed.data.deliveryContactSector?.trim(),
        deliveryContactRole: parsed.data.deliveryContactRole?.trim(),
        receiverContactName: parsed.data.receiverContactName?.trim(),
        receiverContactDni: parsed.data.receiverContactDni?.trim(),
        receiverContactSector: parsed.data.receiverContactSector?.trim(),
        receiverContactRole: parsed.data.receiverContactRole?.trim(),
        pdfFileName: parsed.data.pdfFileName?.trim(),
        pdfFileUrl: parsed.data.pdfFileUrl?.trim(),
        parsedPayload: parsed.data.parsedPayload,
        units: parsed.data.unitIds
          ? {
              deleteMany: {},
              create: parsed.data.unitIds.map((unitId) => ({ unitId })),
            }
          : undefined,
      },
    })

    const updated = await prisma.fleetMovement.findUnique({
      where: { id: movementId },
      include: { units: { select: { unitId: true } } },
    })
    if (!updated) {
      return res.status(404).json({ message: 'Movimiento no encontrado.' })
    }

    return res.json({
      ...updated,
      unitIds: updated.units.map((unit) => unit.unitId),
    })
  } catch (error) {
    console.error('Movements PATCH error:', error)
    return res.status(500).json({ message: 'No se pudo editar el movimiento.' })
  }
})

router.delete('/:id', async (req: AuthenticatedRequest, res) => {
  const rawMovementId = req.params.id
  const movementId = Array.isArray(rawMovementId) ? rawMovementId[0] : rawMovementId
  if (!movementId) {
    return res.status(400).json({ message: 'Id de movimiento requerido.' })
  }

  try {
    const role = await resolveAuthorizedRole(req)
    if (!role) {
      return res.status(403).json({ message: 'Solo DEV y GERENTE pueden eliminar remitos.' })
    }

    await prisma.fleetMovement.delete({
      where: { id: movementId },
    })

    return res.status(204).send()
  } catch (error) {
    console.error('Movements DELETE error:', error)
    return res.status(500).json({ message: 'No se pudo eliminar el movimiento.' })
  }
})

export default router
