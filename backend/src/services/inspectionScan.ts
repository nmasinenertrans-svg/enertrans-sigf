import { CAMION_ITEMS, HIDROGUA_ITEMS } from './inspectionCatalog.js'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-5'

export interface ScanHeader {
  dominio: string
  fecha: string | null
  km: number | null
  hs: number | null
  hidrogrua: string
  cliente: string
  lugarDeTrabajo: string
}

export type ScanStatus = 'OK' | 'BAD' | 'NA'

export interface ScanMatchedItem {
  itemCode: string
  status: ScanStatus
  observation: string
}

export interface ScanUnmatchedNote {
  label: string
  status: ScanStatus
}

export interface ScanResult {
  header: ScanHeader
  checklistType: 'CAMION' | 'HIDROGUA'
  matchedItems: ScanMatchedItem[]
  unmatchedNotes: ScanUnmatchedNote[]
  overallConfidence: 'HIGH' | 'LOW'
}

const buildPrompt = (): string => {
  const camion = CAMION_ITEMS.map((item) => `${item.code}: ${item.desc}`).join('\n')
  const hidro = HIDROGUA_ITEMS.map((item) => `${item.code}: ${item.desc}`).join('\n')

  return `Sos un asistente que lee UNA hoja de una planilla de "INSPECCION DE EQUIPO EN CAMPO" escrita a mano por operarios de Enertrans (empresa de transporte y logistica con hidrogruas), y devolves UNICAMENTE un JSON valido (sin bloque de markdown, sin texto adicional antes o despues) con esta forma exacta:

{
  "header": { "dominio": string, "fecha": string o null (formato YYYY-MM-DD), "km": number o null, "hs": number o null, "hidrogrua": string, "cliente": string, "lugarDeTrabajo": string },
  "checklistType": "CAMION" o "HIDROGUA",
  "matchedItems": [ { "itemCode": string, "status": "OK" o "BAD" o "NA", "observation": string } ],
  "unmatchedNotes": [ { "label": string, "status": "OK" o "BAD" o "NA" } ],
  "overallConfidence": "HIGH" o "LOW"
}

Si algun dato del header no aparece en esta hoja puntual, dejalo en null o string vacio -- no lo inventes.

La planilla tiene una tabla "CHECK LIST" con columnas B (bien) y OBS (con problema) para estas categorias generales: Nivel de fluidos, Perdida de fluidos, Documentacion, Carroceria, Opticas y faros, Sist. Iluminacion, Equipamiento, Interior, Parabrisa y crist., Cubiertas, Auxilio, Hidrogrua. Debajo tiene una seccion "OBSERVACIONES" con notas manuscritas, generalmente una por linea, con problemas puntuales encontrados.

"checklistType": usa "HIDROGUA" solo si la planilla es especificamente sobre certificacion/inspeccion tecnica de la hidrogrua en si (pluma, gancho, estabilizadores, etc). Para cualquier inspeccion general de la unidad/camion, usa "CAMION".

Tenes que mapear cada marca de la tabla CHECK LIST y cada linea de OBSERVACIONES contra el catalogo de items de abajo (usa el "itemCode" EXACTO tal cual aparece, ej. "A-05"). Si una marca o una observacion corresponde con confianza a UNO o MAS items del catalogo, agregala a "matchedItems" con ese itemCode y el status que corresponda: "BAD" si hay un problema anotado ahi, "OK" si esta marcado B sin problema, "NA" si la planilla dice explicitamente que no aplica. Copia el texto de la observacion manuscrita (si la hay) en el campo "observation" de ese item.

Si una linea de OBSERVACIONES NO tiene ningun item claramente correspondiente en el catalogo (ej. datos que no son de un item puntual, o un problema que el catalogo no cubre), agregala tal cual a "unmatchedNotes" en vez de forzarla dentro de un item que no corresponde bien. No inventes ni repitas informacion. No dejes afuera ninguna observacion de esta hoja: cada linea manuscrita de OBSERVACIONES tiene que terminar en matchedItems O en unmatchedNotes, nunca perdida.

Si en general no podes mapear con confianza la mayor parte del contenido de esta hoja contra el catalogo, poné "overallConfidence": "LOW" (aun asi completá matchedItems con lo que si estes seguro, y el resto en unmatchedNotes). Si pudiste mapear la mayoria con confianza, poné "HIGH".

Catalogo CAMION:
${camion}

Catalogo HIDROGUA:
${hidro}

Devolve SOLO el JSON.`
}

const parseDataUrl = (dataUrl: string): { mediaType: string; base64Data: string } => {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Imagen invalida.')
  }
  return { mediaType: match[1], base64Data: match[2] }
}

