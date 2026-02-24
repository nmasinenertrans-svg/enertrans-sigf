import { Router } from 'express'
import { z } from 'zod'
import pdfParse from 'pdf-parse'
import { prisma } from '../db.js'

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
  const match = cleaned.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/)
  if (!match) {
    return cleaned
  }
  const day = Number(match[1])
  const month = Number(match[2])
  let year = Number(match[3])
  if (year < 100) {
    year += 2000
  }
  const date = new Date(year, month - 1, day)
  if (Number.isNaN(date.getTime())) {
    return cleaned
  }
  return date.toISOString().slice(0, 10)
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
  } catch (error) {
    return res.status(500).json({ message: 'No se pudieron cargar los movimientos.' })
  }
})

router.post('/', async (req, res) => {
  const parsed = movementSchema.safeParse(req.body)
  if (!parsed.success) {
    return res.status(400).json({ message: 'Datos invalidos.' })
  }

  const remitoDateValue = parsed.data.remitoDate?.trim()
  const remitoDate = remitoDateValue ? new Date(toIsoDate(remitoDateValue)) : undefined

  try {
    const created = await prisma.fleetMovement.create({
      data: {
        movementType: parsed.data.movementType,
        remitoNumber: parsed.data.remitoNumber?.trim() ?? '',
        remitoDate: remitoDate && !Number.isNaN(remitoDate.getTime()) ? remitoDate : undefined,
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
  } catch (error) {
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

export default router
