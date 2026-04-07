import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS, buildFleetDetailPath } from '../../../core/routing/routePaths'
import { usePermissions } from '../../../core/auth/usePermissions'
import { FleetUnitCard } from '../components/FleetUnitCard'
import {
  createEmptyFleetFormData,
  fleetUnitTypeLabelMap,
  getOperationalStatusLabel,
  normalizeFleetUnits,
  toFleetUnit,
} from '../services/fleetService'
import { fleetUnitTypes, type FleetUnit } from '../../../types/domain'
import { ApiRequestError, apiRequest } from '../../../services/api/apiClient'
import { enqueueAndSync } from '../../../services/offline/sync'
import { getQueueItems, removeQueueItem } from '../../../services/offline/queue'

interface BarcodeDetectorInstance {
  detect: (source: CanvasImageSource) => Promise<Array<{ rawValue?: string }>>
}

interface BarcodeDetectorCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorInstance
}

interface WindowWithBarcodeDetector extends Window {
  BarcodeDetector?: BarcodeDetectorCtor
}

const qrFormats = ['qr_code']
const UNASSIGNED_CLIENT_FILTER = '__UNASSIGNED__'

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiRequestError) {
    try {
      const parsed = JSON.parse(error.responseBody) as { message?: string }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) {
        return parsed.message
      }
    } catch {
      if (typeof error.responseBody === 'string' && error.responseBody.trim()) {
        return error.responseBody
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  return fallback
}

const parseStatusFilter = (
  raw: string | null,
): 'ALL' | 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE' => {
  if (raw === 'OPERATIONAL' || raw === 'MAINTENANCE' || raw === 'OUT_OF_SERVICE' || raw === 'ALL') {
    return raw
  }
  return 'ALL'
}

const parseDocumentTypeFilter = (raw: string | null): 'ALL' | 'rto' | 'hoist' => {
  if (raw === 'rto' || raw === 'hoist' || raw === 'ALL') {
    return raw
  }
  return 'ALL'
}

const parseDocumentStatusFilter = (raw: string | null): 'ALL' | 'overdue' | 'soon' | 'ok' | 'missing' => {
  if (raw === 'overdue' || raw === 'soon' || raw === 'ok' || raw === 'missing' || raw === 'ALL') {
    return raw
  }
  return 'ALL'
}

const parseUnitTypeFilter = (raw: string | null): 'ALL' | (typeof fleetUnitTypes)[number] => {
  if (raw === 'ALL') {
    return raw
  }
  return fleetUnitTypes.find((item) => item === raw) ?? 'ALL'
}

