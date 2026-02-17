import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { ExternalRequest, FleetUnit } from '../../../types/domain'

interface ExternalRequestPdfPayload {
  request: ExternalRequest
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
  const setGState = anyPdf.setGState
  if (anyPdf.GState && typeof setGState === 'function') {
    const previous = new anyPdf.GState({ opacity: 1 })
    const next = new anyPdf.GState({ opacity })
    setGState(next)
    return () => setGState(previous)
  }
  return () => {}
}

const drawHeader = (pdf: jsPDF, logoDataUrl: string | null) => {
  const pageWidth = pdf.internal.pageSize.getWidth()
  pdf.setFillColor(242, 201, 76)
  pdf.rect(0, 0, pageWidth, 22, 'F')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(17, 24, 39)
  pdf.text('ENERTRANS S.R.L.', 14, 9)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text('Nota de pedido externo', 14, 15)

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', pageWidth - 34, 4, 20, 14)
    } catch {
      // ignore
    }
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
  try {
    pdf.addImage(logoDataUrl, 'PNG', x, y, size, size, undefined, 'FAST')
  } catch {
    // ignore
  }
  resetOpacity()
}

export const exportExternalRequestPdf = async ({ request, unit }: ExternalRequestPdfPayload): Promise<void> => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)
  drawHeader(pdf, logoDataUrl)

  const pageWidth = pdf.internal.pageSize.getWidth()
  let cursorY = 30

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(17, 24, 39)
  pdf.text('NOTA DE PEDIDO', pageWidth / 2, cursorY, { align: 'center' })

  cursorY += 8
  const infoBoxTop = cursorY
  const infoBoxHeight = 18
  pdf.setDrawColor(217, 217, 217)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(12, infoBoxTop - 5, pageWidth - 24, infoBoxHeight, 3, 3, 'FD')

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text('Dominio', 18, infoBoxTop + 2)
  pdf.text('Codigo', 80, infoBoxTop + 2)
  pdf.text('Fecha', 140, infoBoxTop + 2)

  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(unit?.internalCode ?? 'N/D', 18, infoBoxTop + 8)
  pdf.text(request.code, 80, infoBoxTop + 8)
  pdf.text(new Date(request.createdAt ?? new Date().toISOString()).toLocaleDateString('es-AR'), 140, infoBoxTop + 8)

  cursorY = infoBoxTop + infoBoxHeight + 4

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text('Empresa', 18, cursorY)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(request.companyName || '-', 18, cursorY + 5)
  cursorY += 12

  pdf.setFont('helvetica', 'bold')
  pdf.text('Descripcion del pedido', 14, cursorY)
  cursorY += 4
  const descriptionLines = pdf.splitTextToSize(request.description || '-', pageWidth - 28)
  const descriptionHeight = Math.max(16, descriptionLines.length * 4 + 4)
  pdf.setDrawColor(217, 217, 217)
  pdf.roundedRect(12, cursorY - 3, pageWidth - 24, descriptionHeight + 4, 3, 3, 'S')
  pdf.setFont('helvetica', 'normal')
  pdf.text(descriptionLines, 16, cursorY + 3)
  cursorY += descriptionHeight + 6

  if (request.providerFileName) {
    pdf.setFont('helvetica', 'bold')
    pdf.text('Adjunto proveedor:', 14, cursorY)
    cursorY += 5
    pdf.setFont('helvetica', 'normal')
    pdf.text(request.providerFileName, 14, cursorY)
    cursorY += 8
  }

  const tableTop = cursorY
  const tableLeft = 12
  const tableWidth = pageWidth - 24
  const colItem = 14
  const colDesc = tableLeft + colItem
  const rowHeight = 7

  pdf.setFillColor(242, 201, 76)
  pdf.rect(tableLeft, tableTop, tableWidth, rowHeight, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(17, 24, 39)
  pdf.text('#', tableLeft + 3, tableTop + 5)
  pdf.text('Trabajo solicitado', colDesc + 2, tableTop + 5)

  let rowY = tableTop + rowHeight
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(31, 41, 55)

  request.tasks.forEach((task, index) => {
    const lines = pdf.splitTextToSize(task, tableWidth - colItem - 8)
    const blockHeight = Math.max(rowHeight, lines.length * 4 + 2)

    if (rowY + blockHeight > 250) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl)
      rowY = 30
      pdf.setFillColor(242, 201, 76)
      pdf.rect(tableLeft, rowY, tableWidth, rowHeight, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setTextColor(17, 24, 39)
      pdf.text('#', tableLeft + 3, rowY + 5)
      pdf.text('Trabajo solicitado', colDesc + 2, rowY + 5)
      rowY += rowHeight
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(31, 41, 55)
    }

    pdf.setDrawColor(217, 217, 217)
    pdf.rect(tableLeft, rowY, colItem, blockHeight)
    pdf.rect(colDesc, rowY, tableWidth - colItem, blockHeight)
    pdf.text(String(index + 1), tableLeft + 3, rowY + 5)
    pdf.text(lines, colDesc + 2, rowY + 5)
    rowY += blockHeight
  })

  cursorY = rowY + 8

  const observacionesTop = Math.min(cursorY + 4, 210)
  pdf.setFont('helvetica', 'bold')
  pdf.text('Observaciones', 14, observacionesTop)
  pdf.setDrawColor(217, 217, 217)
  let lineY = observacionesTop + 6
  for (let i = 0; i < 6; i += 1) {
    pdf.line(14, lineY, pageWidth - 14, lineY)
    lineY += 6
  }

  const signatureY = Math.max(lineY + 6, 240)
  pdf.line(20, signatureY, 80, signatureY)
  pdf.line(pageWidth - 80, signatureY, pageWidth - 20, signatureY)
  pdf.text('SOLICITA', 40, signatureY + 6)
  pdf.text('RECIBE', pageWidth - 50, signatureY + 6)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(107, 114, 128)
  pdf.text('ENERTRANS • Nota de pedido externo', 14, pdf.internal.pageSize.getHeight() - 8)

  pdf.save(`NotaPedido_${request.code}_${unit?.internalCode ?? 'unidad'}.pdf`)
}
