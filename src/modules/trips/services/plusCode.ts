import { OpenLocationCode } from 'open-location-code'

const olc = new OpenLocationCode()

// Un Plus Code (Open Location Code de Google) con o sin prefijo de grilla,
// opcionalmente seguido de una localidad de referencia separada por coma o
// espacio — ej. "7VGW+5H, Punta Colorada, Rio Negro" o "849VCWC8+R9".
const PLUS_CODE_PATTERN = /^([23456789CFGHJMPQRVWX]{2,8}\+[23456789CFGHJMPQRVWX]{0,3})(?:[,\s]+(.+))?$/i

export interface PlusCodeMatch {
  code: string
  isShortCode: boolean
  referenceQuery: string
}

export const parsePlusCodeSearch = (value: string): PlusCodeMatch | null => {
  const trimmed = value.trim()
  const match = trimmed.match(PLUS_CODE_PATTERN)
  if (!match) {
    return null
  }
  const code = match[1].toUpperCase()
  if (!olc.isValid(code)) {
    return null
  }
  return {
    code,
    isShortCode: olc.isShort(code),
    referenceQuery: (match[2] ?? '').trim(),
  }
}

export const decodePlusCode = (code: string, referenceLat: number, referenceLng: number): { lat: number; lng: number } => {
  const fullCode = olc.isFull(code) ? code : olc.recoverNearest(code, referenceLat, referenceLng)
  const area = olc.decode(fullCode)
  return { lat: area.latitudeCenter, lng: area.longitudeCenter }
}
