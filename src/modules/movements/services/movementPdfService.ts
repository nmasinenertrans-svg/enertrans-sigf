import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { FleetMovement, FleetUnit } from '../../../types/domain'
import { formatMovementDateForView, normalizeRemitoDateInput } from './movementsService'

interface MovementPdfPayload {
  movement: FleetMovement
  units: FleetUnit[]
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

const drawLinesBox = (pdf: jsPDF, x: number, y: number, width: number, height: number, rowHeight = 6) => {
  pdf.setDrawColor(150, 150, 150)
  pdf.rect(x, y, width, height)
  for (let lineY = y + rowHeight; lineY < y + height; lineY += rowHeight) {
    pdf.line(x, lineY, x + width, lineY)
  }
}

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

const formatDate = (value?: string) => {
  if (!value) return ''
  const normalized = normalizeRemitoDateInput(value)
  if (normalized) {
    return formatMovementDateForView(normalized)
  }
  return formatMovementDateForView(value)
}

export const exportMovementPdf = async ({ movement, units }: MovementPdfPayload): Promise<void> => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const selectedUnits = units.filter((unit) => movement.unitIds.includes(unit.id))
  const firstUnit = selectedUnits[0]

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
  pdf.text('REMITO', pageWidth - 55, 18)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(10)
  pdf.text(`N° ${safeText(movement.remitoNumber) || movement.id.slice(0, 8)}`, pageWidth - 55, 24)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Fecha: ${formatDate(movement.remitoDate ?? movement.createdAt) || '-'}`, pageWidth - 55, 31)
  pdf.text('DOCUMENTO NO VALIDO COMO FACTURA', pageWidth - 72, 12)

  let y = 42
  pdf.setDrawColor(120, 120, 120)
  pdf.rect(10, y, pageWidth - 20, 22)
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'bold')
  pdf.text('CLIENTE:', 12, y + 5)
  pdf.text('C.U.I.T.:', 85, y + 5)
  pdf.text('TELEFONO:', 135, y + 5)
  pdf.text('LUGAR DE TRABAJO:', 12, y + 12)
  pdf.text('EQUIPO:', 12, y + 19)
  pdf.setFont('helvetica', 'normal')
  pdf.text(safeText(movement.clientName) || firstUnit?.clientName || '-', 30, y + 5)
  pdf.text('-', 101, y + 5)
  pdf.text('-', 152, y + 5)
  pdf.text(safeText(movement.workLocation) || '-', 42, y + 12)
  pdf.text(safeText(movement.equipmentDescription) || '-', 23, y + 19)

  y += 28
  const tableX = 10
  const qtyW = 22
  const tableW = pageWidth - 20
  const descW = tableW - qtyW
  const headerH = 6
  const bodyH = 94
  pdf.setFillColor(242, 242, 242)
  pdf.rect(tableX, y, tableW, headerH, 'F')
  pdf.rect(tableX, y, qtyW, headerH)
  pdf.rect(tableX + qtyW, y, descW, headerH)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('CANTIDAD', tableX + 2, y + 4)
  pdf.text('DESCRIPCION', tableX + qtyW + 2, y + 4)
  drawLinesBox(pdf, tableX, y + headerH, qtyW, bodyH)
  drawLinesBox(pdf, tableX + qtyW, y + headerH, descW, bodyH)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.text(String(Math.max(selectedUnits.length, 1)), tableX + 6, y + headerH + 7)

  const descriptionLines: string[] = []
  const mainDesc = safeText(movement.equipmentDescription)
  if (mainDesc) descriptionLines.push(mainDesc)
  selectedUnits.forEach((unit) => {
    descriptionLines.push(`Dominio: ${unit.internalCode}`)
    if (safeText(unit.chassisNumber)) descriptionLines.push(`Nro Chasis: ${unit.chassisNumber}`)
    if (safeText(unit.engineNumber)) descriptionLines.push(`Nro Motor: ${unit.engineNumber}`)
    if (unit.hasHydroCrane) {
      const hydroLabel = [safeText(unit.hydroCraneBrand), safeText(unit.hydroCraneModel)].filter(Boolean).join(' ')
      descriptionLines.push(`Hidrogrua: ${hydroLabel || 'Si'}`)
      if (safeText(unit.hydroCraneSerialNumber)) {
        descriptionLines.push(`Nro Serie Hidrogrua: ${unit.hydroCraneSerialNumber}`)
      }
    }
  })
  if (!descriptionLines.length) {
    descriptionLines.push('Sin descripcion')
  }
  const wrapped = pdf.splitTextToSize(descriptionLines.join('\n'), descW - 4)
  pdf.text(wrapped, tableX + qtyW + 2, y + headerH + 7)

  y += headerH + bodyH + 6
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('Observaciones:', 12, y)
  pdf.setFont('helvetica', 'normal')
  const obsY = y + 4
  drawLinesBox(pdf, 10, obsY - 2, pageWidth - 20, 24)
  const obsLines = pdf.splitTextToSize(safeText(movement.observations) || '-', pageWidth - 26)
  pdf.text(obsLines, 12, obsY + 3)

  const sigY = Math.min(pageHeight - 36, obsY + 36)
  pdf.setDrawColor(60, 60, 60)
  pdf.line(15, sigY, pageWidth / 2 - 10, sigY)
  pdf.line(pageWidth / 2 + 10, sigY, pageWidth - 15, sigY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('FIRMA ENTREGA', 15, sigY - 2)
  pdf.text('FIRMA RECEPCION', pageWidth / 2 + 10, sigY - 2)

  const leftY = sigY + 6
  const rightX = pageWidth / 2 + 10
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)

  pdf.text(`Nombre y Apellido: ${safeText(movement.deliveryContactName) || '-'}`, 15, leftY)
  pdf.text(`DNI: ${safeText(movement.deliveryContactDni) || '-'}`, 15, leftY + 5)
  pdf.text(`Sector: ${safeText(movement.deliveryContactSector) || '-'}`, 15, leftY + 10)
  pdf.text(`Cargo: ${safeText(movement.deliveryContactRole) || '-'}`, 15, leftY + 15)

  pdf.text(`Nombre y Apellido: ${safeText(movement.receiverContactName) || '-'}`, rightX, leftY)
  pdf.text(`DNI: ${safeText(movement.receiverContactDni) || '-'}`, rightX, leftY + 5)
  pdf.text(`Sector: ${safeText(movement.receiverContactSector) || '-'}`, rightX, leftY + 10)
  pdf.text(`Cargo: ${safeText(movement.receiverContactRole) || '-'}`, rightX, leftY + 15)

  const fileCode = safeText(movement.remitoNumber) || movement.id.slice(0, 8)
  pdf.save(`Remito_${fileCode}.pdf`)
}
