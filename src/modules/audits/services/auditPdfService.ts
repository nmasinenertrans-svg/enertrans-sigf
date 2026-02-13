import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { AuditRecord, FleetUnit } from '../../../types/domain'
import { statusLabelMap } from './auditsService'

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

const applyOpacity = (pdf: jsPDF, opacity: number): (() => void) => {
  const anyPdf = pdf as unknown as { GState?: new (state: { opacity: number }) => unknown; setGState?: (state: unknown) => void }
  if (anyPdf.GState && typeof anyPdf.setGState === 'function') {
    const previous = new anyPdf.GState({ opacity: 1 })
    const next = new anyPdf.GState({ opacity })
    anyPdf.setGState(next)
    return () => anyPdf.setGState(previous)
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
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)
  drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Auditoria de Flota')

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
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Auditoria de Flota')
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
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Reporte Tecnico de Auditoria de Flota')
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

  pdf.save(`Auditoria_${audit.id}_${unit?.internalCode ?? 'unidad'}.pdf`)
}
