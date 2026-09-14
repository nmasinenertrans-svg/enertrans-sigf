import type { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { FleetUnit, ServiceOrder } from '../../../types/domain'

// os.createdAt y os.estimatedResolutionAt son timestamps reales (momento
// exacto, no un campo "solo dia"), asi que se muestran en horario local con
// fecha+hora -- no usar formatDateOnly de utils/dateOnly.ts aca, ese es para
// el otro tipo de campo (vencimientos, fechas sin hora).
const formatDateTime = (value?: string | null): string => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

interface ServiceOrderPdfPayload {
  os: ServiceOrder
  unit?: FleetUnit | null
}

const ORIGIN_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE_CALL: 'Llamada telefónica',
  WHATSAPP: 'WhatsApp',
  INTERNAL_INSPECTION: 'Inspección interna',
}

const fetchImageAsDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url)
  if (!response.ok) throw new Error('No se pudo descargar el logo.')
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'))
    reader.readAsDataURL(blob)
  })
}

const safeText = (value?: string | null) => (value ?? '').trim()

const applyOpacity = (pdf: jsPDF, opacity: number): (() => void) => {
  const anyPdf = pdf as unknown as { GState?: new (state: { opacity: number }) => unknown; setGState?: (state: unknown) => void }
  if (anyPdf.GState && typeof anyPdf.setGState === 'function') {
    const prev = new anyPdf.GState({ opacity: 1 })
    const next = new anyPdf.GState({ opacity })
    anyPdf.setGState(next)
    return () => anyPdf.setGState?.(prev)
  }
  return () => {}
}

const addWatermark = (pdf: jsPDF, logoDataUrl: string | null) => {
  if (!logoDataUrl) return
  const reset = applyOpacity(pdf, 0.08)
  const w = pdf.internal.pageSize.getWidth()
  const h = pdf.internal.pageSize.getHeight()
  const size = Math.min(w, h) * 0.62
  try {
    pdf.addImage(logoDataUrl, 'PNG', (w - size) / 2, (h - size) / 2, size, size, undefined, 'FAST')
  } catch {
    // ignore
  }
  reset()
}

const drawField = (pdf: jsPDF, label: string, value: string, x: number, y: number, width: number): number => {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(120, 120, 120)
  pdf.text(label.toUpperCase(), x, y)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(11)
  pdf.setTextColor(17, 24, 39)
  const lines = pdf.splitTextToSize(value || '-', width)
  pdf.text(lines, x, y + 6)
  return y + 6 + lines.length * 5.5
}

// Genera el PDF (camion, cliente, ubicacion, que se solicito, quien lo va a
// realizar) y devuelve el data URI listo para subir con /files/upload -- no
// hace pdf.save() aca porque el llamador lo sube y lo deja guardado en la OS
// (pdfFileUrl), no es una descarga suelta.
export const generateServiceOrderPdf = async ({ os, unit }: ServiceOrderPdfPayload): Promise<{ dataUrl: string; fileName: string }> => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)

  const pageWidth = pdf.internal.pageSize.getWidth()

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(17, 24, 39)
  pdf.text('ENERTRANS S.R.L.', 44, 14)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.text('Direccion: Valentin Gomez N° 577', 44, 19)
  pdf.text('Haedo (1706) - Bs. As. - Argentina', 44, 23)
  pdf.text('Tel. (011) 4483-2061', 44, 27)
  pdf.text('contacto@enertrans.com.ar', 44, 31)

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', 10, 8, 30, 30)
    } catch {
      // ignore
    }
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('ORDEN DE SERVICIO', pageWidth - 70, 18)
  pdf.setFontSize(10)
  pdf.text(os.code, pageWidth - 70, 24)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Fecha: ${formatDateTime(os.createdAt)}`, pageWidth - 70, 30)

  let y = 42
  const marginX = 12
  const fieldWidth = pageWidth - marginX * 2

  const unitLabel = unit
    ? `${unit.internalCode} — ${unit.brand} ${unit.model}`
    : os.externalVehicle
      ? os.externalVehicle
      : '-'
  y = drawField(pdf, 'Camion / Unidad', unitLabel, marginX, y, fieldWidth) + 6

  const clientLabel = os.client?.name || os.clientName || '-'
  y = drawField(pdf, 'Cliente', clientLabel, marginX, y, fieldWidth) + 6

  const locationLabel = safeText(unit?.location) || '-'
  y = drawField(pdf, 'Ubicacion', locationLabel, marginX, y, fieldWidth) + 6

  const requestedLabel = `${ORIGIN_LABELS[os.claimOrigin] ?? os.claimOrigin} — ${safeText(os.reportedFault) || '-'}`
  y = drawField(pdf, 'Que se solicito', requestedLabel, marginX, y, fieldWidth) + 6

  const assignedLabel = safeText(os.assignedToName) || 'Sin asignar'
  y = drawField(pdf, 'Quien lo va a realizar', assignedLabel, marginX, y, fieldWidth) + 6

  if (os.estimatedResolutionAt) {
    drawField(pdf, 'Fecha estimada de resolucion', formatDateTime(os.estimatedResolutionAt), marginX, y, fieldWidth)
  }

  const dataUrl = pdf.output('datauristring')
  return { dataUrl, fileName: `OS_${os.code}.pdf` }
}
