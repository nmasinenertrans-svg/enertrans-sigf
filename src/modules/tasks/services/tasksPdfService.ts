import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { TaskRecord } from '../../../types/domain'

const statusLabelMap: Record<TaskRecord['status'], string> = {
  UNASSIGNED: 'Sin asignar',
  ASSIGNED: 'Asignada',
  IN_PROGRESS: 'En curso',
  BLOCKED: 'Bloqueada',
  DONE: 'Finalizada',
  CANCELED: 'Cancelada',
}

const priorityLabelMap: Record<TaskRecord['priority'], string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  URGENT: 'Urgente',
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

const formatDate = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

export const downloadTaskPdf = async (task: TaskRecord): Promise<void> => {
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

  const assignedToLabel = safeText(task.assignedToUserName)
    ? safeText(task.assignedToUserName)
    : safeText(task.assignedToExternalName)
      ? `${safeText(task.assignedToExternalName)} (externo)`
      : 'Sin asignar'

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text('HOJA DE TAREA', pageWidth - 58, 18)
  pdf.setFontSize(10)
  pdf.text(`N° ${task.id.slice(0, 8).toUpperCase()}`, pageWidth - 58, 24)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Fecha: ${formatDate(task.createdAt)}`, pageWidth - 58, 31)

  let y = 42
  pdf.setDrawColor(120, 120, 120)
  pdf.rect(10, y, pageWidth - 20, 22)
  pdf.setFontSize(8)
  pdf.setFont('helvetica', 'bold')
  pdf.text('ASIGNADO A:', 12, y + 5)
  pdf.text('PRIORIDAD:', 110, y + 5)
  pdf.text('ESTADO:', 155, y + 5)
  pdf.text('CREADO POR:', 12, y + 12)
  pdf.text('FECHA CREACION:', 12, y + 19)
  pdf.setFont('helvetica', 'normal')
  pdf.text(assignedToLabel, 34, y + 5)
  pdf.text(priorityLabelMap[task.priority], 132, y + 5)
  pdf.text(statusLabelMap[task.status], 172, y + 5)
  pdf.text(safeText(task.createdByUserName) || '-', 40, y + 12)
  pdf.text(formatDate(task.createdAt), 48, y + 19)

  y += 28
  const tableX = 10
  const priorityW = 32
  const tableW = pageWidth - 20
  const descW = tableW - priorityW
  const headerH = 6
  const bodyH = 94
  pdf.setFillColor(242, 242, 242)
  pdf.rect(tableX, y, tableW, headerH, 'F')
  pdf.rect(tableX, y, priorityW, headerH)
  pdf.rect(tableX + priorityW, y, descW, headerH)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('PRIORIDAD', tableX + 2, y + 4)
  pdf.text('DESCRIPCION DE LA TAREA', tableX + priorityW + 2, y + 4)
  drawLinesBox(pdf, tableX, y + headerH, priorityW, bodyH)
  drawLinesBox(pdf, tableX + priorityW, y + headerH, descW, bodyH)

  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.text(priorityLabelMap[task.priority], tableX + 3, y + headerH + 7)

  const descriptionLines: string[] = []
  if (safeText(task.title)) {
    descriptionLines.push(safeText(task.title))
  }
  descriptionLines.push(...safeText(task.description).split('\n').filter(Boolean))
  if (descriptionLines.length === 0) {
    descriptionLines.push('Sin descripcion')
  }
  const wrapped = pdf.splitTextToSize(descriptionLines.join('\n'), descW - 4)
  pdf.text(wrapped, tableX + priorityW + 2, y + headerH + 7)

  y += headerH + bodyH + 6
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('Observaciones:', 12, y)
  const obsY = y + 4
  drawLinesBox(pdf, 10, obsY - 2, pageWidth - 20, 24)

  const sigY = Math.min(pageHeight - 36, obsY + 36)
  pdf.setDrawColor(60, 60, 60)
  pdf.line(15, sigY, pageWidth / 2 - 10, sigY)
  pdf.line(pageWidth / 2 + 10, sigY, pageWidth - 15, sigY)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('FIRMA QUIEN ASIGNA', 15, sigY - 2)
  pdf.text('FIRMA QUIEN RECIBE', pageWidth / 2 + 10, sigY - 2)

  const leftY = sigY + 6
  const rightX = pageWidth / 2 + 10
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)

  pdf.text(`Nombre y Apellido: ${safeText(task.createdByUserName) || '-'}`, 15, leftY)
  pdf.text('DNI: ', 15, leftY + 5)
  pdf.text('Sector: ', 15, leftY + 10)
  pdf.text('Cargo: ', 15, leftY + 15)

  pdf.text(`Nombre y Apellido: ${assignedToLabel !== 'Sin asignar' ? assignedToLabel : '-'}`, rightX, leftY)
  pdf.text('DNI: ', rightX, leftY + 5)
  pdf.text('Sector: ', rightX, leftY + 10)
  pdf.text('Cargo: ', rightX, leftY + 15)

  pdf.save(`Tarea_${task.id.slice(0, 8).toUpperCase()}.pdf`)
}

const formatDateOnly = (value?: string | null) => {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-AR')
}

export const downloadTasksSummaryPdf = async (tasks: TaskRecord[]): Promise<void> => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  let logoDataUrl: string | null = null

  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  const pageHeight = pdf.internal.pageSize.getHeight()
  const marginX = 10

  const sortedTasks = tasks.slice().sort((a, b) => {
    const dateA = new Date(a.startDate || a.createdAt || 0).getTime()
    const dateB = new Date(b.startDate || b.createdAt || 0).getTime()
    return dateA - dateB
  })

  const columns = [
    { label: 'N° HOJA DE TAREA', width: 32 },
    { label: 'TAREA RESUMIDA', width: 92 },
    { label: 'FECHA', width: 28 },
    { label: 'FECHA APROX. FINALIZACION', width: 38 },
  ]
  const tableWidth = columns.reduce((sum, col) => sum + col.width, 0)
  const rowHeight = 8

  const drawPageHeader = () => {
    if (logoDataUrl) {
      try {
        pdf.addImage(logoDataUrl, 'PNG', marginX, 8, 18, 18)
      } catch {
        // ignore
      }
    }
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(12)
    pdf.setTextColor(17, 24, 39)
    pdf.text('ENERTRANS S.R.L.', marginX + 22, 14)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(8)
    pdf.text('Listado resumen de tareas', marginX + 22, 20)
    pdf.setFontSize(7)
    pdf.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, marginX + 22, 25)

    let headerY = 34
    pdf.setDrawColor(120, 120, 120)
    pdf.setFillColor(242, 242, 242)
    pdf.rect(marginX, headerY, tableWidth, rowHeight, 'F')
    let x = marginX
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(17, 24, 39)
    columns.forEach((col) => {
      pdf.rect(x, headerY, col.width, rowHeight)
      pdf.text(col.label, x + 2, headerY + 5.5, { maxWidth: col.width - 3 })
      x += col.width
    })
    return headerY + rowHeight
  }

  let y = drawPageHeader()
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)

  sortedTasks.forEach((task) => {
    if (y + rowHeight > pageHeight - 15) {
      pdf.addPage()
      y = drawPageHeader()
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(8)
    }

    const summary = safeText(task.title) || safeText(task.description).slice(0, 90) || 'Sin descripcion'
    const values = [
      task.id.slice(0, 8).toUpperCase(),
      summary,
      formatDateOnly(task.startDate || task.createdAt),
      formatDateOnly(task.estimatedFinishDate),
    ]

    let x = marginX
    values.forEach((value, index) => {
      const col = columns[index]
      pdf.rect(x, y, col.width, rowHeight)
      const wrapped = pdf.splitTextToSize(value, col.width - 3)
      pdf.text(wrapped[0] ?? '', x + 2, y + 5.5)
      x += col.width
    })
    y += rowHeight
  })

  pdf.save(`Tareas_Resumen_${new Date().toISOString().slice(0, 10)}.pdf`)
}
