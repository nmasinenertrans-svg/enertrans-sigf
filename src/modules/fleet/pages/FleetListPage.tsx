import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS, buildFleetDetailPath } from '../../../core/routing/routePaths'
import { usePermissions } from '../../../core/auth/usePermissions'
import { FleetUnitCard } from '../components/FleetUnitCard'
import { createEmptyFleetFormData, getOperationalStatusLabel, normalizeFleetUnits, toFleetUnit } from '../services/fleetService'
import type { FleetUnit } from '../../../types/domain'
import { apiRequest } from '../../../services/api/apiClient'

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

export const FleetListPage = () => {
  const [searchParams] = useSearchParams()
  const {
    state: { fleetUnits, featureFlags },
    actions: { setFleetUnits },
  } = useAppContext()
  const {
    state: { currentUser },
  } = useAppContext()
  const { can } = usePermissions()
  const canEdit = can('FLEET', 'edit')
  const canDelete = can('FLEET', 'delete')
  const isDev = currentUser?.role === 'DEV'

  const normalizedUnits = useMemo(() => normalizeFleetUnits(fleetUnits), [fleetUnits])
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPERATIONAL' | 'MAINTENANCE' | 'OUT_OF_SERVICE'>('ALL')
  const [unitPendingDelete, setUnitPendingDelete] = useState<FleetUnit | null>(null)
  const [isQrOpen, setIsQrOpen] = useState(false)
  const [isQrScanning, setIsQrScanning] = useState(false)
  const [qrInput, setQrInput] = useState('')
  const [qrError, setQrError] = useState('')
  const qrVideoRef = useRef<HTMLVideoElement | null>(null)
  const qrStreamRef = useRef<MediaStream | null>(null)
  const qrIntervalRef = useRef<number | null>(null)

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
    return normalizedUnits.filter((unit) => {
      if (statusFilter !== 'ALL' && unit.operationalStatus !== statusFilter) {
        return false
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
  }, [normalizedUnits, searchTerm, statusFilter])

  useEffect(() => {
    const statusParam = searchParams.get('status')
    if (!statusParam) {
      return
    }
    if (
      statusParam === 'ALL' ||
      statusParam === 'OPERATIONAL' ||
      statusParam === 'MAINTENANCE' ||
      statusParam === 'OUT_OF_SERVICE'
    ) {
      setStatusFilter(statusParam)
    }
  }, [searchParams])

  const stopQrCamera = () => {
    if (qrIntervalRef.current !== null) {
      window.clearInterval(qrIntervalRef.current)
      qrIntervalRef.current = null
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
    let mediaStream: MediaStream
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      })
    } catch {
      setQrError('No se pudo acceder a la cámara. Revisa permisos del navegador.')
      return
    }

    qrStreamRef.current = mediaStream

    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = mediaStream
      await qrVideoRef.current.play()
    }

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

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!unitPendingDelete) {
      return
    }

    const nextUnitList = normalizedUnits.filter((unit) => unit.id !== unitPendingDelete.id)
    setFleetUnits(nextUnitList)
    setUnitPendingDelete(null)

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/fleet/${unitPendingDelete.id}`, { method: 'DELETE' }).catch(() => null)
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
        <div className="grid gap-3 md:grid-cols-[1fr_220px]">
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
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Resultados: {filteredUnits.length} de {normalizedUnits.length}
        </p>
      </section>

      {normalizedUnits.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          No hay unidades registradas. Creá tu primera unidad para iniciar la operación.
        </div>
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
          message={`¿Deseás eliminar la unidad ${unitPendingDelete?.internalCode ?? ''}? Esta acción no se puede deshacer.`}
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
                <p className="text-sm text-slate-600">Apunta la cámara o pega el link/ID del QR.</p>
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
                  placeholder="Pega el QR o escanea con la cámara"
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
                  <video ref={qrVideoRef} className="h-64 w-full object-cover" muted playsInline />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
