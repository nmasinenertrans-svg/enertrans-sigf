import type {
  AuditChecklistItem,
  AuditChecklistSection,
  AuditChecklistStatus,
  AuditRecord,
  FleetUnit,
  WorkOrder,
  WorkOrderDeviation,
} from '../../../types/domain'
import type {
  AuditChecklistItemDraft,
  AuditChecklistSectionDraft,
  AuditFormData,
  AuditFormErrors,
  AuditHistoryViewItem,
} from '../types'
import { formatSequenceCode, getNextSequenceCode, parseSequenceNumber } from '../../../services/sequence'

const MAX_OBSERVATION_LENGTH = 2000

const createId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `audit-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const defaultChecklistStatus: AuditChecklistStatus = 'OK'

export const statusLabelMap: Record<AuditChecklistStatus, string> = {
  OK: 'OK',
  BAD: 'MAL',
  NA: 'N/A',
}

const createChecklistItemDraftWithLabel = (label: string): AuditChecklistItemDraft => ({
  id: createId(),
  label,
  status: defaultChecklistStatus,
  observation: '',
})

const createChecklistSectionDraftWithItems = (title: string, labels: string[]): AuditChecklistSectionDraft => ({
  id: createId(),
  title,
  items: labels.map((label) => createChecklistItemDraftWithLabel(label)),
})

const createStandardChecklist = (): AuditChecklistSectionDraft[] => [
  createChecklistSectionDraftWithItems('NIVELES', [
    'Aceite de Mot.',
    'Refrigerante',
    'Liq. de frenos',
    'Liq. de Dir. Hidr.',
    'Liq. de Emb.',
  ]),
  createChecklistSectionDraftWithItems('PERDIDA DE FLUIDOS', [
    'Motor',
    'Caja y/o Toma de fuerza',
    'Ejes',
    'Sist. de direccion',
    'Sist. neumatico',
  ]),
  createChecklistSectionDraftWithItems('CUBIERTAS Y LLANTAS', [
    'Cubiertas 1er Eje',
    'Cubiertas 2do Eje',
    'Cubiertas 3er Eje',
    'Cubiertas Semirremolque',
    'Llantas y bulones',
    'Cubierta de auxilio',
  ]),
  createChecklistSectionDraftWithItems('ESTADO Y EXISTENCIAS', [
    'Bateria',
    'Mangueras',
    'Estado parabrisas y vidrios',
    'Limpieza int. y ext.',
    'Cint. de seguridad',
    'Matafuegos de carroceria',
    'Matafuegos de cabina',
    'Balizas de senalizacion',
    'Botiquin',
    'Llave de rueda',
    'Cric. Hidraulico',
    'Equipamiento',
    'Carroceria, portones, etc.',
  ]),
  createChecklistSectionDraftWithItems('FUNCIONAMIENTO', [
    'Sistema de iluminacion',
    'Luces de aviso y bocinas',
    'Ventilacion y calefaccion',
    'Limpia y lava parabrisas',
    'Freno de serv y estac.',
    'Direccion y embrague',
    'Tablero e instrumental',
    'Cerraduras, manillas, puertas',
    'Levanta vidrios',
  ]),
  createChecklistSectionDraftWithItems('HIDROGRUA', [
    'Gancho de hidr. y estib.',
    'Niv. de Liq. hidraulico',
    'Instrumental',
    'Extensibles',
    'Extensible delantero',
    'Extensible trasero',
    'Certificado',
    'Diagrama de carga',
  ]),
  createChecklistSectionDraftWithItems('ELASTICOS Y AMORTIGUACION', [
    'Elasticos delanteros',
    'Elasticos traseros',
    'Amortiguadores delanteros',
    'Amortiguadores traseros',
  ]),
  createChecklistSectionDraftWithItems('DOCUMENTACION', ['Cedula verde', 'VTV', 'Seguro']),
]

export const createEmptyAuditFormData = (unitId: string): AuditFormData => ({
  unitId,
  auditMode: 'INDEPENDENT',
  manualResult: 'APPROVED',
  externalRequestId: '',
  observations: '',
  checklistSections: createStandardChecklist(),
  photoBase64List: [],
  reportPdfFileName: '',
  reportPdfFileBase64: '',
  reportPdfFileUrl: '',
  unitKilometers: 0,
  engineHours: 0,
  hydroHours: 0,
})

export const createChecklistFromDeviations = (deviations: Array<WorkOrderDeviation | string>): AuditChecklistSectionDraft[] => {
  if (!deviations.length) {
    return createStandardChecklist()
  }

  const sectionMap = new Map<string, AuditChecklistItemDraft[]>()

  deviations.forEach((deviation) => {
    const sectionTitle =
      typeof deviation === 'string' ? 'GENERAL' : (deviation.section || 'GENERAL').trim() || 'GENERAL'
    const items = sectionMap.get(sectionTitle) ?? []
    items.push({
      id: typeof deviation === 'string' ? createId() : deviation.id,
      label: typeof deviation === 'string' ? deviation : deviation.item || 'Desvio',
      status: defaultChecklistStatus,
      observation: typeof deviation === 'string' ? '' : deviation.observation ?? '',
    })
    sectionMap.set(sectionTitle, items)
  })

  return Array.from(sectionMap.entries()).map(([title, items]) => ({
    id: createId(),
    title,
    items,
  }))
}

export const evaluateAuditResult = (sections: AuditChecklistSection[]): 'APPROVED' | 'REJECTED' => {
  const hasBadStatus = sections.some((section) => section.items.some((item) => item.status === 'BAD'))
  return hasBadStatus ? 'REJECTED' : 'APPROVED'
}

export const validateAuditFormData = (formData: AuditFormData, unitList: FleetUnit[]): AuditFormErrors => {
  const validationErrors: AuditFormErrors = {}

  if (!formData.unitId) {
    validationErrors.unitId = 'Debes seleccionar una unidad.'
  } else if (!unitList.some((unit) => unit.id === formData.unitId)) {
    validationErrors.unitId = 'La unidad seleccionada no existe.'
  }

  if (formData.observations.length > MAX_OBSERVATION_LENGTH) {
    validationErrors.observations = 'Las observaciones superan el largo maximo permitido.'
  }

  if (formData.auditMode === 'EXTERNAL_REQUEST' && !formData.externalRequestId) {
    validationErrors.externalRequestId = 'Selecciona la nota de pedido vinculada.'
  }

  if (formData.unitKilometers < 0) {
    validationErrors.unitKilometers = 'Los kilometros deben ser validos.'
  }

  if (formData.engineHours < 0) {
    validationErrors.engineHours = 'Las horas de motor deben ser validas.'
  }

  if (formData.hydroHours < 0) {
    validationErrors.hydroHours = 'Las horas de hidrogrua deben ser validas.'
  }

  if (formData.auditMode === 'INDEPENDENT') {
    const hasValidSections = formData.checklistSections.some(
      (section) => section.title.trim() && section.items.some((item) => item.label.trim()),
    )

    if (!hasValidSections) {
      validationErrors.checklistSections = 'El checklist debe tener al menos una seccion con un item valido.'
    }
  }

  if (formData.reportPdfFileBase64 && !formData.reportPdfFileName) {
    validationErrors.reportPdfFileBase64 = 'El archivo PDF cargado no es valido.'
  }

  return validationErrors
}

const toChecklistItem = (itemDraft: AuditChecklistItemDraft): AuditChecklistItem => ({
  id: itemDraft.id,
  label: itemDraft.label.trim(),
  status: itemDraft.status,
  observation: itemDraft.observation.trim(),
})

const toChecklistSection = (sectionDraft: AuditChecklistSectionDraft): AuditChecklistSection | null => {
  const normalizedTitle = sectionDraft.title.trim()
  const normalizedItems = sectionDraft.items
    .map((item) => toChecklistItem(item))
    .filter((item) => item.label.length > 0)

  if (!normalizedTitle || normalizedItems.length === 0) {
    return null
  }

  return {
    id: sectionDraft.id,
    title: normalizedTitle,
    items: normalizedItems,
  }
}

const createWorkOrderId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `work-order-${Date.now()}-${Math.round(Math.random() * 10000)}`
}

const buildDeviationList = (sections: AuditChecklistSection[]): WorkOrderDeviation[] => {
  const deviations = sections.flatMap((section) =>
    section.items
      .filter((item) => item.status === 'BAD')
      .map((item) => ({
        id: createId(),
        section: section.title,
        item: item.label,
        observation: item.observation,
        status: 'PENDING' as const,
        resolutionNote: '',
        resolutionPhotoBase64: '',
        resolutionPhotoUrl: '',
      })),
  )

  if (deviations.length > 0) {
    return deviations
  }

  return [
    {
      id: createId(),
      section: 'GENERAL',
      item: 'Desvios detectados en inspeccion',
      observation: '',
      status: 'PENDING',
      resolutionNote: '',
      resolutionPhotoBase64: '',
      resolutionPhotoUrl: '',
    },
  ]
}

export const createWorkOrderFromAudit = (audit: AuditRecord, unitCode: string): WorkOrder => {
  const sequence = parseSequenceNumber(audit.code)
  const code = sequence ? formatSequenceCode('OT', sequence, unitCode) : getNextSequenceCode('workOrder', 'OT', unitCode)

  return {
    code,
    pendingReaudit: false,
    id: createWorkOrderId(),
    unitId: audit.unitId,
    status: 'OPEN',
    createdAt: new Date().toISOString(),
    taskList: buildDeviationList(audit.checklistSections),
    spareParts: [],
    laborDetail: `Desvios detectados en inspeccion ${audit.code}`,
    linkedInventorySkuList: [],
  }
}

const resolveAuditKind = (unitId: string, workOrders: WorkOrder[]): 'AUDIT' | 'REAUDIT' => {
  const hasOpen = workOrders.some((order) => order.unitId === unitId && order.status !== 'CLOSED')
  if (hasOpen) {
    return 'AUDIT'
  }
  const hasPendingReaudit = workOrders.some((order) => order.unitId === unitId && order.pendingReaudit)
  return hasPendingReaudit ? 'REAUDIT' : 'AUDIT'
}

const buildAuditCode = (kind: 'AUDIT' | 'REAUDIT', unitCode: string, sequenceOverride?: number | null) => {
  const prefix = kind === 'REAUDIT' ? 'RINS' : 'INS'
  if (sequenceOverride && Number.isFinite(sequenceOverride)) {
    return formatSequenceCode(prefix, sequenceOverride, unitCode)
  }
  return kind === 'REAUDIT'
    ? getNextSequenceCode('reaudit', 'RINS', unitCode)
    : getNextSequenceCode('audit', 'INS', unitCode)
}

export const toAuditRecord = (
  formData: AuditFormData,
  auditorUserId: string,
  auditorName: string,
  workOrders: WorkOrder[] = [],
  unitCode: string = '',
  externalRequestCode?: string,
  options?: { manualAuditMode?: boolean },
): AuditRecord => {
  const manualAuditMode = options?.manualAuditMode === true
  let checklistSections = formData.checklistSections
    .map((sectionDraft) => toChecklistSection(sectionDraft))
    .filter((section): section is AuditChecklistSection => section !== null)

  if (formData.auditMode === 'EXTERNAL_REQUEST') {
    checklistSections = [
      {
        id: createId(),
        title: 'NOTA DE PEDIDO EXTERNO',
        items: [
          {
            id: createId(),
            label: externalRequestCode ? `NDP ${externalRequestCode}` : 'NDP vinculada',
            status: 'BAD',
            observation: formData.observations.trim(),
          },
        ],
      },
    ]
  }

  const auditKind = manualAuditMode ? 'AUDIT' : resolveAuditKind(formData.unitId, workOrders)
  const pendingOrder = manualAuditMode
    ? undefined
    : workOrders.find((order) => order.unitId === formData.unitId && order.pendingReaudit)
  const overrideSequence = !manualAuditMode && auditKind === 'REAUDIT' ? parseSequenceNumber(pendingOrder?.code) : null
  const code = buildAuditCode(auditKind, unitCode, overrideSequence)

  if (manualAuditMode) {
    checklistSections = [
      {
        id: createId(),
        title: 'INSPECCION MANUAL',
        items: [
          {
            id: createId(),
            label: formData.reportPdfFileName ? `Informe PDF: ${formData.reportPdfFileName}` : 'Informe PDF manual',
            status: formData.manualResult === 'REJECTED' ? 'BAD' : 'OK',
            observation: formData.observations.trim(),
          },
        ],
      },
    ]
  }

  return {
    id: createId(),
    code,
    auditKind,
    unitId: formData.unitId,
    auditorUserId,
    auditorName,
    performedAt: new Date().toISOString(),
    result:
      formData.auditMode === 'EXTERNAL_REQUEST'
        ? 'REJECTED'
        : manualAuditMode
          ? formData.manualResult
          : evaluateAuditResult(checklistSections),
    observations: formData.observations.trim(),
    photoBase64List: formData.photoBase64List,
    reportPdfFileName: formData.reportPdfFileName || undefined,
    reportPdfFileBase64: formData.reportPdfFileBase64 || undefined,
    reportPdfFileUrl: formData.reportPdfFileUrl || undefined,
    checklistSections,
    unitKilometers: formData.unitKilometers,
    engineHours: formData.engineHours,
    hydroHours: formData.hydroHours,
  }
}

export const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const fileReader = new FileReader()

    fileReader.onload = () => {
      const result = fileReader.result

      if (typeof result === 'string') {
        resolve(result)
        return
      }

      reject(new Error('No se pudo leer la imagen.'))
    }

    fileReader.onerror = () => reject(new Error('Error al procesar la imagen.'))
    fileReader.readAsDataURL(file)
  })

type ImageCompressionOptions = {
  maxWidth?: number
  maxHeight?: number
  quality?: number
  outputType?: 'image/jpeg' | 'image/webp'
}

const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('No se pudo cargar la imagen para comprimir.'))
    image.src = dataUrl
  })

export const readImageAsCompressedDataUrl = async (
  file: File,
  options: ImageCompressionOptions = {},
): Promise<string> => {
  const originalDataUrl = await readFileAsDataUrl(file)
  if (!file.type.startsWith('image/')) {
    return originalDataUrl
  }

  const maxWidth = options.maxWidth ?? 1600
  const maxHeight = options.maxHeight ?? 1600
  const quality = options.quality ?? 0.75
  const outputType = options.outputType ?? 'image/jpeg'

  try {
    const image = await loadImageFromDataUrl(originalDataUrl)
    const width = image.naturalWidth || image.width
    const height = image.naturalHeight || image.height

    if (!width || !height) {
      return originalDataUrl
    }

    const scale = Math.min(1, maxWidth / width, maxHeight / height)
    const targetWidth = Math.max(1, Math.round(width * scale))
    const targetHeight = Math.max(1, Math.round(height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight

    const context = canvas.getContext('2d')
    if (!context) {
      return originalDataUrl
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight)
    const compressedDataUrl = canvas.toDataURL(outputType, quality)

    if (!compressedDataUrl || compressedDataUrl.length >= originalDataUrl.length) {
      return originalDataUrl
    }

    return compressedDataUrl
  } catch {
    return originalDataUrl
  }
}

const resultLabelMap: Record<'APPROVED' | 'REJECTED', string> = {
  APPROVED: 'APROBADO',
  REJECTED: 'RECHAZADO',
}

const resultClassMap: Record<'APPROVED' | 'REJECTED', string> = {
  APPROVED: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  REJECTED: 'border-rose-300 bg-rose-50 text-rose-700',
}

const normalizeLegacyAuditRecord = (audit: AuditRecord): AuditRecord => {
  const checklistSections = Array.isArray(audit.checklistSections) ? audit.checklistSections : []
  const hasValidResult = audit.result === 'APPROVED' || audit.result === 'REJECTED'

  return {
    ...audit,
    auditKind: audit.auditKind ?? 'AUDIT',
    code: audit.code ?? 'INS-LEGACY',
    auditorName: audit.auditorName ?? 'Usuario no identificado',
    checklistSections,
    result: hasValidResult ? audit.result : evaluateAuditResult(checklistSections),
    unitKilometers: audit.unitKilometers ?? 0,
    engineHours: audit.engineHours ?? 0,
    hydroHours: audit.hydroHours ?? 0,
  }
}

export const buildAuditHistoryView = (
  auditList: AuditRecord[],
  unitList: FleetUnit[],
): AuditHistoryViewItem[] =>
  auditList
    .map((audit) => normalizeLegacyAuditRecord(audit))
    .map((audit) => {
      const unit = unitList.find((fleetUnit) => fleetUnit.id === audit.unitId)

      return {
        id: audit.id,
        code: audit.code ?? 'INS-LEGACY',
        auditKind: audit.auditKind ?? 'AUDIT',
        unitId: audit.unitId,
        unitLabel: unit ? `${unit.internalCode} - ${unit.ownerCompany}` : 'Unidad no disponible',
        performedAt: audit.performedAt,
        auditorName: audit.auditorName,
        resultLabel: resultLabelMap[audit.result],
        resultClassName: resultClassMap[audit.result],
        observations: audit.observations,
        unitKilometers: audit.unitKilometers ?? 0,
        engineHours: audit.engineHours ?? 0,
        hydroHours: audit.hydroHours ?? 0,
        photoCount: audit.photoBase64List.length,
        sections: audit.checklistSections,
        syncState: audit.syncState,
        syncError: audit.syncError,
      }
    })
    .sort((left, right) => new Date(right.performedAt).getTime() - new Date(left.performedAt).getTime())