// Una hoja a la vez: pedirle a la IA que combine varias fotos en una sola
// respuesta hacia que esa respuesta creciera mucho en planillas complejas y
// se cortara por limite de tokens. Mandando una imagen por pedido, cada
// respuesta queda acotada al contenido de UNA hoja y nunca se corta, sin
// importar cuantas fotos se suban. El merge de las hojas se hace aca abajo.
const scanSingleImage = async (dataUrl: string, apiKey: string): Promise<ScanResult> => {
  const { mediaType, base64Data } = parseDataUrl(dataUrl)

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 8192,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
            { type: 'text', text: buildPrompt() },
          ],
        },
      ],
    }),
  })

  if (!response.ok) {
    const detail = await response.text()
    throw new Error(`Error de la IA de vision (${response.status}): ${detail.slice(0, 300)}`)
  }

  const data = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>
    stop_reason?: string
  }
  const text = data.content?.find((block) => block.type === 'text')?.text ?? ''
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  try {
    return JSON.parse(cleaned) as ScanResult
  } catch {
    // La IA a veces agrega algun texto antes/despues del JSON pese a la
    // instruccion de devolver solo JSON -- probamos recortar hasta las
    // llaves externas antes de rendirnos.
    const firstBrace = cleaned.indexOf('{')
    const lastBrace = cleaned.lastIndexOf('}')
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as ScanResult
      } catch {
        // sigue sin poder parsear, cae al error de abajo
      }
    }

    console.error('Inspection scan: respuesta no parseable. stop_reason=', data.stop_reason, 'texto:', cleaned.slice(0, 2000))

    if (data.stop_reason === 'max_tokens') {
      throw new Error('La IA se quedo sin espacio de respuesta leyendo una hoja. Proba con una foto mas clara o recortada solo al contenido de la planilla.')
    }
    throw new Error('No se pudo interpretar la respuesta de la IA.')
  }
}

const firstNonEmpty = <T,>(values: (T | null | undefined)[]): T | null => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== ('' as unknown as T)) {
      return value
    }
  }
  return null
}

const statusSeverity: Record<ScanStatus, number> = { BAD: 2, NA: 1, OK: 0 }

const mergePageResults = (pages: ScanResult[]): ScanResult => {
  if (pages.length === 1) {
    return pages[0]
  }

  const header: ScanHeader = {
    dominio: firstNonEmpty(pages.map((p) => p.header?.dominio)) ?? '',
    fecha: firstNonEmpty(pages.map((p) => p.header?.fecha)),
    km: firstNonEmpty(pages.map((p) => p.header?.km)),
    hs: firstNonEmpty(pages.map((p) => p.header?.hs)),
    hidrogrua: firstNonEmpty(pages.map((p) => p.header?.hidrogrua)) ?? '',
    cliente: firstNonEmpty(pages.map((p) => p.header?.cliente)) ?? '',
    lugarDeTrabajo: firstNonEmpty(pages.map((p) => p.header?.lugarDeTrabajo)) ?? '',
  }

  // Si alguna hoja identifico HIDROGUA, se prioriza (es la mas especifica).
  const checklistType = pages.some((p) => p.checklistType === 'HIDROGUA') ? 'HIDROGUA' : 'CAMION'

  const matchedByCode = new Map<string, ScanMatchedItem>()
  pages.forEach((page) => {
    page.matchedItems?.forEach((item) => {
      const existing = matchedByCode.get(item.itemCode)
      if (!existing) {
        matchedByCode.set(item.itemCode, item)
        return
      }
      // Nos quedamos con el status mas "grave" y la observacion mas larga
      // entre las hojas que mencionan el mismo item.
      const merged: ScanMatchedItem = {
        itemCode: item.itemCode,
        status: statusSeverity[item.status] > statusSeverity[existing.status] ? item.status : existing.status,
        observation: item.observation.length > existing.observation.length ? item.observation : existing.observation,
      }
      matchedByCode.set(item.itemCode, merged)
    })
  })

  const unmatchedNotes = pages.flatMap((page) => page.unmatchedNotes ?? [])
  const overallConfidence: 'HIGH' | 'LOW' = pages.some((p) => p.overallConfidence === 'LOW') ? 'LOW' : 'HIGH'

  return {
    header,
    checklistType,
    matchedItems: Array.from(matchedByCode.values()),
    unmatchedNotes,
    overallConfidence,
  }
}

export const scanInspectionImages = async (dataUrls: string[]): Promise<ScanResult> => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY no configurada en el servidor.')
  }
  if (dataUrls.length === 0) {
    throw new Error('No se recibio ninguna imagen.')
  }

  const pageResults = await Promise.all(dataUrls.map((dataUrl) => scanSingleImage(dataUrl, apiKey)))
  return mergePageResults(pageResults)
}
