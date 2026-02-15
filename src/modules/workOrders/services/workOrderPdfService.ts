import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { FleetUnit, WorkOrder } from '../../../types/domain'
import { normalizeTaskList, workOrderStatusLabelMap } from './workOrdersService'

interface WorkOrderPdfPayload {
  workOrder: WorkOrder
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
  if (anyPdf.GState && typeof anyPdf.setGState === 'function') {
    const previous = new anyPdf.GState({ opacity: 1 })
    const next = new anyPdf.GState({ opacity })
    anyPdf.setGState(next)
    return () => anyPdf.setGState(previous)
  }
  return () => {}
}

const safeAddImage = (pdf: jsPDF, dataUrl: string, x: number, y: number, width: number, height: number) => {
  try {
    pdf.addImage(dataUrl, 'PNG', x, y, width, height)
  } catch (error) {
    console.warn('No se pudo agregar la imagen al PDF.', error)
  }
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
    safeAddImage(pdf, logoDataUrl, pageWidth - 30, 3.5, 16, 12)
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
  } catch (error) {
    console.warn('No se pudo agregar la marca de agua.', error)
  }
  resetOpacity()
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

const clampText = (pdf: jsPDF, value: unknown, maxWidth: number) => {
  const text = String(value ?? '-')
  const lines = pdf.splitTextToSize(text, maxWidth)
  return Array.isArray(lines) ? String(lines[0] ?? text) : text
}

