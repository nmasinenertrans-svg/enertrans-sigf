import { useMemo, useState } from 'react'
import enertransLogoUrl from '../../../assets/enertrans-logo.png'
import { usePermissions } from '../../../core/auth/usePermissions'
import { Link, useParams } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { buildFleetDetailPath, buildFleetEditPath, buildServiceOrderDetailPath, ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { BackLink } from '../../../components/shared/BackLink'
import {
  findFleetUnitById,
  getFleetUnitTypeLabel,
  getOperationalStatusLabel,
  normalizeFleetUnit,
} from '../services/fleetService'
import { workOrderStatusLabelMap } from '../../workOrders/services/workOrdersService'
import { getMeasurementUnit, maintenanceTypeLabels } from '../../maintenance/services/maintenanceService'
import type { FleetUnit } from '../../../types/domain'
import { FleetMovementsPanel } from '../components/FleetMovementsPanel'
import { FleetGpsPanel } from '../components/FleetGpsPanel'
import { StatusPill } from '../../../components/ui/StatusPill'
import { resultLabelMap as auditResultLabelMap } from '../../audits/services/auditsService'

const detailTabs = [
  { id: 'maintenancePlan', label: 'Plan de mantenimiento' },
  { id: 'audits', label: 'Inspecciones' },
  { id: 'workOrders', label: 'Ordenes de trabajo' },
  { id: 'repairs', label: 'Reparaciones' },
  { id: 'externalRequests', label: 'Notas externas' },
  { id: 'movements', label: 'Remitos' },
  { id: 'gpsTelemetry', label: 'GPS / Recorrido' },
  { id: 'inventory', label: 'Inventario asociado' },
  { id: 'serviceOrders', label: 'Órdenes de Servicio' },
] as const

type DetailTabId = (typeof detailTabs)[number]['id']

const formatDateTime = (value: string): string => {
  if (!value) {
    return 'Sin fecha'
  }

  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

const buildQrImageUrl = (profileUrl: string): string =>
  `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(profileUrl)}`

const daysBetween = (target: Date, reference: Date) =>
  Math.ceil((target.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24))

const getDocumentStatus = (expiresAt?: string, thresholdDays = 30, notApplicable = false) => {
  if (notApplicable) {
    return 'na'
  }
  if (!expiresAt) {
    return 'missing'
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return 'missing'
  }
  const delta = daysBetween(date, new Date())
  if (delta < 0) {
    return 'overdue'
  }
  if (delta <= thresholdDays) {
    return 'soon'
  }
  return 'ok'
}

const isMissingOrExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return true
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date.getTime() < new Date().setHours(0, 0, 0, 0)
}

const hasInvalidDocuments = (
  documents?: { rto?: { expiresAt?: string }; insurance?: { expiresAt?: string }; hoist?: { expiresAt?: string } },
  requiresHoist = true,
): boolean => {
  if (!documents) {
    return true
  }
  return (
    isMissingOrExpired(documents.rto?.expiresAt) ||
    isMissingOrExpired(documents.insurance?.expiresAt) ||
    (requiresHoist && !(documents as any).hoistNotApplicable ? isMissingOrExpired(documents.hoist?.expiresAt) : false)
  )
}

const documentStatusLabelMap: Record<'overdue' | 'soon' | 'ok' | 'missing' | 'na', string> = {
  overdue: 'Vencido',
  soon: 'Por vencer',
  ok: 'Vigente',
  missing: 'Sin registro',
  na: 'No aplica',
}

const documentStatusClassMap: Record<'overdue' | 'soon' | 'ok' | 'missing' | 'na', string> = {
  overdue: 'border-rose-300 bg-rose-50 text-rose-700',
  soon: 'border-amber-300 bg-amber-50 text-amber-700',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  missing: 'border-slate-200 bg-slate-100 text-slate-600',
  na: 'border-slate-200 bg-slate-50 text-slate-500',
}

const operationalStatusClassMap = {
  OPERATIONAL: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  MAINTENANCE: 'border-amber-300 bg-amber-50 text-amber-700',
  OUT_OF_SERVICE: 'border-rose-300 bg-rose-50 text-rose-700',
} as const

export const FleetDetailPage = () => {
  const { can } = usePermissions()
  const { unitId } = useParams()
  const [activeTab, setActiveTab] = useState<DetailTabId>('maintenancePlan')
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isQrPdfLoading, setIsQrPdfLoading] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [isDownloadingFicha, setIsDownloadingFicha] = useState(false)
  const [copySpecsOpen, setCopySpecsOpen] = useState(false)
  const [copySpecsSearch, setCopySpecsSearch] = useState('')
  const [copySpecsSource, setCopySpecsSource] = useState<FleetUnit | null>(null)
  const [isCopyingSpecs, setIsCopyingSpecs] = useState(false)

  const {
    state: { currentUser, fleetUnits, maintenancePlans, audits, workOrders, repairs, externalRequests, inventoryItems, movements, serviceOrders },
    actions: { setFleetUnits },
  } = useAppContext()

  const canEditFleet = can('FLEET', 'edit')
  const canCreateAudits = can('AUDITS', 'create')
  const canDeleteFleetDocuments = currentUser?.role === 'DEV' || currentUser?.role === 'GERENTE'

  const selectedUnit = useMemo(() => {
    if (!unitId) {
      return undefined
    }

    const unit = findFleetUnitById(fleetUnits, unitId)
    return unit ? normalizeFleetUnit(unit) : undefined
  }, [fleetUnits, unitId])

  const associatedSemiTrailer = useMemo(() => {
    if (!selectedUnit?.semiTrailerUnitId) {
      return undefined
    }

    return fleetUnits.find((unit) => unit.id === selectedUnit.semiTrailerUnitId)
  }, [fleetUnits, selectedUnit])

  const currentTractorForSemiTrailer = useMemo(() => {
    if (!selectedUnit || selectedUnit.unitType !== 'SEMI_TRAILER') {
      return undefined
    }

    return fleetUnits.find((unit) => unit.semiTrailerUnitId === selectedUnit.id)
  }, [fleetUnits, selectedUnit])

  const tractorHistory = useMemo(() => {
    if (!selectedUnit || selectedUnit.unitType !== 'SEMI_TRAILER') {
      return []
    }

    return selectedUnit.tractorHistoryIds
      .map((tractorId) => fleetUnits.find((unit) => unit.id === tractorId))
      .filter((unit): unit is NonNullable<typeof unit> => Boolean(unit))
  }, [fleetUnits, selectedUnit])

  const unitMaintenancePlans = useMemo(
    () => maintenancePlans.filter((plan) => plan.unitId === unitId),
    [maintenancePlans, unitId],
  )

  const motorMaintenancePlan = useMemo(
    () => unitMaintenancePlans.find((plan) => plan.maintenanceType === 'MOTOR'),
    [unitMaintenancePlans],
  )
  const motorMeasurementUnit = getMeasurementUnit(selectedUnit?.unitType, 'MOTOR')

  const unitAudits = useMemo(() => audits.filter((audit) => audit.unitId === unitId), [audits, unitId])

  const latestAudit = useMemo(() => {
    if (unitAudits.length === 0) {
      return undefined
    }
    return [...unitAudits].sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())[0]
  }, [unitAudits])

  const latestReaudit = useMemo(() => {
    const reauditList = unitAudits.filter((audit) => audit.auditKind === 'REAUDIT')
    if (reauditList.length === 0) {
      return undefined
    }
    return [...reauditList].sort((a, b) => new Date(b.performedAt).getTime() - new Date(a.performedAt).getTime())[0]
  }, [unitAudits])

  const unitWorkOrders = useMemo(
    () => workOrders.filter((workOrder) => workOrder.unitId === unitId),
    [workOrders, unitId],
  )

  const openWorkOrdersCount = useMemo(
    () => unitWorkOrders.filter((workOrder) => workOrder.status !== 'CLOSED').length,
    [unitWorkOrders],
  )

  const unitRepairs = useMemo(() => repairs.filter((repair) => repair.unitId === unitId), [repairs, unitId])

  const latestRepair = useMemo(() => {
    if (unitRepairs.length === 0) {
      return undefined
    }
    return [...unitRepairs].sort((a, b) => new Date(b.createdAt ?? '').getTime() - new Date(a.createdAt ?? '').getTime())[0]
  }, [unitRepairs])

  const unitExternalRequests = useMemo(
    () => externalRequests.filter((request) => request.unitId === unitId),
    [externalRequests, unitId],
  )

  const externalRequestMap = useMemo(() => {
    const map = new Map<string, (typeof externalRequests)[number]>()
    unitExternalRequests.forEach((request) => map.set(request.id, request))
    return map
  }, [unitExternalRequests])

  const associatedInventory = useMemo(() => {
    const unitWorkOrderIds = new Set(unitWorkOrders.map((workOrder) => workOrder.id))
    return inventoryItems.filter((inventoryItem) =>
      inventoryItem.linkedWorkOrderIds.some((linkedWorkOrderId) => unitWorkOrderIds.has(linkedWorkOrderId)),
    )
  }, [inventoryItems, unitWorkOrders])

  const qrProfileUrl = useMemo(() => {
    if (!selectedUnit) {
      return ''
    }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : ''
    return `${baseUrl}${buildFleetDetailPath(selectedUnit.id)}`
  }, [selectedUnit])

  const qrImageUrl = qrProfileUrl ? buildQrImageUrl(qrProfileUrl) : ''

  const updateUnit = (updater: (unit: FleetUnit) => FleetUnit) => {
    if (!selectedUnit) {
      return
    }

    setFleetUnits(
      fleetUnits.map((unit) => (unit.id === selectedUnit.id ? updater(unit) : unit)),
    )
  }

  const hasOpenWorkOrders = unitWorkOrders.some((workOrder) => workOrder.status !== 'CLOSED')

  const resolveOperationalStatus = (invalidDocs: boolean) => {
    if (invalidDocs) {
      return 'OUT_OF_SERVICE'
    }
    if (hasOpenWorkOrders) {
      return 'MAINTENANCE'
    }
    return 'OPERATIONAL'
  }

  const emptyDoc = {
    fileName: '',
    fileBase64: '',
    fileUrl: '',
    expiresAt: '',
    rtoProvincial: false,
    rtoNacional: false,
  }
  const emptyDocs = {
    rto: emptyDoc,
    insurance: emptyDoc,
    hoist: emptyDoc,
    title: emptyDoc,
    registration: emptyDoc,
    hoistNotApplicable: false,
    tracking: {
      ituran: false,
      rsv: false,
      microtrack: false,
    },
  }
  const emptyLubricants = {
    engineOil: '',
    engineOilLiters: '',
    gearboxOil: '',
    gearboxOilLiters: '',
    differentialOil: '',
    differentialOilLiters: '',
    clutchFluid: '',
    clutchFluidLiters: '',
    steeringFluid: '',
    steeringFluidLiters: '',
    brakeFluid: '',
    brakeFluidLiters: '',
    coolant: '',
    coolantLiters: '',
    hydraulicOil: '',
    hydraulicOilLiters: '',
  }
  const emptyFilters = {
    oilFilter: '',
    fuelFilter: '',
    taFilter: '',
    primaryAirFilter: '',
    secondaryAirFilter: '',
    cabinFilter: '',
  }

  const safeDocuments = selectedUnit?.documents ?? emptyDocs
  const safeTracking = safeDocuments.tracking ?? emptyDocs.tracking
  const requiresHoist = Boolean(selectedUnit?.hasHydroCrane)
  const hoistNotApplicable = Boolean(safeDocuments.hoistNotApplicable)
  const safeLubricants = selectedUnit?.lubricants ?? emptyLubricants
  const safeFilters = selectedUnit?.filters ?? emptyFilters

  const handleDocumentExpirationChange = (
    docKey: 'rto' | 'insurance' | 'hoist' | 'title' | 'registration',
    value: string,
  ) => {
    const nextDocuments = {
      ...(selectedUnit?.documents ?? emptyDocs),
      [docKey]: {
        ...((selectedUnit?.documents ?? emptyDocs)[docKey] ?? emptyDoc),
        expiresAt: value,
      },
    }
    const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
    const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
    updateUnit((unit) => ({
      ...unit,
      documents: nextDocuments,
      operationalStatus: nextOperationalStatus,
    }))
    if (typeof navigator !== 'undefined' && navigator.onLine && selectedUnit) {
      apiRequest(`/fleet/${selectedUnit.id}`, {
        method: 'PATCH',
        body: { documents: nextDocuments, operationalStatus: nextOperationalStatus },
      }).catch(() => null)
    }
  }

  const handleDocumentFileChange = async (
    docKey: 'rto' | 'insurance' | 'hoist' | 'title' | 'registration',
    file?: File | null,
  ) => {
    if (!file) {
      return
    }

    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      if (typeof navigator !== 'undefined' && navigator.onLine && selectedUnit) {
        apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: `${selectedUnit.id}-${docKey}-${file.name}`,
            contentType: file.type || 'application/octet-stream',
            dataUrl: result,
            folder: 'documents',
          },
        })
          .then((response) => {
            const nextDocuments = {
              ...(selectedUnit?.documents ?? emptyDocs),
              [docKey]: {
                ...((selectedUnit?.documents ?? emptyDocs)[docKey] ?? emptyDoc),
                fileName: file.name,
                fileBase64: '',
                fileUrl: response.url,
              },
            }
            const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
            const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
            updateUnit((unit) => ({
              ...unit,
              documents: nextDocuments,
              operationalStatus: nextOperationalStatus,
            }))
            apiRequest(`/fleet/${selectedUnit.id}`, {
              method: 'PATCH',
              body: { documents: nextDocuments, operationalStatus: nextOperationalStatus },
            }).catch(() => null)
          })
          .catch(() => {
            const nextDocuments = {
              ...(selectedUnit?.documents ?? emptyDocs),
              [docKey]: {
                ...((selectedUnit?.documents ?? emptyDocs)[docKey] ?? emptyDoc),
                fileName: file.name,
                fileBase64: result,
              },
            }
            const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
            const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
            updateUnit((unit) => ({
              ...unit,
              documents: nextDocuments,
              operationalStatus: nextOperationalStatus,
            }))
          })
      } else {
        const nextDocuments = {
          ...(selectedUnit?.documents ?? emptyDocs),
          [docKey]: {
            ...((selectedUnit?.documents ?? emptyDocs)[docKey] ?? emptyDoc),
            fileName: file.name,
            fileBase64: result,
          },
        }
        const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
        const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
        updateUnit((unit) => ({
          ...unit,
          documents: nextDocuments,
          operationalStatus: nextOperationalStatus,
        }))
      }
    }
    reader.readAsDataURL(file)
  }

  const handleRtoJurisdictionChange = (target: 'rtoProvincial' | 'rtoNacional', checked: boolean) => {
    const nextRto = {
      ...((selectedUnit?.documents ?? emptyDocs).rto ?? emptyDoc),
      [target]: checked,
      ...(target === 'rtoProvincial' && checked ? { rtoNacional: false } : {}),
      ...(target === 'rtoNacional' && checked ? { rtoProvincial: false } : {}),
    }
    const nextDocuments = {
      ...(selectedUnit?.documents ?? emptyDocs),
      rto: nextRto,
    }
    const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
    const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
    updateUnit((unit) => ({
      ...unit,
      documents: nextDocuments,
      operationalStatus: nextOperationalStatus,
    }))
    if (typeof navigator !== 'undefined' && navigator.onLine && selectedUnit) {
      apiRequest(`/fleet/${selectedUnit.id}`, {
        method: 'PATCH',
        body: { documents: nextDocuments, operationalStatus: nextOperationalStatus },
      }).catch(() => null)
    }
  }

  const handleTrackingChange = (target: 'ituran' | 'rsv' | 'microtrack', checked: boolean) => {
    const nextDocuments = {
      ...(selectedUnit?.documents ?? emptyDocs),
      tracking: {
        ...(selectedUnit?.documents?.tracking ?? emptyDocs.tracking),
        [target]: checked,
      },
    }
    updateUnit((unit) => ({
      ...unit,
      documents: nextDocuments,
    }))
    if (typeof navigator !== 'undefined' && navigator.onLine && selectedUnit) {
      apiRequest(`/fleet/${selectedUnit.id}`, {
        method: 'PATCH',
        body: { documents: nextDocuments },
      }).catch(() => null)
    }
  }

  const handleDeleteDocumentFile = (docKey: 'rto' | 'insurance' | 'hoist' | 'title' | 'registration') => {
    if (!canDeleteFleetDocuments || !selectedUnit) {
      return
    }
    const confirmed = window.confirm('¿Eliminar archivo cargado? Esta acción no se puede deshacer.')
    if (!confirmed) {
      return
    }
    const nextDocuments = {
      ...(selectedUnit.documents ?? emptyDocs),
      [docKey]: {
        ...((selectedUnit.documents ?? emptyDocs)[docKey] ?? emptyDoc),
        fileName: '',
        fileBase64: '',
        fileUrl: '',
      },
    }
    const invalidDocs = hasInvalidDocuments(nextDocuments, requiresHoist)
    const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
    updateUnit((unit) => ({
      ...unit,
      documents: nextDocuments,
      operationalStatus: nextOperationalStatus,
    }))
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/fleet/${selectedUnit.id}`, {
        method: 'PATCH',
        body: { documents: nextDocuments, operationalStatus: nextOperationalStatus },
      }).catch(() => null)
    }
  }

  const openDocument = (docKey: 'rto' | 'insurance' | 'hoist' | 'title' | 'registration') => {
    const doc = safeDocuments?.[docKey]
    if (!doc) {
      return
    }
    if (doc.fileUrl) {
      window.open(doc.fileUrl, '_blank', 'noopener,noreferrer')
      return
    }
    if (doc.fileBase64) {
      const win = window.open('', '_blank', 'noopener,noreferrer')
      if (win) {
        win.document.write(`<iframe src="${doc.fileBase64}" style="border:0; width:100%; height:100%;" />`)
        win.document.close()
      }
    }
  }

  const downloadDocument = (docKey: 'rto' | 'insurance' | 'hoist' | 'title' | 'registration') => {
    const doc = safeDocuments?.[docKey]
    if (!doc) {
      return
    }

    const fileName = doc.fileName?.trim() || `${docKey}.pdf`

    if (doc.fileUrl) {
      const link = document.createElement('a')
      link.href = doc.fileUrl
      link.download = fileName
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      return
    }

    if (doc.fileBase64) {
      const link = document.createElement('a')
      link.href = doc.fileBase64
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    }
  }

  const lubricantRows = selectedUnit
    ? [
        { label: 'Aceite Motor', value: safeLubricants.engineOil, key: 'engineOil' as const },
        { label: 'Litros Aceite Motor', value: safeLubricants.engineOilLiters, key: 'engineOilLiters' as const },
        { label: 'Aceite Caja', value: safeLubricants.gearboxOil, key: 'gearboxOil' as const },
        { label: 'Litros Aceite Caja', value: safeLubricants.gearboxOilLiters, key: 'gearboxOilLiters' as const },
        { label: 'Aceite Diferencial', value: safeLubricants.differentialOil, key: 'differentialOil' as const },
        { label: 'Litros Aceite Diferencial', value: safeLubricants.differentialOilLiters, key: 'differentialOilLiters' as const },
        { label: 'Liquido Embrague', value: safeLubricants.clutchFluid, key: 'clutchFluid' as const },
        { label: 'Litros Liquido Embrague', value: safeLubricants.clutchFluidLiters, key: 'clutchFluidLiters' as const },
        { label: 'Liquido Direccion', value: safeLubricants.steeringFluid, key: 'steeringFluid' as const },
        { label: 'Litros Liquido Direccion', value: safeLubricants.steeringFluidLiters, key: 'steeringFluidLiters' as const },
        { label: 'Liquido Frenos', value: safeLubricants.brakeFluid, key: 'brakeFluid' as const },
        { label: 'Litros Liquido Frenos', value: safeLubricants.brakeFluidLiters, key: 'brakeFluidLiters' as const },
        { label: 'Refrigerante', value: safeLubricants.coolant, key: 'coolant' as const },
        { label: 'Litros Refrigerante', value: safeLubricants.coolantLiters, key: 'coolantLiters' as const },
        { label: 'Aceite Hidraulico', value: safeLubricants.hydraulicOil, key: 'hydraulicOil' as const },
        { label: 'Litros Aceite Hidraulico', value: safeLubricants.hydraulicOilLiters, key: 'hydraulicOilLiters' as const },
      ]
    : []

  const filterRows = selectedUnit
    ? [
        { label: 'Filtro Aceite', value: safeFilters.oilFilter, key: 'oilFilter' as const },
        { label: 'Filtro Combustible', value: safeFilters.fuelFilter, key: 'fuelFilter' as const },
        { label: 'Filtro TA', value: safeFilters.taFilter, key: 'taFilter' as const },
        { label: 'Filtro Aire Primario', value: safeFilters.primaryAirFilter, key: 'primaryAirFilter' as const },
        { label: 'Filtro Aire Secundario', value: safeFilters.secondaryAirFilter, key: 'secondaryAirFilter' as const },
        { label: 'Filtro Habitaculo', value: safeFilters.cabinFilter, key: 'cabinFilter' as const },
      ]
    : []

  const handleCopySpecs = async (source: FleetUnit) => {
    if (!selectedUnit) return
    setIsCopyingSpecs(true)
    const update = { lubricants: source.lubricants, filters: source.filters }
    updateUnit((unit) => ({ ...unit, ...update }))
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await apiRequest(`/fleet/${selectedUnit.id}`, { method: 'PATCH', body: update }).catch(() => null)
    }
    setIsCopyingSpecs(false)
    setCopySpecsOpen(false)
    setCopySpecsSearch('')
    setCopySpecsSource(null)
  }

  const fetchImageAsDataUrl = async (url: string): Promise<string> => {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error('No se pudo descargar el QR.')
    }
    const blob = await response.blob()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
      reader.onerror = () => reject(new Error('No se pudo leer el QR.'))
      reader.readAsDataURL(blob)
    })
  }

  const handlePrintQr = () => {
    if (!qrProfileUrl || !selectedUnit) {
      return
    }

    const printWindow = window.open('', '_blank', 'noopener,noreferrer')

    if (!printWindow) {
      return
    }

    printWindow.document.write(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <title>QR</title>
    <style>
      * { box-sizing: border-box; font-family: Arial, sans-serif; }
      body { margin: 0; padding: 12px; color: #0f172a; }
      .sheet {
        width: 8cm;
        height: 8cm;
        border: 2px solid #0f172a;
        padding: 0.35cm;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
      }
      .qr { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
      .qr img { width: 6.8cm; height: 6.8cm; }
      @page { size: 8cm 8cm; margin: 0; }
      @media print {
        body { padding: 0; }
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="qr"><img src="${buildQrImageUrl(qrProfileUrl)}" alt="QR" /></div>
    </div>
  </body>
</html>`)

    printWindow.document.close()
    printWindow.focus()
    printWindow.print()
  }

  const handleDownloadQrPdf = async () => {
    if (!qrProfileUrl || !selectedUnit) {
      return
    }

    try {
      setIsQrPdfLoading(true)
      const { jsPDF } = await import('jspdf')
      const qrDataUrl = await fetchImageAsDataUrl(buildQrImageUrl(qrProfileUrl))
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'cm',
        format: [8, 8],
      })

      doc.setLineWidth(0.05)
      doc.rect(0.1, 0.1, 7.8, 7.8)
      doc.addImage(qrDataUrl, 'PNG', 0.6, 0.6, 6.8, 6.8)
      doc.save(`QR-${selectedUnit.internalCode}.pdf`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo generar el PDF del QR.')
    } finally {
      setIsQrPdfLoading(false)
    }
  }

  const handlePhotoUpload = async (file: File | null | undefined) => {
    if (!file || !selectedUnit) return
    setIsUploadingPhoto(true)
    const reader = new FileReader()
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : ''
      apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: {
          fileName: `${selectedUnit.id}-profile-${file.name}`,
          contentType: file.type || 'image/jpeg',
          dataUrl,
          folder: 'fleet-photos',
        },
      })
        .then((response) => {
          updateUnit((unit) => ({ ...unit, profilePhotoUrl: response.url }))
          apiRequest(`/fleet/${selectedUnit.id}`, {
            method: 'PATCH',
            body: { profilePhotoUrl: response.url },
          }).catch(() => null)
        })
        .catch(() => null)
        .finally(() => setIsUploadingPhoto(false))
    }
    reader.onerror = () => setIsUploadingPhoto(false)
    reader.readAsDataURL(file)
  }

  const handleDeletePhoto = () => {
    if (!canEditFleet || !selectedUnit) return
    if (!window.confirm('¿Eliminar foto de perfil del vehículo?')) return
    updateUnit((unit) => ({ ...unit, profilePhotoUrl: null }))
    apiRequest(`/fleet/${selectedUnit.id}`, {
      method: 'PATCH',
      body: { profilePhotoUrl: null },
    }).catch(() => null)
  }

  const handleDownloadFichaPdf = async () => {
    if (!selectedUnit) return
    setIsDownloadingFicha(true)
    try {
      const { jsPDF } = await import('jspdf')
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })

      const pageW = 210
      const pageH = 297
      const mg = 14
      const cW = pageW - mg * 2
      let y = 0

      // Colores Enertrans
      const BLACK: [number, number, number] = [10, 10, 10]
      const YELLOW: [number, number, number] = [245, 195, 0]
      const GRAY_LABEL: [number, number, number] = [100, 100, 100]
      const GRAY_LIGHT: [number, number, number] = [240, 240, 240]

      const txt = (
        text: string,
        x: number,
        yPos: number,
        opts?: { size?: number; bold?: boolean; color?: [number, number, number]; align?: 'left' | 'center' | 'right' },
      ) => {
        doc.setFontSize(opts?.size ?? 10)
        doc.setFont('helvetica', opts?.bold ? 'bold' : 'normal')
        const c = opts?.color ?? BLACK
        doc.setTextColor(c[0], c[1], c[2])
        doc.text(text, x, yPos, { align: opts?.align ?? 'left' })
      }

      const section = (title: string, yPos: number): number => {
        // Barra amarilla fina a la izquierda + fondo gris claro
        doc.setFillColor(...GRAY_LIGHT)
        doc.rect(mg, yPos, cW, 6.5, 'F')
        doc.setFillColor(...YELLOW)
        doc.rect(mg, yPos, 2.5, 6.5, 'F')
        txt(title.toUpperCase(), mg + 5, yPos + 4.5, { size: 7.5, bold: true, color: BLACK })
        return yPos + 9
      }

      const dataRow = (label: string, value: string, x: number, yPos: number) => {
        txt(label, x, yPos, { size: 8, color: GRAY_LABEL })
        txt(value || '—', x, yPos + 4.5, { size: 9, bold: true, color: BLACK })
      }

      // ── HEADER NEGRO ──────────────────────────────────────────
      doc.setFillColor(...BLACK)
      doc.rect(0, 0, pageW, 28, 'F')

      // Logo Enertrans
      try {
        const logoData = await fetchImageAsDataUrl(enertransLogoUrl)
        doc.addImage(logoData, 'PNG', mg, 2, 22, 22)
      } catch { /* skip logo */ }

      // Nombre empresa y título
      txt('ENERTRANS', mg + 25, 10, { size: 14, bold: true, color: [255, 255, 255] })
      txt('Hidrogrúas · Logística', mg + 25, 16, { size: 8, color: YELLOW })
      txt('FICHA TÉCNICA DEL VEHÍCULO', pageW - mg, 10, { size: 11, bold: true, color: YELLOW, align: 'right' })
      txt(new Date().toLocaleDateString('es-AR'), pageW - mg, 16, { size: 7.5, color: [180, 180, 180], align: 'right' })

      // Línea amarilla decorativa
      doc.setFillColor(...YELLOW)
      doc.rect(0, 28, pageW, 1.5, 'F')

      y = 36

      // ── FOTO + DATOS PRINCIPALES ──────────────────────────────
      let photoLoaded = false
      if (selectedUnit.profilePhotoUrl) {
        try {
          const photoData = await fetchImageAsDataUrl(selectedUnit.profilePhotoUrl)
          doc.addImage(photoData, 'JPEG', mg, y, 72, 52)
          // Borde amarillo alrededor de la foto
          doc.setDrawColor(...YELLOW)
          doc.setLineWidth(0.8)
          doc.rect(mg, y, 72, 52)
          photoLoaded = true
        } catch { /* skip */ }
      }

      const infoX = photoLoaded ? mg + 77 : mg
      const infoW = photoLoaded ? cW - 77 : cW

      // Dominio / código del vehículo
      txt(selectedUnit.internalCode, infoX, y + 10, { size: 20, bold: true, color: BLACK })

      // Línea amarilla bajo el dominio
      doc.setFillColor(...YELLOW)
      doc.rect(infoX, y + 13, infoW, 0.8, 'F')

      txt(`${selectedUnit.brand} ${selectedUnit.model}`.trim() || '—', infoX, y + 20, { size: 10.5, bold: true, color: BLACK })
      txt(getFleetUnitTypeLabel(selectedUnit.unitType), infoX, y + 27, { size: 9, color: GRAY_LABEL })
      txt(`Año: ${selectedUnit.year || '—'}`, infoX, y + 33, { size: 9, color: GRAY_LABEL })
      if (selectedUnit.clientName) {
        txt(`Cliente: ${selectedUnit.clientName}`, infoX, y + 39, { size: 9, color: GRAY_LABEL })
      }
      if (selectedUnit.location) {
        txt(`Ubicación: ${selectedUnit.location}`, infoX, y + 45, { size: 9, color: GRAY_LABEL })
      }

      y += photoLoaded ? 58 : 52

      // ── DATOS DEL VEHÍCULO ────────────────────────────────────
      y = section('Datos del vehículo', y + 4)

      const col1 = mg
      const col2 = mg + cW / 3
      const col3 = mg + (cW / 3) * 2
      const rowH = 11

      const specs: [string, string, string][] = [
        ['N° Chasis', selectedUnit.chassisNumber, ''],
        ['N° Motor', selectedUnit.engineNumber, ''],
        ...(selectedUnit.engineCylinders ? [['Cilindros', `${selectedUnit.engineCylinders} cil.`, ''] as [string, string, string]] : []),
        ...(selectedUnit.currentKilometers ? [['Km actuales', `${selectedUnit.currentKilometers.toLocaleString('es-AR')} km`, ''] as [string, string, string]] : []),
        ...(selectedUnit.currentEngineHours ? [['Horas motor', `${selectedUnit.currentEngineHours.toLocaleString('es-AR')} hs`, ''] as [string, string, string]] : []),
        ...(selectedUnit.tareWeightKg ? [['Tara', `${selectedUnit.tareWeightKg} kg`, ''] as [string, string, string]] : []),
        ...(selectedUnit.maxLoadKg ? [['Carga máx.', `${selectedUnit.maxLoadKg} kg`, ''] as [string, string, string]] : []),
      ]

      // En filas de a 3 columnas
      const specGroups: [string, string][][] = []
      for (let i = 0; i < specs.length; i += 3) {
        specGroups.push(specs.slice(i, i + 3).map(([l, v]) => [l, v]))
      }
      for (const group of specGroups) {
        const cols = [col1, col2, col3]
        group.forEach(([label, value], idx) => { dataRow(label, value, cols[idx] ?? col1, y) })
        y += rowH
      }

      if (selectedUnit.configurationNotes) {
        y += 2
        txt('Notas de configuración:', col1, y, { size: 7.5, color: GRAY_LABEL })
        y += 4
        const lines = doc.splitTextToSize(selectedUnit.configurationNotes, cW) as string[]
        txt(lines.join('\n'), col1, y, { size: 8.5, color: BLACK })
        y += lines.length * 4.8
      }

      // ── LUBRICANTES ───────────────────────────────────────────
      const lubPairs = [
        ['Aceite Motor', safeLubricants.engineOil],
        ['Litros Motor', safeLubricants.engineOilLiters],
        ['Aceite Caja', safeLubricants.gearboxOil],
        ['Litros Caja', safeLubricants.gearboxOilLiters],
        ['Aceite Diferencial', safeLubricants.differentialOil],
        ['Litros Diferencial', safeLubricants.differentialOilLiters],
        ['Líquido Embrague', safeLubricants.clutchFluid],
        ['Refrigerante', safeLubricants.coolant],
        ['Aceite Hidráulico', safeLubricants.hydraulicOil],
      ].filter(([, v]) => Boolean(v)) as [string, string][]

      if (lubPairs.length > 0) {
        y += 4
        y = section('Lubricantes', y)
        const lubGroups: [string, string][][] = []
        for (let i = 0; i < lubPairs.length; i += 3) lubGroups.push(lubPairs.slice(i, i + 3))
        for (const group of lubGroups) {
          const cols = [col1, col2, col3]
          group.forEach(([label, value], idx) => { dataRow(label, value, cols[idx] ?? col1, y) })
          y += rowH
        }
      }

      // ── FILTROS ───────────────────────────────────────────────
      const filtPairs = [
        ['Filtro Aceite', safeFilters.oilFilter],
        ['Filtro Combustible', safeFilters.fuelFilter],
        ['Filtro TA', safeFilters.taFilter],
        ['Filtro Aire Primario', safeFilters.primaryAirFilter],
        ['Filtro Aire Secundario', safeFilters.secondaryAirFilter],
        ['Filtro Habitáculo', safeFilters.cabinFilter],
      ].filter(([, v]) => Boolean(v)) as [string, string][]

      if (filtPairs.length > 0) {
        y += 4
        y = section('Filtros', y)
        const filtGroups: [string, string][][] = []
        for (let i = 0; i < filtPairs.length; i += 3) filtGroups.push(filtPairs.slice(i, i + 3))
        for (const group of filtGroups) {
          const cols = [col1, col2, col3]
          group.forEach(([label, value], idx) => { dataRow(label, value, cols[idx] ?? col1, y) })
          y += rowH
        }
      }

      // ── HIDROGRÚA ─────────────────────────────────────────────
      if (selectedUnit.hasHydroCrane) {
        y += 4
        y = section('Hidrogrúa', y)
        dataRow('Marca', selectedUnit.hydroCraneBrand, col1, y)
        dataRow('Modelo', selectedUnit.hydroCraneModel, col2, y)
        dataRow('N° serie', selectedUnit.hydroCraneSerialNumber, col3, y)
        y += rowH
      }

      // ── SEMIRREMOLQUE ─────────────────────────────────────────
      if (selectedUnit.hasSemiTrailer) {
        y += 4
        y = section('Semirremolque', y)
        dataRow('Dominio', associatedSemiTrailer?.internalCode || selectedUnit.semiTrailerLicensePlate, col1, y)
        dataRow('Marca', associatedSemiTrailer?.semiTrailerBrand || selectedUnit.semiTrailerBrand, col2, y)
        dataRow('Modelo', associatedSemiTrailer?.semiTrailerModel || selectedUnit.semiTrailerModel, col3, y)
        y += rowH
        dataRow('N° chasis', associatedSemiTrailer?.semiTrailerChassisNumber || selectedUnit.semiTrailerChassisNumber, col1, y)
        y += rowH
      }

      // ── FOOTER ────────────────────────────────────────────────
      doc.setFillColor(...BLACK)
      doc.rect(0, pageH - 14, pageW, 14, 'F')
      doc.setFillColor(...YELLOW)
      doc.rect(0, pageH - 14, pageW, 1, 'F')
      txt('ENERTRANS · Hidrogrúas y Logística', mg, pageH - 6, { size: 7.5, bold: true, color: [255, 255, 255] })
      txt(
        `Generado el ${new Date().toLocaleString('es-AR')}`,
        pageW - mg,
        pageH - 6,
        { size: 7, color: [160, 160, 160], align: 'right' },
      )

      doc.save(`Ficha-${selectedUnit.internalCode}.pdf`)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'No se pudo generar el PDF.')
    } finally {
      setIsDownloadingFicha(false)
    }
  }

  if (!unitId || !selectedUnit) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Unidad no encontrada</h2>
        <p className="mt-2 text-sm text-slate-600">No se encontro la unidad solicitada para detalle.</p>
        <Link
          to={ROUTE_PATHS.fleet.list}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Volver a Flota
        </Link>
      </section>
    )
  }

  const activeTabLabel = detailTabs.find((tab) => tab.id === activeTab)?.label ?? ''

  return (
    <section className="space-y-5">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <BackLink historyBack label="Volver a flota" />
            <h2 className="text-xl font-bold text-slate-900">Detalle de Unidad</h2>
            <p className="mt-1 text-sm text-slate-600">{selectedUnit.internalCode}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditFleet ? (
              <Link
                to={buildFleetEditPath(selectedUnit.id)}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Editar unidad
              </Link>
            ) : null}
            <button
              type="button"
              onClick={() => { void handleDownloadFichaPdf() }}
              disabled={isDownloadingFicha}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
            >
              {isDownloadingFicha ? 'Generando PDF...' : 'Descargar ficha PDF'}
            </button>
            <button
              type="button"
              onClick={() => setIsQrOpen(true)}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
              disabled={!qrProfileUrl}
            >
              Ver QR
            </button>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Empresa propietaria</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.ownerCompany}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Marca</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.brand || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Modelo</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.model || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Año</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.year || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Cliente</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.clientName || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Ubicacion</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.location || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Tipo de unidad</dt>
            <dd className="mt-1 font-semibold text-slate-900">{getFleetUnitTypeLabel(selectedUnit.unitType)}</dd>
          </div>
          {selectedUnit.currentKilometers > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Km actuales</dt>
              <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.currentKilometers.toLocaleString('es-AR')} km</dd>
            </div>
          ) : null}
          {selectedUnit.currentEngineHours > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Horas de motor</dt>
              <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.currentEngineHours.toLocaleString('es-AR')} hs</dd>
            </div>
          ) : null}
          {selectedUnit.engineCylinders ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">Cilindros</dt>
              <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.engineCylinders} cil.</dd>
            </div>
          ) : null}
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Estado operativo</dt>
            <dd className="mt-2">
              <span
                className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${operationalStatusClassMap[selectedUnit.operationalStatus]}`}
              >
                {getOperationalStatusLabel(selectedUnit.operationalStatus)}
              </span>
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Hidrogrua</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.hasHydroCrane ? 'Si' : 'No'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Semirremolque</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.hasSemiTrailer ? 'Si' : 'No'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2 xl:col-span-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Rastreo</dt>
            <dd className="mt-2 grid gap-2 md:grid-cols-3">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(safeTracking.ituran)}
                  onChange={(event) => handleTrackingChange('ituran', event.target.checked)}
                  disabled={!canEditFleet}
                />
                ITURAN
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(safeTracking.rsv)}
                  onChange={(event) => handleTrackingChange('rsv', event.target.checked)}
                  disabled={!canEditFleet}
                />
                RSV
              </label>
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={Boolean(safeTracking.microtrack)}
                  onChange={(event) => handleTrackingChange('microtrack', event.target.checked)}
                  disabled={!canEditFleet}
                />
                MICROTRACK
              </label>
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">N° chasis</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.chassisNumber}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">N° motor</dt>
            <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.engineNumber}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Tara / Carga maxima</dt>
            <dd className="mt-1 font-semibold text-slate-900">
              {selectedUnit.tareWeightKg > 0 || selectedUnit.maxLoadKg > 0
                ? `${selectedUnit.tareWeightKg > 0 ? `${selectedUnit.tareWeightKg} kg` : '—'} / ${
                    selectedUnit.maxLoadKg > 0 ? `${selectedUnit.maxLoadKg} kg` : '—'
                  }`
                : 'No aplica'}
            </dd>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 md:col-span-2 xl:col-span-3">
            <dt className="text-xs uppercase tracking-wide text-slate-500">Identificacion</dt>
            <dd className="mt-1 text-sm font-semibold text-slate-900">{selectedUnit.internalCode}</dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima inspeccion</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {latestAudit ? auditResultLabelMap[latestAudit.result] : 'Sin inspecciones'}
            </p>
            <p className="text-xs text-slate-600">
              {latestAudit ? formatDateTime(latestAudit.performedAt) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima re-inspeccion</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {latestReaudit ? auditResultLabelMap[latestReaudit.result] : 'Sin re-inspecciones'}
            </p>
            <p className="text-xs text-slate-600">
              {latestReaudit ? formatDateTime(latestReaudit.performedAt) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">OT abiertas</p>
            <p className="mt-2 text-2xl font-bold text-slate-900">{openWorkOrdersCount}</p>
            <p className="text-xs text-slate-600">Total OT: {unitWorkOrders.length}</p>
          </div>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima reparacion</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {latestRepair ? `Costo: $${latestRepair.realCost}` : 'Sin reparaciones'}
            </p>
            <p className="text-xs text-slate-600">{latestRepair?.createdAt ? formatDateTime(latestRepair.createdAt) : '—'}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proximo service motor</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {motorMaintenancePlan
                ? `${motorMeasurementUnit === 'KILOMETERS' ? motorMaintenancePlan.nextServiceByKilometers : motorMaintenancePlan.nextServiceByHours} ${motorMeasurementUnit === 'KILOMETERS' ? 'km' : 'hs'}`
                : 'Sin plan cargado'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Documentacion</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold">
              {(['rto', 'insurance', 'hoist'] as const).map((docKey) => {
                if (docKey === 'hoist' && safeDocuments.hoistNotApplicable) {
                  return (
                    <span key={docKey} className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-slate-500">
                      Izaje N/A
                    </span>
                  )
                }
                const labelMap = { rto: 'RTO', insurance: 'Seguro', hoist: 'Izaje' }
                const status = getDocumentStatus(safeDocuments?.[docKey]?.expiresAt)
                const statusClass = documentStatusClassMap[status]
                return (
                  <span key={docKey} className={`rounded-full border px-2 py-1 ${statusClass}`}>
                    {labelMap[docKey]}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        <p className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <span className="font-semibold">Configuracion:</span> {selectedUnit.configurationNotes || 'Sin configuracion registrada.'}
        </p>

        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-bold text-slate-900">Foto del vehículo</h4>
          <div className="mt-3 flex flex-wrap items-start gap-4">
            {selectedUnit.profilePhotoUrl ? (
              <div className="relative">
                <img
                  src={selectedUnit.profilePhotoUrl}
                  alt="Foto del vehículo"
                  className="h-40 w-56 rounded-lg border border-slate-200 object-cover"
                />
                {canEditFleet ? (
                  <button
                    type="button"
                    onClick={handleDeletePhoto}
                    className="absolute right-1 top-1 rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-700 hover:bg-rose-100"
                  >
                    Eliminar
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex h-40 w-56 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400">
                Sin foto registrada
              </div>
            )}
            {canEditFleet ? (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-slate-500">
                  {selectedUnit.profilePhotoUrl ? 'Reemplazar foto' : 'Subir foto del camión'}
                </p>
                <label className={`inline-flex cursor-pointer items-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 ${isUploadingPhoto ? 'pointer-events-none opacity-50' : ''}`}>
                  {isUploadingPhoto ? 'Subiendo...' : 'Seleccionar imagen'}
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    disabled={isUploadingPhoto}
                    onChange={(event) => { void handlePhotoUpload(event.target.files?.[0]) }}
                  />
                </label>
              </div>
            ) : null}
          </div>
        </section>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
              <span className="text-sm font-bold text-slate-700">Lubricantes</span>
              {canEditFleet && (
                <button
                  type="button"
                  onClick={() => setCopySpecsOpen(true)}
                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Copiar de otra unidad
                </button>
              )}
            </div>
            <div className="divide-y divide-slate-200">
              {lubricantRows.map((row) => (
                <div key={row.key} className="grid grid-cols-2 items-center gap-3 px-4 py-2 text-sm">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-semibold text-slate-900">{row.value || '-'}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">
              Filtros
            </div>
            <div className="divide-y divide-slate-200">
              {filterRows.map((row) => (
                <div key={row.key} className="grid grid-cols-2 items-center gap-3 px-4 py-2 text-sm">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-semibold text-slate-900">{row.value || '-'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <h4 className="text-sm font-bold text-slate-900">Documentación básica</h4>
          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            {(
              [
                { key: 'rto', title: 'RTO / VTV', tracksExpiration: true },
                { key: 'insurance', title: 'Seguro', tracksExpiration: true },
                { key: 'hoist', title: 'Certificación de Izaje' },
                { key: 'title', title: 'Titulo', tracksExpiration: false },
                { key: 'registration', title: 'Cedula', tracksExpiration: false },
              ] as const
            ).map((doc) => {
              const docData = safeDocuments[doc.key] ?? emptyDoc
              const hasFile = Boolean(docData.fileUrl || docData.fileBase64)
              const isNotApplicable = doc.key === 'hoist' && hoistNotApplicable
              const tracksExpiration = 'tracksExpiration' in doc ? doc.tracksExpiration : true
              const docStatus = tracksExpiration ? getDocumentStatus(docData.expiresAt, 30, isNotApplicable) : 'na'
              const docStatusClass = documentStatusClassMap[docStatus]
              return (
                <div key={doc.key} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{doc.title}</p>
                      <p className="text-xs text-slate-500">{tracksExpiration ? 'Vencimiento' : 'Documento informativo'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className={[
                          'rounded-full px-2 py-1 text-xs font-semibold',
                          isNotApplicable
                            ? 'border border-slate-200 bg-slate-50 text-slate-500'
                            : hasFile
                              ? 'border border-emerald-300 bg-emerald-50 text-emerald-700'
                              : 'border border-slate-200 bg-slate-100 text-slate-600',
                        ].join(' ')}
                      >
                        {isNotApplicable ? 'No aplica' : hasFile ? 'Cargado' : 'No cargado'}
                      </span>
                      {tracksExpiration ? (
                        <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${docStatusClass}`}>
                          {documentStatusLabelMap[docStatus]}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {tracksExpiration ? (
                    <input
                      type="date"
                      className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-amber-400"
                      value={docData.expiresAt}
                      onChange={(event) => handleDocumentExpirationChange(doc.key, event.target.value)}
                      disabled={!canEditFleet || (doc.key === 'hoist' && hoistNotApplicable)}
                    />
                  ) : null}

                  {doc.key === 'rto' ? (
                    <div className="mt-3 grid gap-2">
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={Boolean(docData.rtoProvincial)}
                          onChange={(event) => handleRtoJurisdictionChange('rtoProvincial', event.target.checked)}
                          disabled={!canEditFleet}
                        />
                        RTO provincial
                      </label>
                      <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                        <input
                          type="checkbox"
                          checked={Boolean(docData.rtoNacional)}
                          onChange={(event) => handleRtoJurisdictionChange('rtoNacional', event.target.checked)}
                          disabled={!canEditFleet}
                        />
                        RTO nacional
                      </label>
                    </div>
                  ) : null}

                  {doc.key === 'hoist' ? (
                    <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <input
                        type="checkbox"
                        checked={hoistNotApplicable}
                        onChange={(event) => {
                          const nextDocuments = {
                            ...(selectedUnit?.documents ?? emptyDocs),
                            hoistNotApplicable: event.target.checked,
                          }
                          const invalidDocs = hasInvalidDocuments(nextDocuments as any, requiresHoist)
                          const nextOperationalStatus = resolveOperationalStatus(invalidDocs)
                          updateUnit((unit) => ({
                            ...unit,
                            documents: nextDocuments as any,
                            operationalStatus: nextOperationalStatus,
                          }))
                          if (typeof navigator !== 'undefined' && navigator.onLine && selectedUnit) {
                            apiRequest(`/fleet/${selectedUnit.id}`, {
                              method: 'PATCH',
                              body: { documents: nextDocuments, operationalStatus: nextOperationalStatus },
                            }).catch(() => null)
                          }
                        }}
                      />
                      Izaje no aplica
                    </label>
                  ) : null}

                  <div className="mt-3 text-xs text-slate-600">
                    {docData.fileName ? `Archivo: ${docData.fileName}` : 'Sin archivos seleccionados'}
                    {docData.fileUrl ? (
                      <span className="ml-2 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        En la nube
                      </span>
                    ) : null}
                  </div>

                  {hasFile ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => openDocument(doc.key)}
                        className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100"
                      >
                        Ver archivo
                      </button>
                      {doc.key === 'insurance' || doc.key === 'title' || doc.key === 'registration' ? (
                        <button
                          type="button"
                          onClick={() => downloadDocument(doc.key)}
                          className="inline-flex items-center rounded-lg border border-sky-300 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                        >
                          Descargar PDF
                        </button>
                      ) : null}
                      {canDeleteFleetDocuments ? (
                        <button
                          type="button"
                          onClick={() => handleDeleteDocumentFile(doc.key)}
                          className="inline-flex items-center rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                        >
                          Eliminar archivo
                        </button>
                      ) : null}
                    </div>
                  ) : null}

                  <input
                    type="file"
                    className="mt-2 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-200 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-700 hover:file:bg-slate-300"
                    onChange={(event) => handleDocumentFileChange(doc.key, event.target.files?.[0] ?? null)}
                    disabled={!canEditFleet || (doc.key === 'hoist' && hoistNotApplicable)}
                  />
                </div>
              )
            })}
          </div>
        </section>

        {selectedUnit.hasHydroCrane ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Datos de hidrogrua</p>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Marca</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.hydroCraneBrand}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Modelo</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.hydroCraneModel}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">N° serie</dt>
                <dd className="mt-1 font-semibold text-slate-900">{selectedUnit.hydroCraneSerialNumber}</dd>
              </div>
            </dl>
          </div>
        ) : null}

        {selectedUnit.hasSemiTrailer ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Datos de semirremolque</p>
              {associatedSemiTrailer ? (
                <Link
                  to={buildFleetDetailPath(associatedSemiTrailer.id)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Ver perfil del semirremolque
                </Link>
              ) : null}
            </div>
            <dl className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Dominio</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {associatedSemiTrailer?.internalCode || selectedUnit.semiTrailerLicensePlate}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Marca</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {associatedSemiTrailer?.semiTrailerBrand || selectedUnit.semiTrailerBrand}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Modelo</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {associatedSemiTrailer?.semiTrailerModel || selectedUnit.semiTrailerModel}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">Anio</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {associatedSemiTrailer?.semiTrailerYear || selectedUnit.semiTrailerYear}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-500">N° chasis</dt>
                <dd className="mt-1 font-semibold text-slate-900">
                  {associatedSemiTrailer?.semiTrailerChassisNumber || selectedUnit.semiTrailerChassisNumber}
                </dd>
              </div>
            </dl>
          </div>
        ) : null}

        {selectedUnit.unitType === 'SEMI_TRAILER' ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tractor asociado actualmente</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {currentTractorForSemiTrailer ? currentTractorForSemiTrailer.internalCode : 'Sin tractor asociado.'}
            </p>
            <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Historial de tractores</p>
            <div className="mt-2 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
              {tractorHistory.length > 0 ? (
                tractorHistory.map((unit) => (
                  <div key={unit.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{unit.internalCode}</p>
                    <p className="text-xs text-slate-600">{unit.ownerCompany}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-600">Sin historial registrado.</p>
              )}
            </div>
          </div>
        ) : null}
      </header>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-3">
          {detailTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={[
                'rounded-lg px-3 py-2 text-sm font-semibold transition-colors',
                activeTab === tab.id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="pt-4">
          {activeTab === 'maintenancePlan' ? (
            <div className="space-y-4 text-sm text-slate-700">
              <p>Planes registrados: {unitMaintenancePlans.length}</p>
              {unitMaintenancePlans.length > 0 ? (
                unitMaintenancePlans.map((plan) => {
                  const measurementUnit = getMeasurementUnit(selectedUnit.unitType, plan.maintenanceType)
                  const isKilometers = measurementUnit === 'KILOMETERS'
                  const current = isKilometers ? plan.currentKilometers : plan.currentHours
                  const nextServiceBy = isKilometers ? plan.nextServiceByKilometers : plan.nextServiceByHours
                  const unitLabel = isKilometers ? 'km' : 'hs'
                  return (
                    <div key={plan.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                      <p className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                        {maintenanceTypeLabels[plan.maintenanceType] ?? plan.maintenanceType}
                        <StatusPill status={plan.status} />
                      </p>
                      <p className="text-xs text-slate-600">
                        Actual: {current} {unitLabel} | Próximo service: {nextServiceBy} {unitLabel}
                      </p>
                    </div>
                  )
                })
              ) : (
                <p className="text-xs text-slate-500">Sin planes cargados.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'audits' ? (
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>Inspecciones registradas: {unitAudits.length}</p>
                {canCreateAudits ? (
                  <Link
                    to={`${ROUTE_PATHS.audits}?unitId=${selectedUnit.id}&create=1`}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                  >
                    Nueva inspeccion
                  </Link>
                ) : null}
              </div>
              {unitAudits.length > 0 ? (
                unitAudits.map((audit) => (
                  <div key={audit.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{auditResultLabelMap[audit.result]}</p>
                    <p className="text-xs text-slate-600">Auditor: {audit.auditorName || 'No definido'}</p>
                    <p className="text-xs text-slate-600">Fecha: {formatDateTime(audit.performedAt)}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin inspecciones cargadas.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'workOrders' ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Ordenes de trabajo registradas: {unitWorkOrders.length}</p>
              {unitWorkOrders.length > 0 ? (
                unitWorkOrders.map((workOrder) => (
                  <div key={workOrder.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">
                      {workOrderStatusLabelMap[workOrder.status]}
                    </p>
                    <p className="text-xs text-slate-600">Tareas: {workOrder.taskList.length}</p>
                    <p className="text-xs text-slate-600">Repuestos: {workOrder.spareParts.length}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin ordenes registradas.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'repairs' ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Reparaciones registradas: {unitRepairs.length}</p>
              {unitRepairs.length > 0 ? (
                unitRepairs.map((repair) => (
                  <div key={repair.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{repair.supplierName}</p>
                    <p className="text-xs text-slate-600">
                      {repair.sourceType === 'EXTERNAL_REQUEST' ? 'Nota externa' : 'OT'}:{' '}
                      {repair.sourceType === 'EXTERNAL_REQUEST'
                        ? externalRequestMap.get(repair.externalRequestId ?? '')?.code ?? 'N/D'
                        : repair.workOrderId?.slice(0, 8)}
                    </p>
                    <p className="text-xs text-slate-600">Costo real: {repair.realCost}</p>
                    <p className="text-xs text-slate-600">Facturado: {repair.invoicedToClient}</p>
                    {repair.invoiceFileUrl ? (
                      <a
                        className="text-xs font-semibold text-amber-700 hover:text-amber-800"
                        href={repair.invoiceFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver factura adjunta
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin reparaciones registradas.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'externalRequests' ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Notas externas registradas: {unitExternalRequests.length}</p>
              {unitExternalRequests.length > 0 ? (
                unitExternalRequests.map((request) => (
                  <div key={request.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{request.code}</p>
                    <p className="text-xs text-slate-600">Empresa: {request.companyName || '-'}</p>
                    <p className="text-xs text-slate-600">Descripcion: {request.description}</p>
                    <ul className="mt-2 list-disc pl-4 text-xs text-slate-600">
                      {request.tasks.map((task) => (
                        <li key={`${request.id}-${task}`}>{task}</li>
                      ))}
                    </ul>
                    {request.providerFileUrl ? (
                      <a
                        className="mt-2 inline-flex text-xs font-semibold text-amber-700 hover:text-amber-800"
                        href={request.providerFileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Ver adjunto proveedor
                      </a>
                    ) : null}
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin notas externas registradas.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'movements' ? (
            <FleetMovementsPanel
              unitId={selectedUnit.id}
              fleetUnits={fleetUnits}
              movements={movements}
            />
          ) : null}

          {activeTab === 'gpsTelemetry' ? <FleetGpsPanel unitId={selectedUnit.id} /> : null}

          {activeTab === 'inventory' ? (
            <div className="space-y-2 text-sm text-slate-700">
              <p>Items de inventario asociados: {associatedInventory.length}</p>
              {associatedInventory.length > 0 ? (
                associatedInventory.map((item) => (
                  <div key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{item.productName}</p>
                    <p className="text-xs text-slate-600">SKU: {item.sku}</p>
                    <p className="text-xs text-slate-600">Stock: {item.stock}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin inventario asociado.</p>
              )}
            </div>
          ) : null}

          {activeTab === 'serviceOrders' ? (
            <div className="space-y-2">
              {(() => {
                const unitOs = serviceOrders.filter((os) => os.unitId === selectedUnit.id)
                const statusColors: Record<string, string> = {
                  OPEN: 'bg-red-100 text-red-800',
                  IN_PROGRESS: 'bg-amber-100 text-amber-800',
                  WAITING_PARTS: 'bg-blue-100 text-blue-800',
                  CLOSED: 'bg-green-100 text-green-800',
                }
                const statusLabels: Record<string, string> = {
                  OPEN: 'Abierta',
                  IN_PROGRESS: 'En proceso',
                  WAITING_PARTS: 'Esperando repuestos',
                  CLOSED: 'Cerrada',
                }
                if (unitOs.length === 0) {
                  return <p className="text-xs text-slate-500">No hay órdenes de servicio para esta unidad.</p>
                }
                return unitOs.map((os) => (
                  <Link key={os.id} to={buildServiceOrderDetailPath(os.id)} className="block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 hover:bg-slate-100">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-slate-700">{os.code}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[os.status] ?? ''}`}>
                        {statusLabels[os.status] ?? os.status}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-800 line-clamp-2">{os.reportedFault}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(os.createdAt).toLocaleDateString('es-AR')}</p>
                  </Link>
                ))
              })()}
            </div>
          ) : null}
        </div>
      </div>

      <p className="text-xs uppercase tracking-wide text-slate-500">Tab activa: {activeTabLabel}</p>

      {isQrOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">QR de unidad</h3>
                <p className="text-sm text-slate-600">{selectedUnit.internalCode}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsQrOpen(false)}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 flex flex-col items-center gap-3">
              {qrImageUrl ? (
                <img src={qrImageUrl} alt="QR de unidad" className="h-56 w-56 rounded-lg border border-slate-200" />
              ) : (
                <p className="text-sm text-slate-600">No se pudo generar el QR.</p>
              )}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (qrProfileUrl && typeof navigator !== 'undefined' && navigator.clipboard) {
                    navigator.clipboard.writeText(qrProfileUrl)
                  }
                }}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                Copiar link
              </button>
              <button
                type="button"
                onClick={handleDownloadQrPdf}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                disabled={isQrPdfLoading}
              >
                {isQrPdfLoading ? 'Generando PDF...' : 'Descargar PDF'}
              </button>
              <button
                type="button"
                onClick={handlePrintQr}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
                disabled={!qrProfileUrl}
              >
                Imprimir
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {copySpecsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Copiar especificaciones de...</h3>
                <p className="text-xs text-slate-500 mt-0.5">Los lubricantes y filtros de la unidad seleccionada se copiarán a esta unidad.</p>
              </div>
              <button
                type="button"
                onClick={() => { setCopySpecsOpen(false); setCopySpecsSearch(''); setCopySpecsSource(null) }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <input
                value={copySpecsSearch}
                onChange={(e) => setCopySpecsSearch(e.target.value)}
                placeholder="Buscar por dominio, marca, modelo..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              />
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {fleetUnits
                  .filter((u) => u.id !== selectedUnit?.id)
                  .filter((u) => {
                    const s = copySpecsSearch.trim().toLowerCase()
                    if (!s) return true
                    return (
                      u.internalCode.toLowerCase().includes(s) ||
                      u.brand.toLowerCase().includes(s) ||
                      u.model.toLowerCase().includes(s)
                    )
                  })
                  .map((unit) => (
                    <button
                      key={unit.id}
                      type="button"
                      onClick={() => setCopySpecsSource(unit)}
                      className={`w-full px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 ${copySpecsSource?.id === unit.id ? 'border-l-4 border-amber-400 bg-amber-50' : ''}`}
                    >
                      <p className="font-semibold text-slate-900">{unit.internalCode}</p>
                      <p className="text-xs text-slate-500">{unit.brand} {unit.model} · {getFleetUnitTypeLabel(unit.unitType)} · {unit.location || 'Sin ubicación'}</p>
                    </button>
                  ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => { setCopySpecsOpen(false); setCopySpecsSearch(''); setCopySpecsSource(null) }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!copySpecsSource || isCopyingSpecs}
                onClick={() => { if (copySpecsSource) void handleCopySpecs(copySpecsSource) }}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isCopyingSpecs ? 'Copiando...' : 'Confirmar copia'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}



