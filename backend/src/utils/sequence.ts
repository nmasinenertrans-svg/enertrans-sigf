import { prisma } from '../db.js'

export const getNextSequence = async (key: string): Promise<number> => {
  const result = await prisma.sequence.upsert({
    where: { key },
    create: { key, value: 1 },
    update: { value: { increment: 1 } },
  })

  return result.value
}

export const normalizeUnitCode = (value?: string): string => {
  if (!value) {
    return ''
  }
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const formatCode = (prefix: string, value: number, unitCode?: string): string => {
  const normalizedUnit = normalizeUnitCode(unitCode)
  if (normalizedUnit) {
    return `${prefix}-${normalizedUnit}-${String(value).padStart(5, '0')}`
  }
  return `${prefix}-${String(value).padStart(5, '0')}`
}
