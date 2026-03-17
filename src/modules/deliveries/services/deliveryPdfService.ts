import { jsPDF } from 'jspdf'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import type { ClientAccount, DeliveryOperation, FleetUnit } from '../../../types/domain'

interface DeliveryPdfPayload {
  operation: DeliveryOperation
  unit?: FleetUnit | null
  client?: ClientAccount | null
}

const safeText = (value?: string | null) => (value ?? '').trim()

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

const formatDateTime = (value?: string) => {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString('es-AR')
}

const drawBox = (pdf: jsPDF, x: number, y: number, width: number, height: number) => {
  pdf.setDrawColor(140, 140, 140)
  pdf.rect(x, y, width, height)
}

const buildTitle = (operation: DeliveryOperation) =>
  operation.operationType === 'DELIVERY' ? 'INFORME DE ENTREGA' : 'INFORME DE DEVOLUCION'

const buildFileName = (operation: DeliveryOperation) => {
  const action = operation.operationType === 'DELIVERY' ? 'Entrega' : 'Devolucion'
  const unitCode = safeText(operation.unit?.internalCode) || 'Unidad'
  return `${action}_${unitCode}_${operation.id.slice(0, 8)}.pdf`
}

export const exportDeliveryOperationPdf = async ({ operation, unit, client }: DeliveryPdfPayload): Promise<void> => {
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = pdf.internal.pageSize.getWidth()

  let logoDataUrl: string | null = null
  try {
    logoDataUrl = await fetchImageAsDataUrl(enertransLogoUrl)
  } catch {
    logoDataUrl = null
  }

  if (logoDataUrl) {
    try {
      pdf.addImage(logoDataUrl, 'PNG', 10, 8, 30, 30)
    } catch {
      // ignore
    }
  }

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(12)
  pdf.text('ENERTRANS S.R.L.', 44, 14)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.text('Direccion: Valentin Gomez N 577', 44, 19)
  pdf.text('Haedo (1706) - Bs. As. - Argentina', 44, 23)
  pdf.text('Tel. (011) 4483-2061', 44, 27)
  pdf.text('contacto@enertrans.com.ar', 44, 31)

  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.text(buildTitle(operation), pageWidth - 75, 18)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.text(`Operacion: ${operation.id.slice(0, 8).toUpperCase()}`, pageWidth - 75, 24)
  pdf.text(`Fecha efectiva: ${formatDateTime(operation.effectiveAt || operation.createdAt)}`, pageWidth - 75, 30)

  let y = 44
  drawBox(pdf, 10, y, pageWidth - 20, 30)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(8)
  pdf.text('UNIDAD', 12, y + 6)
  pdf.text('CLIENTE', 12, y + 16)
  pdf.text('ESTADO OBJETIVO', 12, y + 26)
  pdf.setFont('helvetica', 'normal')
  pdf.text(safeText(unit?.internalCode) || safeText(operation.unit?.internalCode) || '-', 36, y + 6)
  pdf.text(
    safeText(client?.name) || safeText(operation.client?.name) || safeText(unit?.clientName) || 'Sin cliente asignado',
    36,
    y + 16,
  )
  pdf.text(operation.targetLogisticsStatus, 36, y + 26)

  y += 36
  drawBox(pdf, 10, y, pageWidth - 20, 42)
  pdf.setFont('helvetica', 'bold')
  pdf.text('RESUMEN OPERATIVO', 12, y + 6)
  pdf.setFont('helvetica', 'normal')
  const summaryText = safeText(operation.summary) || '-'
  const reasonText = safeText(operation.reason) || '-'
  const summaryLines = pdf.splitTextToSize(summaryText, pageWidth - 28)
  const reasonLines = pdf.splitTextToSize(reasonText, pageWidth - 28)
  pdf.text(summaryLines, 12, y + 12)

  const reasonTitleY = y + 22
  pdf.setFont('helvetica', 'bold')
  pdf.text('DETALLE / MOTIVO', 12, reasonTitleY)
  pdf.setFont('helvetica', 'normal')
  pdf.text(reasonLines, 12, reasonTitleY + 6)

  y += 48
  drawBox(pdf, 10, y, pageWidth - 20, 24)
  pdf.setFont('helvetica', 'bold')
  pdf.text('TRAZABILIDAD', 12, y + 6)
  pdf.setFont('helvetica', 'normal')
  pdf.text(`Registrado por: ${safeText(operation.requestedByUserName) || 'No registrado'}`, 12, y + 12)
  pdf.text(`Creado: ${formatDateTime(operation.createdAt)}`, 12, y + 18)

  const remitoLabel = safeText(operation.remitoFileName)
    ? operation.remitoFileName
    : safeText(operation.remitoFileUrl)
      ? 'Adjunto en sistema'
      : 'Sin remito adjunto'
  pdf.text(`Remito: ${remitoLabel}`, 110, y + 12)
  pdf.text(`Adjunto por: ${safeText(operation.remitoAttachedByUserName) || '-'}`, 110, y + 18)

  const footerY = 285
  pdf.setFont('helvetica', 'bold')
  pdf.text('ENERTRANS - Sistema Integral de Gestion de Flota', 10, footerY)

  pdf.save(buildFileName(operation))
}