const getDocumentStatus = (expiresAt?: string): 'overdue' | 'soon' | 'ok' | 'missing' => {
  if (!expiresAt) {
    return 'missing'
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return 'missing'
  }
  const deltaDays = Math.ceil((date.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
  if (deltaDays < 0) {
    return 'overdue'
  }
  if (deltaDays <= 30) {
    return 'soon'
  }
  return 'ok'
}

export const FleetListPage = () => {
  const [searchParams] = useSearchParams()
  const {
    state: { fleetUnits, featureFlags },
    actions: { setFleetUnits, setAppError },
  } = useAppContext()
  const {
    state: { currentUser },
  } = useAppContext()
  const { can } = usePermissions()
  const navigate = useNavigate()
  const canEdit = can('FLEET', 'edit')
  const canDelete = can('FLEET', 'delete')
  const isDev = currentUser?.role === 'DEV'

  const normalizedUnits = useMemo(() => normalizeFleetUnits(fleetUnits), [fleetUnits])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE'>(() =>
    parseStatusFilter(searchParams.get('status')),
  )
  const [documentTypeFilter, setDocumentTypeFilter] = useState<'ALL' | 'rto' | 'hoist'>(() =>
    parseDocumentTypeFilter(searchParams.get('docType')),
  )
  const [documentStatusFilter, setDocumentStatusFilter] = useState<'ALL' | 'overdue' | 'soon' | 'ok' | 'missing'>(() =>
    parseDocumentStatusFilter(searchParams.get('docStatus')),
  )
  const [clientFilter, setClientFilter] = useState(() => (searchParams.get('client') ?? '').trim())
  const [unitTypeFilter, setUnitTypeFilter] = useState<'ALL' | (typeof fleetUnitTypes)[number]>(() =>
    parseUnitTypeFilter(searchParams.get('unitType')),
  )
  const [unitPendingDelete, setUnitPendingDelete] = useState<FleetUnit | null>(null)
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isQrScanning, setIsQrScanning] = useState(false)
  const [qrInput, setQrInput] = useState('')
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrIntervalRef = useRef<number | null>(null)
  const qrCameraCheckRef = useRef<number | null>(null)

  const qrDetectorCtor = useMemo(
    () => (window as WindowWithBarcodeDetector).BarcodeDetector,
    [],
  )

  const hasQrSupport = useMemo(
    () => Boolean(qrDetectorCtor && navigator.mediaDevices?.getUserMedia),
    [qrDetectorCtor],
  )

  const summary = useMemo(
    () => ({
      totalUnits: normalizedUnits.length,
      operationalUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OPERATIONAL').length,
      maintenanceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'MAINTENANCE').length,
      outOfServiceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OUT_OF_SERVICE').length,
    }),
    [normalizedUnits],
  )

  const filteredUnits = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase()
    const normalizedClientFilter = clientFilter.trim().toLowerCase()
    const isUnassignedClientFilter = clientFilter.trim() === UNASSIGNED_CLIENT_FILTER
    const clientGroupFilter = (searchParams.get('clientGroup') ?? '').trim().toUpperCase()
    const excludedClientsForOthers = searchParams
      .getAll('excludeClient')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
    return normalizedUnits.filter((unit) => {
      if (statusFilter !== 'ALL' && unit.operationalStatus !== statusFilter) {
        return false
      }
      if (unitTypeFilter !== 'ALL' && unit.unitType !== unitTypeFilter) {
        return false
      }
      if (clientGroupFilter === 'OTHERS') {
        const unitClient = (unit.clientName ?? '').trim().toLowerCase()
        if (!unitClient) {
          return false
        }
        if (excludedClientsForOthers.includes(unitClient)) {
          return false
        }
      }
      if (isUnassignedClientFilter) {
        const unitClient = (unit.clientName ?? '').trim()
        if (unitClient.length > 0) {
          return false
        }
      } else if (normalizedClientFilter) {
        const unitClient = (unit.clientName ?? '').trim().toLowerCase()
        if (!unitClient.includes(normalizedClientFilter)) {
          return false
        }
      }
      if (documentTypeFilter !== 'ALL' && documentStatusFilter !== 'ALL') {
        if (documentTypeFilter === 'hoist' && unit.documents?.hoistNotApplicable) {
          return false
        }
        const docExpiresAt = unit.documents?.[documentTypeFilter]?.expiresAt
        if (getDocumentStatus(docExpiresAt) !== documentStatusFilter) {
          return false
        }
      }
      if (!normalizedSearch) {
        return true
      }
      const haystack = [
        unit.internalCode,
        unit.ownerCompany,
        unit.chassisNumber,
        unit.engineNumber,
        unit.brand ?? '',
        unit.model ?? '',
      ]
        .join(' ')
        .toLowerCase()
      return haystack.includes(normalizedSearch)
    })
  }, [normalizedUnits, searchTerm, statusFilter, clientFilter, unitTypeFilter, documentTypeFilter, documentStatusFilter, searchParams])

  const stopQrCamera = () => {
    if (qrIntervalRef.current !== null) {
      window.clearInterval(qrIntervalRef.current)
      qrIntervalRef.current = null
    }
    if (qrCameraCheckRef.current !== null) {
      window.clearTimeout(qrCameraCheckRef.current)
      qrCameraCheckRef.current = null
    }

    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((track) => track.stop())
      qrStreamRef.current = null
    }

    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = null
    }

    setIsQrScanning(false)
  }

  useEffect(() => stopQrCamera, [])

  const resolveUnitFromQrValue = (value: string): FleetUnit | undefined => {
    const trimmed = value.trim()
    if (!trimmed) {
      return undefined
    }

    try {
      const parsedUrl = new URL(trimmed)
      const pathParts = parsedUrl.pathname.split('/').filter(Boolean)
      const fleetIndex = pathParts.indexOf('fleet')
      if (fleetIndex >= 0 && pathParts[fleetIndex + 1]) {
        const idFromUrl = pathParts[fleetIndex + 1]
        return normalizedUnits.find((unit) => unit.id === idFromUrl)
      }
    } catch {
      // Not a URL, continue.
    }

    if (trimmed.startsWith('qr-')) {
      return normalizedUnits.find((unit) => unit.qrId === trimmed)
    }

    const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    if (uuidMatch) {
      const candidate = uuidMatch[0]
      return normalizedUnits.find((unit) => unit.id === candidate)
    }

    return undefined
  }

  const handleQrValue = (value: string) => {
    const matched = resolveUnitFromQrValue(value)
    if (!matched) {
      setQrError('QR no reconocido para una unidad registrada.')
      return
    }
    setIsQrOpen(false)
    setQrInput('')
    setQrError('')
    navigate(buildFleetDetailPath(matched.id))
  }

  const startQrCamera = async () => {
    if (!hasQrSupport || !qrDetectorCtor) {
      return
    }

    setQrError('')
    let mediaStream: MediaStream | null = null
    const videoConstraints: MediaStreamConstraints[] = [
      { video: { facingMode: { exact: 'environment' } }, audio: false },
      { video: { facingMode: 'environment' }, audio: false },
      { video: true, audio: false },
    ]

    for (const constraints of videoConstraints) {
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (error) {
        void error
      }
    }

    if (!mediaStream) {
      setQrError('No se pudo acceder a la cámara. Revisá los permisos del navegador.')
      return
    }

    qrStreamRef.current = mediaStream

    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = mediaStream
      qrVideoRef.current.muted = true
      qrVideoRef.current.autoplay = true
      qrVideoRef.current.playsInline = true
      await new Promise<void>((resolve) => {
        if (!qrVideoRef.current) {
          resolve()
          return
        }
        qrVideoRef.current.onloadedmetadata = () => resolve()
      })
      try {
        await qrVideoRef.current.play()
      } catch {
        setQrError('No se pudo iniciar la cámara. Revisá los permisos del navegador.')
        stopQrCamera()
        return
      }
    }

    qrCameraCheckRef.current = window.setTimeout(() => {
      if (qrVideoRef.current && (qrVideoRef.current.videoWidth === 0 || qrVideoRef.current.videoHeight === 0)) {
        setQrError('La cámara no entregó imagen. Probá cerrar y abrir nuevamente.')
        stopQrCamera()
      }
    }, 1200)

    const detector = new qrDetectorCtor({ formats: qrFormats })

    qrIntervalRef.current = window.setInterval(async () => {
      if (!qrVideoRef.current) {
        return
      }
      try {
        const detections = await detector.detect(qrVideoRef.current)
        const rawValue = detections[0]?.rawValue?.trim()
        if (rawValue) {
          stopQrCamera()
          handleQrValue(rawValue)
        }
      } catch {
        // ignore detection noise
      }
    }, 500)

    setIsQrScanning(true)
  }

  const handleConfirmDelete = async () => {
    if (!canDelete) {
      return
    }

    if (!unitPendingDelete) {
      return
    }

    const targetUnit = unitPendingDelete

    const purgeConflictingFleetQueueItems = async (unitId: string) => {
      const queueItems = await getQueueItems().catch(() => [])
      const conflicts = queueItems.filter((item) => {
        if (!(item.type === 'fleet.create' || item.type === 'fleet.update' || item.type === 'fleet.delete')) {
          return false
        }

        if (
          item.id === `fleet.create.${unitId}` ||
          item.id === `fleet.update.${unitId}` ||
          item.id === `fleet.delete.${unitId}`
        ) {
          return true
        }

        const payload = item.payload as { id?: string } | undefined
        return typeof payload?.id === 'string' && payload.id === unitId
      })

      await Promise.all(conflicts.map((item) => removeQueueItem(item.id)))
    }

    try {
      await purgeConflictingFleetQueueItems(targetUnit.id)

      if (typeof navigator !== 'undefined' && navigator.onLine) {
        await apiRequest(`/fleet/${targetUnit.id}`, { method: 'DELETE' })
      } else {
        await enqueueAndSync({
          id: `fleet.delete.${targetUnit.id}`,
          type: 'fleet.delete',
          payload: { id: targetUnit.id },
          createdAt: new Date().toISOString(),
        })
      }

      const nextUnitList = normalizedUnits.filter((unit) => unit.id !== targetUnit.id)
      setFleetUnits(nextUnitList)
      setUnitPendingDelete(null)
    } catch (error) {
      setUnitPendingDelete(null)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setAppError(`No se pudo encolar la eliminacion de ${targetUnit.internalCode}.`)
        return
      }
      setAppError(getApiErrorMessage(error, `No se pudo eliminar la unidad ${targetUnit.internalCode} en servidor.`))
    }
  }

  const handleQuickSeed = () => {
    const formData = createEmptyFleetFormData()
    const stamp = Date.now().toString().slice(-4)
    formData.internalCode = `TEST-${stamp}`
    formData.brand = 'Mercedes-Benz'
    formData.model = 'Atego 1729'
    formData.year = 2021
    formData.clientName = 'Cliente Demo'
    formData.location = 'Neuquen'
    formData.ownerCompany = 'Enertrans'
    formData.unitType = 'TRACTOR_WITH_HYDROCRANE'
    formData.configurationNotes = 'Unidad de prueba para flujo completo.'
    formData.chassisNumber = `CHS-${stamp}`
    formData.engineNumber = `MTR-${stamp}`
    formData.tareWeightKg = 5000
    formData.maxLoadKg = 12000
    formData.hasHydroCrane = true
    formData.hydroCraneBrand = 'Palfinger'
    formData.hydroCraneModel = 'PK 10000'
    formData.hydroCraneSerialNumber = `HG-${stamp}`

    const unit = toFleetUnit(formData)
    setFleetUnits([unit, ...normalizedUnits])

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest('/fleet', { method: 'POST', body: unit }).catch(() => null)
    }
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
          <h2 className="text-2xl font-bold text-slate-900">Flota</h2>
          <p className="text-sm text-slate-600">Gestión central de unidades operativas.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setIsQrOpen(true)}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Escanear QR
          </button>
          {isDev && featureFlags.showDemoUnitButton ? (
            <button
              type="button"
              onClick={handleQuickSeed}
              className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
            >
              Cargar unidad demo
            </button>
          ) : null}
          {can('FLEET', 'create') ? (
            <Link
              to={ROUTE_PATHS.fleet.create}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
            >
              Crear unidad
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-3 md:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{summary.totalUnits}</p>
        </article>
        <article className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
            {getOperationalStatusLabel('OPERATIONAL')}
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-800">{summary.operationalUnits}</p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            {getOperationalStatusLabel('MAINTENANCE')}
          </p>
          <p className="mt-2 text-2xl font-bold text-amber-800">{summary.maintenanceUnits}</p>
        </article>
        <article className="rounded-xl border border-rose-200 bg-rose-50 p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
            {getOperationalStatusLabel('OUT_OF_SERVICE')}
          </p>
          <p className="mt-2 text-2xl font-bold text-rose-800">{summary.outOfServiceUnits}</p>
        </article>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Buscar
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Dominio, cliente, marca, modelo..."
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Estado
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              <option value="OPERATIONAL">{getOperationalStatusLabel('OPERATIONAL')}</option>
              <option value="MAINTENANCE">{getOperationalStatusLabel('MAINTENANCE')}</option>
              <option value="OUT_OF_SERVICE">{getOperationalStatusLabel('OUT_OF_SERVICE')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Tipo
            <select
              value={unitTypeFilter}
              onChange={(event) => setUnitTypeFilter(event.target.value as typeof unitTypeFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              {fleetUnitTypes.map((unitType) => (
                <option key={unitType} value={unitType}>
                  {fleetUnitTypeLabelMap[unitType]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Documento
            <select
              value={documentTypeFilter}
              onChange={(event) => setDocumentTypeFilter(event.target.value as typeof documentTypeFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              <option value="rto">RTO</option>
              <option value="hoist">Izaje</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Estado doc.
            <select
              value={documentStatusFilter}
              onChange={(event) => setDocumentStatusFilter(event.target.value as typeof documentStatusFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              <option value="overdue">Vencido</option>
              <option value="soon">Por vencer</option>
              <option value="ok">Vigente</option>
              <option value="missing">Sin registro</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 md:col-span-2 xl:col-span-5">
            Cliente
            <input
              value={clientFilter === UNASSIGNED_CLIENT_FILTER ? '' : clientFilter}
              onChange={(event) => setClientFilter(event.target.value)}
              placeholder={clientFilter === UNASSIGNED_CLIENT_FILTER ? 'Filtro activo: sin asignar' : 'Filtrar por cliente'}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Resultados: {filteredUnits.length} de {normalizedUnits.length}
        </p>
        {(searchParams.get('clientGroup') ?? '').trim().toUpperCase() === 'OTHERS' ? (
          <p className="mt-1 text-xs font-semibold text-slate-600">
            Filtro activo desde dashboard: clientes en "Otros".
          </p>
        ) : null}
      </section>

      {normalizedUnits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No hay unidades registradas. Creá tu primera unidad para iniciar la operación.</div>
      ) : (
        <>
          {filteredUnits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
              No hay unidades que coincidan con los filtros.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {filteredUnits.map((unit) => (
                <FleetUnitCard
                  key={unit.id}
                  unit={unit}
                  onRequestDelete={setUnitPendingDelete}
                  canEdit={canEdit}
                  canDelete={canDelete}
                />
              ))}
            </div>
          )}
        </>
      )}

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(unitPendingDelete)}
          title="Eliminar unidad"
          message={`¿Deseás eliminar la unidad ${unitPendingDelete?.internalCode ?? ""}? Esta acción no se puede deshacer.`}
          onCancel={() => setUnitPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}

      {isQrOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Escanear QR de unidad</h3>
                <p className="text-sm text-slate-600">Apuntá la cámara o pegá el link/ID del QR.</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  stopQrCamera()
                  setIsQrOpen(false)
                }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                QR / Link
                <input
                  value={qrInput}
                  onChange={(event) => setQrInput(event.target.value)}
                  placeholder="Pegá el QR o escaneá con la cámara"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleQrValue(qrInput)}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
                >
                  Buscar unidad
                </button>
                {hasQrSupport ? (
                  isQrScanning ? (
                    <button
                      type="button"
                      onClick={stopQrCamera}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Detener cámara
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        void startQrCamera()
                      }}
                      className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Escanear con cámara
                    </button>
                  )
                ) : (
                  <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    Cámara no disponible en este navegador.
                  </span>
                )}
              </div>

              {qrError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {qrError}
                </p>
              ) : null}

              {isQrScanning ? (
                <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
                  <video ref={qrVideoRef} className="h-64 w-full object-cover" muted playsInline autoPlay />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}

