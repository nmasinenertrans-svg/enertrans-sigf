import type { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { AuditRecord, FleetUnit } from '../../../types/domain'
import { CAMION_ITEMS, HIDROGUA_SECTIONS, statusLabelMap, type ChecklistItem } from './auditsService'

interface AuditPdfPayload {
  audit: AuditRecord
  unit?: FleetUnit
}

const fetchImageAsDataUrl = async (url: string): Promise<string> => {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error('No se pudo descargar el logo.')
  }
  const blob = await response.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(new Error('No se pudo leer el logo.'))
  reader.readAsDataURL(blob)
  })
}

const resolvePhotoDataUrl = async (value: string): Promise<string | null> => {
  if (!value) {
    return null
  }
  if (value.startsWith('data:image')) {
    return value
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      return await fetchImageAsDataUrl(value)
    } catch {
      return null
    }
  }
  return null
}

const applyOpacity = (pdf: jsPDF, opacity: number): (() => void) => {
  const anyPdf = pdf as unknown as { GState?: new (state: { opacity: number }) => unknown; setGState?: (state: unknown) => void }
  const setGState = anyPdf.setGState
  if (anyPdf.GState && typeof setGState === 'function') {
    const previous = new anyPdf.GState({ opacity: 1 })
    const next = new anyPdf.GState({ opacity })
    setGState(next)
    return () => setGState(previous)
  }
  return () => {}
}

const drawHeader = (pdf: jsPDF, logoDataUrl: string | null, title: string, subtitle: string) => {
  const pageWidth = pdf.internal.pageSize.getWidth()
  pdf.setFillColor(242, 201, 76)
  pdf.rect(0, 0, pageWidth, 18, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(17, 24, 39)
  pdf.text(title, 14, 8)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(subtitle, 14, 13)

  if (logoDataUrl) {
    pdf.addImage(logoDataUrl, 'PNG', pageWidth - 30, 3.5, 16, 12)
  }
}

const addWatermark = (pdf: jsPDF, logoDataUrl: string | null) => {
  if (!logoDataUrl) {
    return
  }
  const resetOpacity = applyOpacity(pdf, 0.08)
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const size = Math.min(pageWidth, pageHeight) * 0.7
  const x = (pageWidth - size) / 2
  const y = (pageHeight - size) / 2
  pdf.addImage(logoDataUrl, 'PNG', x, y, size, size, undefined, 'FAST')
  resetOpacity()
}

const drawInfoRow = (pdf: jsPDF, label: string, value: string, x: number, y: number, color?: [number, number, number]) => {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)
  pdf.text(label, x, y)
  pdf.setFont('helvetica', 'normal')
  if (color) {
    pdf.setTextColor(...color)
  } else {
    pdf.setTextColor(17, 24, 39)
  }
  pdf.text(value, x + 18, y)
}

const drawTableHeader = (pdf: jsPDF, columns: { label: string; width: number }[], x: number, y: number, height: number) => {
  pdf.setFillColor(242, 201, 76)
  pdf.rect(x, y, columns.reduce((acc, col) => acc + col.width, 0), height, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)

  let cursor = x + 2
  columns.forEach((col) => {
    pdf.text(col.label, cursor, y + 5.2)
    cursor += col.width
  })
}

const drawRowBorders = (pdf: jsPDF, columns: { width: number }[], x: number, y: number, height: number) => {
  pdf.setDrawColor(210, 210, 210)
  pdf.rect(x, y, columns.reduce((acc, col) => acc + col.width, 0), height)
  let cursor = x
  columns.forEach((col) => {
    cursor += col.width
    pdf.line(cursor, y, cursor, y + height)
  })
}

