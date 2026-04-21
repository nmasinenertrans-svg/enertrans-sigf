const pad = (value: number) => value.toString().padStart(5, '0')

export const normalizeUnitCode = (value?: string): string => {
  if (!value) {
    return ''
  }
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

export const parseSequenceNumber = (code?: string): number | null => {
  if (!code) {
    return null
  }
  const parts = code.split('-')
  const last = parts[parts.length - 1]
  const parsed = Number(last)
  if (!Number.isFinite(parsed)) {
    return null
  }
  return parsed
}

export const formatSequenceCode = (prefix: string, value: number, unitCode?: string): string => {
  const normalizedUnit = normalizeUnitCode(unitCode)
  if (normalizedUnit) {
    return `${prefix}-${normalizedUnit}-${pad(value)}`
  }
  return `${prefix}-${pad(value)}`
}

export const getNextSequenceCode = (key: string, prefix: string, unitCode?: string, existingCodes?: string[]): string => {
  if (typeof window === 'undefined') {
    return formatSequenceCode(prefix, 0, unitCode)
  }

  const storageKey = `enertrans.seq.${key}`
  let next = 1

  try {
    const maxFromExisting = existingCodes
      ? existingCodes.reduce((max, code) => {
          const n = parseSequenceNumber(code)
          return n !== null && n > max ? n : max
        }, 0)
      : 0

    const raw = window.localStorage.getItem(storageKey)
    const fromStorage = raw ? Number(raw) : 0
    const base = Math.max(fromStorage, maxFromExisting)
    next = base + 1

    window.localStorage.setItem(storageKey, String(next))
  } catch {
    // ignore
  }

  return formatSequenceCode(prefix, next, unitCode)
}