export const exportWorkOrderPdf = async ({ workOrder, unit }: WorkOrderPdfPayload): Promise<void> => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  addWatermark(pdf, logoDataUrl)
  drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')

  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  let cursorY = 26
  const normalizedTasks = normalizeTaskList(workOrder.taskList)

  const statusLabel = workOrderStatusLabelMap[workOrder.status]
  const statusColor: [number, number, number] = workOrder.status === 'CLOSED' ? [16, 185, 129] : [239, 68, 68]

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(9)
  pdf.setTextColor(17, 24, 39)
  pdf.text(`Orden: ${workOrder.code ?? 'OT-LEGACY'}`, 14, cursorY)
  pdf.setTextColor(...statusColor)
  pdf.text(`Estado: ${statusLabel}`, pageWidth - 60, cursorY)

  cursorY += 5
  pdf.setFont('helvetica', 'normal')
  pdf.setTextColor(17, 24, 39)
  pdf.text(`Unidad: ${unit?.internalCode ?? 'N/D'}`, 14, cursorY)
  cursorY += 4
  pdf.text(`Fecha: ${new Date(workOrder.createdAt ?? new Date().toISOString()).toLocaleString()}`, 14, cursorY)
  cursorY += 6

  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(220, 38, 38)
  pdf.text(`Desvios a resolver: ${normalizedTasks.length}`, 14, cursorY)
  cursorY += 4

  const deviationsColumns = [
    { label: 'Estado', width: 18 },
    { label: 'Seccion', width: 30 },
    { label: 'Item', width: 70 },
    { label: 'Observacion', width: pageWidth - 14 - 14 - 118 },
  ]

  drawTableHeader(pdf, deviationsColumns, 14, cursorY, 6)
  cursorY += 6

  normalizedTasks.forEach((task) => {
    if (cursorY > pageHeight - 20) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')
      cursorY = 26
      drawTableHeader(pdf, deviationsColumns, 14, cursorY, 6)
      cursorY += 6
    }

    const rowHeight = 6
    drawRowBorders(pdf, deviationsColumns, 14, cursorY, rowHeight)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(17, 24, 39)
    pdf.text(task.status === 'RESOLVED' ? 'OK' : 'MAL', 16, cursorY + 4)
    pdf.text(
      clampText(pdf, task.section || 'GENERAL', deviationsColumns[1].width - 4),
      14 + deviationsColumns[0].width + 2,
      cursorY + 4,
    )
    pdf.text(
      clampText(pdf, task.item, deviationsColumns[2].width - 4),
      14 + deviationsColumns[0].width + deviationsColumns[1].width + 2,
      cursorY + 4,
    )
    pdf.text(
      clampText(pdf, task.observation || '-', deviationsColumns[3].width - 4),
      14 + deviationsColumns[0].width + deviationsColumns[1].width + deviationsColumns[2].width + 2,
      cursorY + 4,
    )
    cursorY += rowHeight
  })

  cursorY += 8

  const resolvedTasks = normalizedTasks.filter(
    (task) => task.status === 'RESOLVED' && (task.resolutionNote || task.resolutionPhotoUrl || task.resolutionPhotoBase64),
  )

  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(17, 24, 39)
  pdf.text('Trabajos realizados:', 14, cursorY)
  cursorY += 4

  const resolutionColumns = [
    { label: 'Seccion', width: 32 },
    { label: 'Item', width: 60 },
    { label: 'Detalle', width: pageWidth - 14 - 14 - 92 },
  ]

  drawTableHeader(pdf, resolutionColumns, 14, cursorY, 6)
  cursorY += 6

  if (resolvedTasks.length === 0) {
    const rowHeight = 6
    drawRowBorders(pdf, resolutionColumns, 14, cursorY, rowHeight)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(17, 24, 39)
    pdf.text('Sin registros', 16, cursorY + 4)
    cursorY += rowHeight
  } else {
    resolvedTasks.forEach((task) => {
      if (cursorY > pageHeight - 20) {
        pdf.addPage()
        addWatermark(pdf, logoDataUrl)
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')
        cursorY = 26
        drawTableHeader(pdf, resolutionColumns, 14, cursorY, 6)
        cursorY += 6
      }

      const rowHeight = 6
      drawRowBorders(pdf, resolutionColumns, 14, cursorY, rowHeight)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
      pdf.setTextColor(17, 24, 39)
      pdf.text(
        clampText(pdf, task.section || 'GENERAL', resolutionColumns[0].width - 4),
        16,
        cursorY + 4,
      )
      pdf.text(
        clampText(pdf, task.item, resolutionColumns[1].width - 4),
        14 + resolutionColumns[0].width + 2,
        cursorY + 4,
      )
      pdf.text(
        clampText(pdf, task.resolutionNote || '-', resolutionColumns[2].width - 4),
        14 + resolutionColumns[0].width + resolutionColumns[1].width + 2,
        cursorY + 4,
      )
      cursorY += rowHeight
    })
  }

  cursorY += 8

  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(14, 116, 144)
  pdf.text('Repuestos utilizados:', 14, cursorY)
  cursorY += 4

  const partsColumns = [
    { label: 'Codigo', width: 28 },
    { label: 'Repuesto', width: 90 },
    { label: 'Cantidad', width: pageWidth - 14 - 14 - 118 },
  ]

  drawTableHeader(pdf, partsColumns, 14, cursorY, 6)
  cursorY += 6

  const parts = workOrder.spareParts.length > 0 ? workOrder.spareParts : ['-']

  parts.forEach((part) => {
    if (cursorY > pageHeight - 20) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')
      cursorY = 26
      drawTableHeader(pdf, partsColumns, 14, cursorY, 6)
      cursorY += 6
    }

    const rowHeight = 6
    drawRowBorders(pdf, partsColumns, 14, cursorY, rowHeight)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.setTextColor(17, 24, 39)
    pdf.text('-', 16, cursorY + 4)
    pdf.text(part, 14 + partsColumns[0].width + 2, cursorY + 4)
    pdf.text('1', 14 + partsColumns[0].width + partsColumns[1].width + 2, cursorY + 4)
    cursorY += rowHeight
  })

  cursorY += 8
  pdf.setFont('helvetica', 'bold')
  pdf.setTextColor(17, 24, 39)
  pdf.text('Detalle del trabajo realizado:', 14, cursorY)
  cursorY += 5
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  const textLines = pdf.splitTextToSize(workOrder.laborDetail || 'Sin detalles.', pageWidth - 28)
  pdf.text(textLines, 14, cursorY)

  const photoCandidates = normalizeTaskList(workOrder.taskList)
    .flatMap((task) => [task.resolutionPhotoUrl, task.resolutionPhotoBase64])
    .filter(Boolean) as string[]

  const photoDataUrls = (await Promise.all(photoCandidates.map((value) => resolvePhotoDataUrl(value)))).filter(
    (value): value is string => Boolean(value),
  )

  if (photoDataUrls.length > 0) {
    cursorY += 8
    if (cursorY > pageHeight - 40) {
      pdf.addPage()
      addWatermark(pdf, logoDataUrl)
      drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')
      cursorY = 26
    }

    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(17, 24, 39)
    pdf.text('EVIDENCIAS DE REPARACION', 14, cursorY)
    cursorY += 6

    const maxWidth = pageWidth - 28
    const columnWidth = (maxWidth - 6) / 2
    const imageHeight = 45
    let col = 0

    for (let index = 0; index < photoDataUrls.length; index += 1) {
      if (cursorY + imageHeight > pageHeight - 15) {
        pdf.addPage()
        addWatermark(pdf, logoDataUrl)
        drawHeader(pdf, logoDataUrl, 'ENERTRANS S.R.L.', 'Orden de Trabajo')
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

  pdf.save(`OrdenTrabajo_${workOrder.code ?? workOrder.id}_${unit?.internalCode ?? 'unidad'}.pdf`)
}