export const exportAuditPdf = async ({ audit, unit }: AuditPdfPayload): Promise<void> => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)
  drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Inspeccion de Flota')

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let cursorY = 26

  const resultColor: [number, number, number] = audit.result === 'APPROVED' ? [16, 185, 129] : [220, 38, 38]

  drawInfoRow(pdf, 'Unidad:', unit?.internalCode ?? 'N/D', 14, cursorY)
  drawInfoRow(pdf, 'Resultado:', audit.result === 'APPROVED' ? 'APROBADO' : 'RECHAZADO', pageWidth - 60, cursorY, resultColor)
  cursorY += 5
  drawInfoRow(pdf, 'Fecha:', new Date(audit.performedAt).toLocaleString(), 14, cursorY)
  cursorY += 4
  drawInfoRow(pdf, 'Auditor:', audit.auditorName, 14, cursorY)
  cursorY += 4
  drawInfoRow(pdf, 'KM:', String(audit.unitKilometers ?? 0), 14, cursorY)
  drawInfoRow(pdf, 'Hs Motor:', String(audit.engineHours ?? 0), 48, cursorY)
  drawInfoRow(pdf, 'Hs Grua:', String(audit.hydroHours ?? 0), 85, cursorY)
  cursorY += 6

  const columns = [
    { label: 'Item', width: 90 },
    { label: 'Estado', width: 25 },
    { label: 'Observacion', width: pageWidth - 14 - 14 - 115 },
  ]

  const statusColorMap: Record<string, [number, number, number]> = {
    OK: [16, 185, 129],
    BAD: [220, 38, 38],
    NA: [100, 116, 139],
  }

  audit.checklistSections.forEach((section) => {
    if (cursorY > pageHeight - 30) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Inspeccion de Flota')
      cursorY = 26
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(17, 24, 39)
    pdf.text(section.title.toUpperCase(), 14, cursorY)
    cursorY += 3

    drawTableHeader(pdf, columns, 14, cursorY, 6)
    cursorY += 6

    section.items.forEach((item) => {
      if (cursorY > pageHeight - 16) {
        pdf.addPage()
        addWatermark(pdf, logoDataUrl)
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Inspeccion de Flota')
        cursorY = 26
        drawTableHeader(pdf, columns, 14, cursorY, 6)
        cursorY += 6
      }

      const rowHeight = 6
      drawRowBorders(pdf, columns, 14, cursorY, rowHeight)

      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(17, 24, 39)
      pdf.text(item.label, 16, cursorY + 4)

      const statusLabel = statusLabelMap[item.status]
      const statusColor = statusColorMap[item.status] ?? [17, 24, 39]
      pdf.setTextColor(...statusColor)
      pdf.text(statusLabel, 14 + columns[0].width + 2, cursorY + 4)

      pdf.setTextColor(17, 24, 39)
      pdf.text(item.observation || '-', 14 + columns[0].width + columns[1].width + 2, cursorY + 4)

      cursorY += rowHeight
    })

    cursorY += 6
  })

  const photoCandidates = Array.isArray(audit.photoBase64List) ? audit.photoBase64List : []
  const photoDataUrls = (
    await Promise.all(photoCandidates.map((value) => resolvePhotoDataUrl(value)))
  ).filter((value): value is string => Boolean(value))

  if (photoDataUrls.length > 0) {
    if (cursorY > pageHeight - 40) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Inspeccion de Flota')
      cursorY = 26
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(17, 24, 39)
    pdf.text('EVIDENCIAS FOTOGRAFICAS', 14, cursorY)
    cursorY += 6

    const maxWidth = pageWidth - 28
    const columnWidth = (maxWidth - 6) / 2
    const imageHeight = 45
    let col = 0

    for (let index = 0; index < photoDataUrls.length; index += 1) {
      if (cursorY + imageHeight > pageHeight - 15) {
        pdf.addPage()
        addWatermark(pdf, logoDataUrl)
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Inspeccion de Flota')
        cursorY = 26
        col = 0
      }

      const x = 14 + col * (columnWidth + 6)
      pdf.addImage(photoDataUrls[index], 'JPEG', x, cursorY, columnWidth, imageHeight, undefined, 'FAST')

      if (col === 1) {
        cursorY += imageHeight + 6
        col = 0
      } else {
        col = 1
      }
    }
  }

  pdf.save(`Inspeccion_${audit.id}_${unit?.internalCode ?? 'unidad'}.pdf`)
}

const drawBlankInfoField = (pdf: jsPDF, label: string, x: number, y: number, lineWidth: number) => {
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)
  pdf.text(label, x, y)
  pdf.setDrawColor(120, 120, 120)
  pdf.line(x + 22, y + 0.5, x + lineWidth, y + 0.5)
}

const drawChecklistTableHeader = (pdf: jsPDF, x: number, y: number, itemColWidth: number, boxWidth: number) => {
  const totalWidth = itemColWidth + boxWidth * 3
  pdf.setFillColor(242, 201, 76)
  pdf.rect(x, y, totalWidth, 6, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)
  pdf.text('ITEM', x + 2, y + 4.2)
  pdf.text('B', x + itemColWidth + boxWidth / 2 - 1.5, y + 4.2)
  pdf.text('OBS.', x + itemColWidth + boxWidth + boxWidth / 2 - 3, y + 4.2)
  pdf.text('N/A', x + itemColWidth + boxWidth * 2 + boxWidth / 2 - 3, y + 4.2)
}

const drawChecklistItemRow = (
  pdf: jsPDF,
  item: ChecklistItem,
  x: number,
  y: number,
  itemColWidth: number,
  boxWidth: number,
  rowHeight: number,
) => {
  pdf.setDrawColor(210, 210, 210)
  pdf.rect(x, y, itemColWidth + boxWidth * 3, rowHeight)
  pdf.line(x + itemColWidth, y, x + itemColWidth, y + rowHeight)
  pdf.line(x + itemColWidth + boxWidth, y, x + itemColWidth + boxWidth, y + rowHeight)
  pdf.line(x + itemColWidth + boxWidth * 2, y, x + itemColWidth + boxWidth * 2, y + rowHeight)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7.5)
  pdf.setTextColor(17, 24, 39)
  pdf.text(`[${item.code}] ${item.desc}`, x + 2, y + rowHeight / 2 + 1.3, { maxWidth: itemColWidth - 4 })

  const boxSize = 3
  const boxY = y + (rowHeight - boxSize) / 2
  pdf.setDrawColor(120, 120, 120)
  pdf.rect(x + itemColWidth + boxWidth / 2 - boxSize / 2, boxY, boxSize, boxSize)
  pdf.rect(x + itemColWidth + boxWidth + boxWidth / 2 - boxSize / 2, boxY, boxSize, boxSize)
  pdf.rect(x + itemColWidth + boxWidth * 2 + boxWidth / 2 - boxSize / 2, boxY, boxSize, boxSize)
}

