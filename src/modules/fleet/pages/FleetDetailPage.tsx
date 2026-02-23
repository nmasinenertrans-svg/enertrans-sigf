import { useMemo, useState } from 'react'
import { usePermissions } from '../../../core/auth/usePermissions'
import { Link, useParams } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { buildFleetDetailPath, buildFleetEditPath, ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import { BackLink } from '../../../components/shared/BackLink'
import {
  findFleetUnitById,
  getFleetUnitTypeLabel,
  getOperationalStatusLabel,
  normalizeFleetUnit,
} from '../services/fleetService'
import { workOrderStatusLabelMap } from '../../workOrders/services/workOrdersService'
import { jsPDF } from 'jspdf'
import type { FleetUnit } from '../../../types/domain'
import { FleetMovementsPanel } from '../components/FleetMovementsPanel'

const detailTabs = [
  { id: 'maintenancePlan', label: 'Plan de mantenimiento' },
  { id: 'audits', label: 'Auditorias' },
  { id: 'workOrders', label: 'Ordenes de trabajo' },
  { id: 'repairs', label: 'Reparaciones' },
  { id: 'externalRequests', label: 'Notas externas' },
  { id: 'movements', label: 'Remitos' },
  { id: 'inventory', label: 'Inventario asociado' },
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

const auditResultLabelMap: Record<'APPROVED' | 'REJECTED', string> = {
  APPROVED: 'APROBADO',
  REJECTED: 'RECHAZADO',
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

  const {
    state: { fleetUnits, maintenancePlans, audits, workOrders, repairs, externalRequests, inventoryItems, movements },
    actions: { setFleetUnits, setMovements, setAppError },
  } = useAppContext()

  const canEditFleet = can('FLEET', 'edit')
  const canCreateAudits = can('AUDITS', 'create')

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

  const latestMaintenancePlan = useMemo(() => {
    if (unitMaintenancePlans.length === 0) {
      return undefined
    }
    return unitMaintenancePlans[unitMaintenancePlans.length - 1]
  }, [unitMaintenancePlans])

  const latestServiceSchedule = latestMaintenancePlan?.serviceSchedule ?? {
    motorHours: null,
    motorKilometers: null,
    distributionHours: null,
    distributionKilometers: null,
    gearboxHours: null,
    gearboxKilometers: null,
    coolingHours: null,
    coolingKilometers: null,
    differentialHours: null,
    differentialKilometers: null,
    steeringHours: null,
    steeringKilometers: null,
    clutchHours: null,
    clutchKilometers: null,
    brakesHours: null,
    brakesKilometers: null,
    hydroCraneHours: null,
  }

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
  }, [unitExternalRequests, externalRequests])

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

  const emptyDoc = { fileName: '', fileBase64: '', fileUrl: '', expiresAt: '' }
  const emptyDocs = {
    rto: emptyDoc,
    insurance: emptyDoc,
    hoist: emptyDoc,
    title: emptyDoc,
    registration: emptyDoc,
    hoistNotApplicable: false,
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
            <BackLink to={ROUTE_PATHS.fleet.list} label="Volver a flota" />
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
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima auditoria</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {latestAudit ? auditResultLabelMap[latestAudit.result] : 'Sin auditorias'}
            </p>
            <p className="text-xs text-slate-600">
              {latestAudit ? formatDateTime(latestAudit.performedAt) : '—'}
            </p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ultima re-auditoria</p>
            <p className="mt-2 text-sm font-semibold text-slate-900">
              {latestReaudit ? auditResultLabelMap[latestReaudit.result] : 'Sin re-auditorias'}
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
              {latestServiceSchedule.motorKilometers ?? 'Sin registro'} km
            </p>
            <p className="text-xs text-slate-600">
              {latestServiceSchedule.motorHours ?? 'Sin registro'} hs
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

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <section className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">
              Lubricantes
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
              const docData = safeDocuments[doc.key]
              const hasFile = Boolean(docData.fileUrl || docData.fileBase64)
              const isNotApplicable = doc.key === 'hoist' && hoistNotApplicable
              const tracksExpiration = doc.tracksExpiration ?? true
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
                unitMaintenancePlans.map((plan) => (
                  <div key={plan.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">Estado: {plan.status}</p>
                    <p className="text-xs text-slate-600">Km actuales: {plan.currentKilometers}</p>
                    <p className="text-xs text-slate-600">Horas actuales: {plan.currentHours}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin planes cargados.</p>
              )}

              {latestMaintenancePlan ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h4 className="text-sm font-bold text-slate-900">Histórico de próximos services</h4>
                  <div className="mt-3 grid gap-4 md:grid-cols-2">
                    {[
                      {
                        title: 'Próximos Service motor',
                        hours: latestServiceSchedule.motorHours,
                        kilometers: latestServiceSchedule.motorKilometers,
                      },
                      {
                        title: 'Próximos Service distribución',
                        hours: latestServiceSchedule.distributionHours,
                        kilometers: latestServiceSchedule.distributionKilometers,
                      },
                      {
                        title: 'Próximos Service caja',
                        hours: latestServiceSchedule.gearboxHours,
                        kilometers: latestServiceSchedule.gearboxKilometers,
                      },
                      {
                        title: 'Próximos Service refrigeración',
                        hours: latestServiceSchedule.coolingHours,
                        kilometers: latestServiceSchedule.coolingKilometers,
                      },
                      {
                        title: 'Próximos Service diferencial',
                        hours: latestServiceSchedule.differentialHours,
                        kilometers: latestServiceSchedule.differentialKilometers,
                      },
                      {
                        title: 'Próximos Service dirección',
                        hours: latestServiceSchedule.steeringHours,
                        kilometers: latestServiceSchedule.steeringKilometers,
                      },
                      {
                        title: 'Próximos Service embrague',
                        hours: latestServiceSchedule.clutchHours,
                        kilometers: latestServiceSchedule.clutchKilometers,
                      },
                      {
                        title: 'Próximos Service frenos',
                        hours: latestServiceSchedule.brakesHours,
                        kilometers: latestServiceSchedule.brakesKilometers,
                      },
                      {
                        title: 'Próximos Service hidrogrúa',
                        hours: latestServiceSchedule.hydroCraneHours,
                        kilometers: null,
                      },
                    ].map((item) => (
                      <div key={item.title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <p className="text-sm font-semibold text-slate-900">{item.title}</p>
                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">
                            Según HS Motor: {item.hours ?? 'Sin registro'}
                          </div>
                          <div className="rounded border border-slate-200 bg-white px-2 py-1">
                            Según KM Motor: {item.kilometers ?? 'Sin registro'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === 'audits' ? (
            <div className="space-y-3 text-sm text-slate-700">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p>Auditorias registradas: {unitAudits.length}</p>
                {canCreateAudits ? (
                  <Link
                    to={`${ROUTE_PATHS.audits}?unitId=${selectedUnit.id}&create=1`}
                    className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
                  >
                    Nueva auditoria
                  </Link>
                ) : null}
              </div>
              {unitAudits.length > 0 ? (
                unitAudits.map((audit) => (
                  <div key={audit.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <p className="font-semibold text-slate-900">{audit.result}</p>
                    <p className="text-xs font-semibold text-slate-700">{auditResultLabelMap[audit.result]}</p>
                    <p className="text-xs text-slate-600">Auditor: {audit.auditorName || 'No definido'}</p>
                    <p className="text-xs text-slate-600">Fecha: {formatDateTime(audit.performedAt)}</p>
                  </div>
                ))
              ) : (
                <p className="text-xs text-slate-500">Sin auditorias cargadas.</p>
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
              onMovementsChange={setMovements}
              onError={setAppError}
            />
          ) : null}

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
    </section>
  )
}

