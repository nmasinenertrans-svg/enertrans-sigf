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

export const getNextSequenceCode = (key: string, prefix: string, unitCode?: string): string => {
  if (typeof window === 'undefined') {
    return formatSequenceCode(prefix, 0, unitCode)
  }

  const storageKey = `enertrans.seq.${key}`
  let next = 1

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (raw) {
      const parsed = Number(raw)
      if (!Number.isNaN(parsed) && parsed >= 0) {
        next = parsed + 1
      }
    }
    window.localStorage.setItem(storageKey, String(next))
  } catch {
    // ignore
  }

  return formatSequenceCode(prefix, next, unitCode)
}
