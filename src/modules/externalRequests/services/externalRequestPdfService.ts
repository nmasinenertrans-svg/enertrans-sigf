import type { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { ExternalRequest, ExternalRequestChecklistItem, FleetUnit } from '../../../types/domain'

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
  const { jsPDF } = await import('jspdf')
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

export const exportPurchaseOrderPdf = async ({ request, unit }: ExternalRequestPdfPayload): Promise<void> => {
  const { jsPDF: JsPDF } = await import('jspdf')
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)

  const pageWidth = pdf.internal.pageSize.getWidth()

  // Header OC (fondo verde oscuro para distinguir de NDP)
  pdf.setFillColor(15, 118, 110)
  pdf.rect(0, 0, pageWidth, 22, 'F')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(13)
  pdf.setTextColor(255, 255, 255)
  pdf.text('ENERTRANS S.R.L.', 14, 9)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text('Orden de compra', 14, 15)
  if (logoDataUrl) {
    try { pdf.addImage(logoDataUrl, 'PNG', pageWidth - 34, 4, 20, 14) } catch { /* ignore */ }
  }

  let cursorY = 30
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(17, 24, 39)
  pdf.text('ORDEN DE COMPRA', pageWidth / 2, cursorY, { align: 'center' })

  cursorY += 8
  const infoBoxTop = cursorY
  pdf.setDrawColor(217, 217, 217)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(12, infoBoxTop - 5, pageWidth - 24, 18, 3, 3, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text('Dominio', 18, infoBoxTop + 2)
  pdf.text('N° OC', 80, infoBoxTop + 2)
  pdf.text('Fecha', 140, infoBoxTop + 2)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(unit?.internalCode ?? 'N/D', 18, infoBoxTop + 8)
  pdf.text(request.ocCode ?? '-', 80, infoBoxTop + 8)
  pdf.text(
    new Date(request.ocGeneratedAt ?? request.createdAt ?? new Date().toISOString()).toLocaleDateString('es-AR'),
    140,
    infoBoxTop + 8,
  )
  cursorY = infoBoxTop + 22

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text('Proveedor', 18, cursorY)
  pdf.text('NDP de origen', 100, cursorY)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(request.companyName || '-', 18, cursorY + 5)
  pdf.text(request.code, 100, cursorY + 5)
  cursorY += 13

  // Descripción
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.text('Descripcion', 14, cursorY)
  cursorY += 4
  const descLines = pdf.splitTextToSize(request.description || '-', pageWidth - 28)
  const descHeight = Math.max(12, descLines.length * 4 + 4)
  pdf.setDrawColor(217, 217, 217)
  pdf.roundedRect(12, cursorY - 3, pageWidth - 24, descHeight + 4, 3, 3, 'S')
  pdf.setFont('helvetica', 'normal')
  pdf.text(descLines, 16, cursorY + 3)
  cursorY += descHeight + 8

  // Tabla de repuestos con precios
  const currency = request.currency ?? 'ARS'
  const moneyFmt = new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-AR', { style: 'currency', currency })
  const partsItems = Array.isArray(request.partsItems) ? request.partsItems : []

  if (partsItems.length > 0) {
    const tableLeft = 12
    const tableWidth = pageWidth - 24
    const colWidths = [tableWidth * 0.45, tableWidth * 0.12, tableWidth * 0.2, tableWidth * 0.23]
    const colX = [
      tableLeft,
      tableLeft + colWidths[0],
      tableLeft + colWidths[0] + colWidths[1],
      tableLeft + colWidths[0] + colWidths[1] + colWidths[2],
    ]
    const rowH = 7

    pdf.setFillColor(15, 118, 110)
    pdf.rect(tableLeft, cursorY, tableWidth, rowH, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    pdf.text('Descripcion', colX[0] + 2, cursorY + 5)
    pdf.text('Cant', colX[1] + 2, cursorY + 5)
    pdf.text('P. Unit.', colX[2] + 2, cursorY + 5)
    pdf.text('Total', colX[3] + 2, cursorY + 5)
    cursorY += rowH

    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(31, 41, 55)
    partsItems.forEach((item, index) => {
      const bg = index % 2 === 0 ? [249, 250, 251] : [255, 255, 255]
      pdf.setFillColor(bg[0], bg[1], bg[2])
      pdf.rect(tableLeft, cursorY, tableWidth, rowH, 'F')
      pdf.setDrawColor(217, 217, 217)
      pdf.rect(tableLeft, cursorY, tableWidth, rowH, 'S')
      pdf.setFontSize(8)
      const descItem = pdf.splitTextToSize(item.description, colWidths[0] - 4)
      pdf.text(descItem[0] ?? '', colX[0] + 2, cursorY + 5)
      pdf.text(String(item.quantity), colX[1] + 2, cursorY + 5)
      pdf.text(moneyFmt.format(item.unitPrice), colX[2] + 2, cursorY + 5)
      pdf.text(moneyFmt.format(item.lineTotal ?? item.quantity * item.unitPrice), colX[3] + 2, cursorY + 5)
      cursorY += rowH
    })

    // Total general
    const total = partsItems.reduce((acc, item) => acc + (item.lineTotal ?? item.quantity * item.unitPrice), 0)
    pdf.setFillColor(15, 118, 110)
    pdf.rect(tableLeft, cursorY, tableWidth, rowH, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(255, 255, 255)
    pdf.text('TOTAL', colX[0] + 2, cursorY + 5)
    pdf.text(moneyFmt.format(total), colX[3] + 2, cursorY + 5)
    cursorY += rowH + 8
  }

  // Presupuesto adjunto
  if (request.providerFileName) {
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(75, 85, 99)
    pdf.text('Presupuesto adjunto:', 14, cursorY)
    pdf.setFont('helvetica', 'normal')
    pdf.setTextColor(17, 24, 39)
    pdf.text(request.providerFileName, 60, cursorY)
    cursorY += 10
  }

  // Firmas
  const signatureY = Math.max(cursorY + 10, 245)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.line(20, signatureY, 80, signatureY)
  pdf.line(pageWidth - 80, signatureY, pageWidth - 20, signatureY)
  pdf.text('APRUEBA', 40, signatureY + 6)
  pdf.text('PROVEEDOR', pageWidth - 55, signatureY + 6)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(107, 114, 128)
  pdf.text('ENERTRANS • Orden de compra', 14, pdf.internal.pageSize.getHeight() - 8)

  pdf.save(`OrdenCompra_${request.ocCode ?? request.code}_${unit?.internalCode ?? 'unidad'}.pdf`)
}

// Check de re-inspeccion de una NDP (por ahora solo se genera para Enermet,
// ver externalRequestsService.ts) -- mismo criterio B/O/NA que el checklist
// real de Inspecciones. Es un PDF para imprimir y dejar como registro en
// papel (firmado a mano), no queda subido/guardado en ningun lado -- si ya
// tiene marcas cargadas se imprimen tal cual, si no, las casillas quedan en
// blanco para completar a mano.
export const exportReinspectionChecklistPdf = async ({ request, unit }: ExternalRequestPdfPayload): Promise<void> => {
  const { jsPDF: JsPDF } = await import('jspdf')
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  const pageWidth = pdf.internal.pageSize.getWidth()

  const drawChecklistHeader = () => {
    pdf.setFillColor(79, 70, 229)
    pdf.rect(0, 0, pageWidth, 22, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(13)
    pdf.setTextColor(255, 255, 255)
    pdf.text('ENERTRANS S.R.L.', 14, 9)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Check de re-inspeccion', 14, 15)
    if (logoDataUrl) {
      try {
        pdf.addImage(logoDataUrl, 'PNG', pageWidth - 34, 4, 20, 14)
      } catch {
        // ignore
      }
    }
  }

  addWatermark(pdf, logoDataUrl)
  drawChecklistHeader()

  let cursorY = 30
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.setTextColor(17, 24, 39)
  pdf.text('CHECK DE RE-INSPECCION', pageWidth / 2, cursorY, { align: 'center' })

  cursorY += 8
  const infoBoxTop = cursorY
  pdf.setDrawColor(217, 217, 217)
  pdf.setFillColor(255, 255, 255)
  pdf.roundedRect(12, infoBoxTop - 5, pageWidth - 24, 18, 3, 3, 'FD')
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(75, 85, 99)
  pdf.text('Dominio', 18, infoBoxTop + 2)
  pdf.text('NDP', 80, infoBoxTop + 2)
  pdf.text('Proveedor', 140, infoBoxTop + 2)
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(unit?.internalCode ?? 'N/D', 18, infoBoxTop + 8)
  pdf.text(request.code, 80, infoBoxTop + 8)
  pdf.text(request.companyName || '-', 140, infoBoxTop + 8)

  cursorY = infoBoxTop + 22

  const items: ExternalRequestChecklistItem[] =
    Array.isArray(request.reinspectionChecklist) && request.reinspectionChecklist.length > 0
      ? request.reinspectionChecklist
      : request.tasks.map((task, index) => ({ id: `blank-${index}`, label: task, status: '', note: '' }))

  const tableLeft = 12
  const tableWidth = pageWidth - 24
  const colNum = 10
  const colBox = 12
  const colObs = 46
  const colLabel = tableWidth - colNum - colBox * 3 - colObs
  const headerH = 8

  const drawTableHeader = (y: number) => {
    pdf.setFillColor(79, 70, 229)
    pdf.rect(tableLeft, y, tableWidth, headerH, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(255, 255, 255)
    let x = tableLeft
    pdf.text('#', x + 2, y + 5.5)
    x += colNum
    pdf.text('Item / tarea', x + 2, y + 5.5)
    x += colLabel
    pdf.text('B', x + colBox / 2, y + 5.5, { align: 'center' })
    x += colBox
    pdf.text('O', x + colBox / 2, y + 5.5, { align: 'center' })
    x += colBox
    pdf.text('NA', x + colBox / 2, y + 5.5, { align: 'center' })
    x += colBox
    pdf.text('Observacion', x + 2, y + 5.5)
  }

  drawTableHeader(cursorY)
  let rowY = cursorY + headerH
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(31, 41, 55)

  items.forEach((item, index) => {
    const labelLines = pdf.splitTextToSize(item.label || '-', colLabel - 4)
    const obsLines = pdf.splitTextToSize(item.note || '', colObs - 4)
    const blockHeight = Math.max(8, Math.max(labelLines.length, obsLines.length) * 4 + 3)

    if (rowY + blockHeight > 250) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawChecklistHeader()
      rowY = 30
      drawTableHeader(rowY)
      rowY += headerH
      pdf.setFont('helvetica', 'normal')
      pdf.setTextColor(31, 41, 55)
    }

    let x = tableLeft
    pdf.setDrawColor(217, 217, 217)
    pdf.rect(x, rowY, colNum, blockHeight)
    pdf.text(String(index + 1), x + 2, rowY + 5)
    x += colNum
    pdf.rect(x, rowY, colLabel, blockHeight)
    pdf.text(labelLines, x + 2, rowY + 5)
    x += colLabel
    ;(['B', 'O', 'NA'] as const).forEach((statusValue) => {
      pdf.rect(x, rowY, colBox, blockHeight)
      if (item.status === statusValue) {
        pdf.setFont('helvetica', 'bold')
        pdf.text('X', x + colBox / 2, rowY + blockHeight / 2 + 1.5, { align: 'center' })
        pdf.setFont('helvetica', 'normal')
      }
      x += colBox
    })
    pdf.rect(x, rowY, colObs, blockHeight)
    pdf.text(obsLines, x + 2, rowY + 5)

    rowY += blockHeight
  })

  cursorY = rowY + 4
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor(107, 114, 128)
  pdf.text('B = Bien   O = Observacion   NA = No aplica', tableLeft, cursorY)

  const signatureY = Math.max(cursorY + 20, 250)
  pdf.setDrawColor(60, 60, 60)
  pdf.line(20, signatureY, 90, signatureY)
  pdf.line(pageWidth - 90, signatureY, pageWidth - 20, signatureY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.setTextColor(17, 24, 39)
  pdf.text('REVISO', 45, signatureY + 6)
  pdf.text('FECHA', pageWidth - 65, signatureY + 6)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(107, 114, 128)
  pdf.text('ENERTRANS • Check de re-inspeccion', 14, pdf.internal.pageSize.getHeight() - 8)

  pdf.save(`Check_${request.code}_${unit?.internalCode ?? 'unidad'}.pdf`)
}
