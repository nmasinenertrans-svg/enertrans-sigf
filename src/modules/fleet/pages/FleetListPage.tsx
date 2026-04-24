import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import jsQR from 'jsqr'
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
  const [searchParams, setSearchParams] = useSearchParams()
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
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get('q') ?? '')
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
  const [locationFilter, setLocationFilter] = useState(() => searchParams.get('location') ?? 'ALL')
  const [cylindersFilter, setCylindersFilter] = useState<'ALL' | '4' | '6'>('ALL')
  const [unitPendingDelete, setUnitPendingDelete] = useState<FleetUnit | null>(null)
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkSpecsOpen, setBulkSpecsOpen] = useState(false)
  const [bulkSpecsSearch, setBulkSpecsSearch] = useState('')
  const [bulkSpecsSource, setBulkSpecsSource] = useState<FleetUnit | null>(null)
  const [isBulkApplying, setIsBulkApplying] = useState(false)
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isQrScanning, setIsQrScanning] = useState(false)
  const [qrInput, setQrInput] = useState('')
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrIntervalRef = useRef<number | null>(null)
  const qrCameraCheckRef = useRef<number | null>(null)

  const hasQrSupport = Boolean(navigator.mediaDevices?.getUserMedia)

  const summary = useMemo(
    () => ({
      totalUnits: normalizedUnits.length,
      operationalUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OPERATIONAL').length,
      maintenanceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'MAINTENANCE').length,
      outOfServiceUnits: normalizedUnits.filter((unit) => unit.operationalStatus === 'OUT_OF_SERVICE').length,
    }),
    [normalizedUnits],
  )

  useEffect(() => {
    const next = new URLSearchParams(searchParams)
    // filtros simples
    if (statusFilter !== 'ALL') next.set('status', statusFilter)
    else next.delete('status')
    if (unitTypeFilter !== 'ALL') next.set('unitType', unitTypeFilter)
    else next.delete('unitType')
    if (documentTypeFilter !== 'ALL') next.set('docType', documentTypeFilter)
    else next.delete('docType')
    if (documentStatusFilter !== 'ALL') next.set('docStatus', documentStatusFilter)
    else next.delete('docStatus')
    if (locationFilter !== 'ALL') next.set('location', locationFilter)
    else next.delete('location')
    // cliente (puede ser texto libre o el centinela sin-asignar)
    if (clientFilter) next.set('client', clientFilter)
    else next.delete('client')
    // búsqueda de texto
    if (searchTerm) next.set('q', searchTerm)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, unitTypeFilter, documentTypeFilter, documentStatusFilter, locationFilter, clientFilter, searchTerm])

  const locationOptions = useMemo(
    () =>
      Array.from(new Set(normalizedUnits.map((u) => (u.location ?? '').trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
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
      if (locationFilter !== 'ALL' && (unit.location ?? '').trim() !== locationFilter) {
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
      if (cylindersFilter !== 'ALL' && (unit.engineCylinders ?? 0) !== Number(cylindersFilter)) {
        return false
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
  }, [normalizedUnits, searchTerm, statusFilter, clientFilter, unitTypeFilter, locationFilter, documentTypeFilter, documentStatusFilter, cylindersFilter, searchParams])

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
    if (!hasQrSupport) {
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
      } catch {
        // try next constraint
      }
    }

    if (!mediaStream) {
      setQrError('No se pudo acceder a la cámara. Revisá los permisos del navegador.')
      return
    }

    qrStreamRef.current = mediaStream

    const video = qrVideoRef.current
    if (!video) {
      return
    }

    video.srcObject = mediaStream
    video.muted = true
    video.playsInline = true
    await new Promise<void>((resolve) => {
      video.onloadedmetadata = () => resolve()
    })
    try {
      await video.play()
    } catch {
      setQrError('No se pudo iniciar la cámara. Revisá los permisos del navegador.')
      stopQrCamera()
      return
    }

    qrCameraCheckRef.current = window.setTimeout(() => {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        setQrError('La cámara no entregó imagen. Probá cerrar y abrir nuevamente.')
        stopQrCamera()
      }
    }, 1500)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

    qrIntervalRef.current = window.setInterval(() => {
      if (!ctx || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return
      }
      const { videoWidth: w, videoHeight: h } = video
      if (w === 0 || h === 0) return
      canvas.width = w
      canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      const imageData = ctx.getImageData(0, 0, w, h)
      const result = jsQR(imageData.data, w, h, { inversionAttempts: 'dontInvert' })
      if (result?.data) {
        stopQrCamera()
        handleQrValue(result.data)
      }
    }, 300)

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

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleBulkApplySpecs = async (source: FleetUnit) => {
    setIsBulkApplying(true)
    const update = { lubricants: source.lubricants, filters: source.filters }
    setFleetUnits(fleetUnits.map((unit) => (selectedIds.has(unit.id) ? { ...unit, ...update } : unit)))
    if (typeof navigator !== 'undefined' && navigator.onLine) {
      await Promise.all(
        [...selectedIds].map((id) => apiRequest(`/fleet/${id}`, { method: 'PATCH', body: update }).catch(() => null)),
      )
    }
    setIsBulkApplying(false)
    setBulkSpecsOpen(false)
    setBulkSpecsSearch('')
    setBulkSpecsSource(null)
    setSelectedIds(new Set())
    setSelectionMode(false)
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
          {canEdit && !selectionMode && (
            <button
              type="button"
              onClick={() => setSelectionMode(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Seleccionar unidades
            </button>
          )}
          {selectionMode && (
            <>
              <button
                type="button"
                onClick={() => setSelectedIds(new Set(filteredUnits.map((u) => u.id)))}
                className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
              >
                Seleccionar todos ({filteredUnits.length})
              </button>
              <button
                type="button"
                onClick={() => { setSelectionMode(false); setSelectedIds(new Set()) }}
                className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
              >
                Cancelar selección
              </button>
            </>
          )}
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
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
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
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Ubicación
            <select
              value={locationFilter}
              onChange={(event) => setLocationFilter(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todas</option>
              {locationOptions.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Cilindros
            <select
              value={cylindersFilter}
              onChange={(event) => setCylindersFilter(event.target.value as typeof cylindersFilter)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            >
              <option value="ALL">Todos</option>
              <option value="4">4 cilindros</option>
              <option value="6">6 cilindros</option>
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 md:col-span-2 xl:col-span-6">
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
                <div key={unit.id} className="relative">
                  {selectionMode && (
                    <button
                      type="button"
                      onClick={() => toggleSelect(unit.id)}
                      className={`absolute left-3 top-3 z-10 flex h-6 w-6 items-center justify-center rounded border-2 shadow-sm ${
                        selectedIds.has(unit.id)
                          ? 'border-amber-500 bg-amber-400 text-slate-900'
                          : 'border-slate-400 bg-white'
                      }`}
                    >
                      {selectedIds.has(unit.id) && <span className="text-xs font-bold leading-none">✓</span>}
                    </button>
                  )}
                  <div
                    onClick={selectionMode ? () => toggleSelect(unit.id) : undefined}
                    className={selectionMode ? 'cursor-pointer select-none' : ''}
                  >
                    <FleetUnitCard
                      unit={unit}
                      onRequestDelete={selectionMode ? () => {} : setUnitPendingDelete}
                      canEdit={!selectionMode && canEdit}
                      canDelete={!selectionMode && canDelete}
                    />
                  </div>
                </div>
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

              <div className={`overflow-hidden rounded-lg border border-slate-200 bg-slate-900 ${isQrScanning ? '' : 'hidden'}`}>
                <video ref={qrVideoRef} className="h-64 w-full object-cover" muted playsInline />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {selectionMode && selectedIds.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-2xl">
          <span className="text-sm font-semibold text-slate-700">{selectedIds.size} unidad{selectedIds.size !== 1 ? 'es' : ''} seleccionada{selectedIds.size !== 1 ? 's' : ''}</span>
          <button
            type="button"
            onClick={() => setBulkSpecsOpen(true)}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
          >
            Aplicar especificaciones
          </button>
          <button
            type="button"
            onClick={() => { setSelectedIds(new Set()); setSelectionMode(false) }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </button>
        </div>
      )}

      {bulkSpecsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Copiar especificaciones de...</h3>
                <p className="text-xs text-slate-500 mt-0.5">Seleccioná la unidad fuente. Sus lubricantes y filtros se copiarán a las {selectedIds.size} unidades seleccionadas.</p>
              </div>
              <button
                type="button"
                onClick={() => { setBulkSpecsOpen(false); setBulkSpecsSearch(''); setBulkSpecsSource(null) }}
                className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                ✕
              </button>
            </div>
            <div className="p-4">
              <input
                value={bulkSpecsSearch}
                onChange={(e) => setBulkSpecsSearch(e.target.value)}
                placeholder="Buscar por dominio, marca, modelo..."
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              />
              <div className="mt-3 max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-lg border border-slate-200">
                {normalizedUnits
                  .filter((u) => {
                    const s = bulkSpecsSearch.trim().toLowerCase()
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
                      onClick={() => setBulkSpecsSource(unit)}
                      className={`w-full px-4 py-3 text-left text-sm transition-colors hover:bg-slate-50 ${bulkSpecsSource?.id === unit.id ? 'border-l-4 border-amber-400 bg-amber-50' : ''}`}
                    >
                      <p className="font-semibold text-slate-900">{unit.internalCode}</p>
                      <p className="text-xs text-slate-500">{unit.brand} {unit.model} · {fleetUnitTypeLabelMap[unit.unitType]} · {unit.location || 'Sin ubicación'}</p>
                    </button>
                  ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={() => { setBulkSpecsOpen(false); setBulkSpecsSearch(''); setBulkSpecsSource(null) }}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={!bulkSpecsSource || isBulkApplying}
                onClick={() => { if (bulkSpecsSource) void handleBulkApplySpecs(bulkSpecsSource) }}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isBulkApplying ? 'Aplicando...' : `Aplicar a ${selectedIds.size} unidades`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