const drawLinesBox = (pdf: jsPDF, x: number, y: number, width: number, height: number, rowHeight = 6) => {
  pdf.setDrawColor(150, 150, 150)
  pdf.rect(x, y, width, height)
  for (let lineY = y + rowHeight; lineY < y + height; lineY += rowHeight) {
    pdf.line(x, lineY, x + width, lineY)
  }
}

/**
 * Checklist en blanco (sin datos de ninguna inspeccion puntual) para imprimir
 * en papel y completar a mano — mismos items que usa el sistema al crear una
 * inspeccion nueva de tipo Camion o Hidrogrua.
 */
export const exportBlankAuditChecklistPdf = async (checklistType: 'CAMION' | 'HIDROGUA'): Promise<void> => {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  const subtitle =
    checklistType === 'HIDROGUA' ? 'Checklist de Inspección — Hidrogrúa (en blanco)' : 'Checklist de Inspección — Camión (en blanco)'

  addWatermark(pdf, logoDataUrl)
  drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', subtitle)

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let cursorY = 26

  drawBlankInfoField(pdf, 'Cliente:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'Lugar:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 6
  drawBlankInfoField(pdf, 'Vehículo:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'Dominio:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 6
  drawBlankInfoField(pdf, 'Hidrogrúa:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'N° Serie:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 6
  drawBlankInfoField(pdf, 'Kilometraje:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'Horómetro:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 6
  drawBlankInfoField(pdf, 'Hs. Hidrogrúa:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'Fecha:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 6
  drawBlankInfoField(pdf, 'N° Inspección:', 14, cursorY, 90)
  drawBlankInfoField(pdf, 'Realizado por:', 110, cursorY, pageWidth - 14 - 110)
  cursorY += 9

  const boxWidth = 12
  const itemColWidth = pageWidth - 14 - 14 - boxWidth * 3
  const rowHeight = 6

  const sections: { title: string; items: ChecklistItem[] }[] =
    checklistType === 'HIDROGUA'
      ? HIDROGUA_SECTIONS.map((section) => ({ title: section.name, items: section.items }))
      : [{ title: 'INSPECCIÓN TÉCNICA DEL VEHÍCULO', items: CAMION_ITEMS }]

  sections.forEach((section) => {
    if (cursorY > pageHeight - 30) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', subtitle)
      cursorY = 26
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(17, 24, 39)
    pdf.text(section.title.toUpperCase(), 14, cursorY)
    cursorY += 3

    drawChecklistTableHeader(pdf, 14, cursorY, itemColWidth, boxWidth)
    cursorY += 6

    section.items.forEach((item) => {
      if (cursorY > pageHeight - 16) {
        pdf.addPage()
        addWatermark(pdf, logoDataUrl)
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', subtitle)
        cursorY = 26
        drawChecklistTableHeader(pdf, 14, cursorY, itemColWidth, boxWidth)
        cursorY += 6
      }

      drawChecklistItemRow(pdf, item, 14, cursorY, itemColWidth, boxWidth, rowHeight)
      cursorY += rowHeight
    })

    cursorY += 6
  })

  const obsBoxHeight = 30
  if (cursorY > pageHeight - (obsBoxHeight + 40)) {
    pdf.addPage()
    addWatermark(pdf, logoDataUrl)
    drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', subtitle)
    cursorY = 26
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(17, 24, 39)
  pdf.text('OBSERVACIONES', 14, cursorY)
  cursorY += 4
  drawLinesBox(pdf, 14, cursorY, pageWidth - 28, obsBoxHeight, 6)
  cursorY += obsBoxHeight + 8

  if (cursorY > pageHeight - 24) {
    pdf.addPage()
    addWatermark(pdf, logoDataUrl)
    drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', subtitle)
    cursorY = 26
  }

  const sigY = Math.max(cursorY + 12, pageHeight - 24)
  pdf.setDrawColor(60, 60, 60)
  pdf.line(15, sigY, pageWidth / 2 - 10, sigY)
  pdf.line(pageWidth / 2 + 10, sigY, pageWidth - 15, sigY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)
  pdf.text('Realizado por', 15, sigY - 2)
  pdf.text('Aceptado por', pageWidth / 2 + 10, sigY - 2)

  const fileSuffix = checklistType === 'HIDROGUA' ? 'Hidrogrua' : 'Camion'
  pdf.save(`Checklist_Inspeccion_${fileSuffix}_en_blanco.pdf`)
}

