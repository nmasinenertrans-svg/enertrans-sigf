import { useState, useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiRequest } from '../../../services/api/apiClient'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { usePermissions } from '../../../core/auth/usePermissions'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import type { ServiceOrder, ServiceOrderStatus } from '../../../types/domain'

const STATUS_LABELS: Record<ServiceOrderStatus, string> = {
  OPEN: 'Abierta',
  IN_PROGRESS: 'En proceso',
  WAITING_PARTS: 'Esperando repuestos',
  CLOSED: 'Cerrada',
}

const STATUS_COLORS: Record<ServiceOrderStatus, string> = {
  OPEN: 'bg-red-100 text-red-800',
  IN_PROGRESS: 'bg-amber-100 text-amber-800',
  WAITING_PARTS: 'bg-blue-100 text-blue-800',
  CLOSED: 'bg-green-100 text-green-800',
}

const ORIGIN_LABELS: Record<string, string> = {
  EMAIL: 'Email',
  PHONE_CALL: 'Llamada telefónica',
  WHATSAPP: 'WhatsApp',
  INTERNAL_INSPECTION: 'Inspección interna',
}

const formatDate = (iso?: string | null) => {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

const calcResolutionHours = (os: ServiceOrder): string | null => {
  if (!os.closedAt) return null
  const ms = new Date(os.closedAt).getTime() - new Date(os.createdAt).getTime()
  const hours = ms / 3_600_000
  if (hours < 24) return `${hours.toFixed(1)} h`
  return `${(hours / 24).toFixed(1)} días`
}

const buildClientCopyText = (os: ServiceOrder): string => {
  const lines: string[] = [
    `ORDEN DE SERVICIO ${os.code}`,
    `Fecha: ${new Date(os.createdAt).toLocaleDateString('es-AR')}`,
    '',
  ]
  if (os.unit) lines.push(`Unidad: ${os.unit.internalCode} — ${os.unit.brand} ${os.unit.model}`)
  if (os.externalVehicle) lines.push(`Vehículo: ${os.externalVehicle}`)
  if (os.clientName) lines.push(`Cliente: ${os.clientName}`)
  lines.push(``, `Falla reportada:`, os.reportedFault, ``)
  if (os.status === 'CLOSED') {
    lines.push(`Estado: CERRADA`)
    if (os.resolutionDetail) lines.push(``, `Resolución:`, os.resolutionDetail)
    if (os.closedAt) lines.push(``, `Fecha de cierre: ${new Date(os.closedAt).toLocaleDateString('es-AR')}`)
    const resHours = calcResolutionHours(os)
    if (resHours) lines.push(`Tiempo de resolución: ${resHours}`)
  } else {
    lines.push(`Estado: ${STATUS_LABELS[os.status]}`)
    if (os.assignedToName) lines.push(`Responsable: ${os.assignedToName}`)
  }
  return lines.join('\n')
}

export const ServiceOrderDetailPage = () => {
  const { serviceOrderId } = useParams<{ serviceOrderId: string }>()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const {
    state: { serviceOrders },
    actions: { setServiceOrders },
  } = useAppContext()

  const [os, setOs] = useState<ServiceOrder | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)
  const [isUploadingPhoto, setIsUploadingPhoto] = useState(false)
  const [showCloseModal, setShowCloseModal] = useState(false)
  const [closeResolution, setCloseResolution] = useState('')
  const [editField, setEditField] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const photoInputRef = useRef<HTMLInputElement>(null)

  const canEdit = can('SERVICE_ORDERS', 'edit')

  useEffect(() => {
    if (!serviceOrderId) return
    const local = serviceOrders.find((o) => o.id === serviceOrderId)
    if (local) {
      setOs(local)
      setIsLoading(false)
      return
    }
    setIsLoading(true)
    apiRequest<ServiceOrder>(`/service-orders/${serviceOrderId}`)
      .then((data) => setOs(data))
      .catch(() => setError('No se pudo cargar la orden de servicio.'))
      .finally(() => setIsLoading(false))
  }, [serviceOrderId, serviceOrders])

  const updateOs = async (patch: Record<string, unknown>) => {
    if (!os) return
    setIsSaving(true)
    setError('')
    try {
      const updated = await apiRequest<ServiceOrder>(`/service-orders/${os.id}`, { method: 'PATCH', body: patch })
      setOs(updated)
      setServiceOrders(serviceOrders.map((o) => (o.id === updated.id ? updated : o)))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al guardar.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleStatusChange = (status: ServiceOrderStatus) => {
    if (status === 'CLOSED') {
      setShowCloseModal(true)
      return
    }
    void updateOs({ status })
  }

  const handleClose = async () => {
    if (!closeResolution.trim()) {
      setError('El detalle de resolución es requerido para cerrar la OS.')
      return
    }
    await updateOs({ status: 'CLOSED', resolutionDetail: closeResolution.trim() })
    setShowCloseModal(false)
    setCloseResolution('')
  }

  const handleInlineEdit = async (field: string, value: string) => {
    setEditField(null)
    if (value === (os as unknown as Record<string, string>)[field]) return
    await updateOs({ [field]: value })
  }

  const handlePhotoUpload = async (file: File) => {
    if (!os) return
    setIsUploadingPhoto(true)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = reject
        reader.readAsDataURL(file)
      })
      const result = await apiRequest<{ url: string }>('/files/upload', {
        method: 'POST',
        body: { fileName: `os-${os.id}-${file.name}`, contentType: file.type || 'image/jpeg', dataUrl, folder: 'service-orders' },
      })
      const newUrls = [...(os.photoUrls ?? []), result.url]
      await updateOs({ photoUrls: newUrls })
    } catch {
      setError('No se pudo subir la foto.')
    } finally {
      setIsUploadingPhoto(false)
    }
  }

  const handleDeletePhoto = async (url: string) => {
    if (!os) return
    const newUrls = os.photoUrls.filter((u) => u !== url)
    await updateOs({ photoUrls: newUrls })
  }

  const handleCopyText = async () => {
    if (!os) return
    try {
      await navigator.clipboard.writeText(buildClientCopyText(os))
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2500)
    } catch {
      setError('No se pudo copiar al portapapeles.')
    }
  }

  if (isLoading) {
    return <div className="flex items-center justify-center py-24 text-slate-400">Cargando...</div>
  }

  if (!os) {
    return (
      <div className="py-24 text-center">
        <p className="text-slate-400">{error || 'Orden de servicio no encontrada.'}</p>
        <button type="button" onClick={() => navigate(ROUTE_PATHS.serviceOrders.list)} className="mt-4 text-amber-400 hover:underline text-sm">
          Volver al listado
        </button>
      </div>
    )
  }

  const resolutionTime = calcResolutionHours(os)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={() => navigate(ROUTE_PATHS.serviceOrders.list)} className="mb-2 text-sm text-slate-400 hover:text-white">
            ← Órdenes de Servicio
          </button>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white font-mono">{os.code}</h1>
            <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_COLORS[os.status]}`}>
              {STATUS_LABELS[os.status]}
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-400">
            Creada el {formatDate(os.createdAt)}
            {os.createdBy && ` por ${os.createdBy.name}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopyText}
            className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            {copySuccess ? '✓ Copiado' : 'Copiar texto para cliente'}
          </button>
          {canEdit && os.status !== 'CLOSED' && (
            <button
              type="button"
              onClick={() => setShowCloseModal(true)}
              className="rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-500"
            >
              Cerrar OS
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-700 bg-red-900/30 px-4 py-3 text-sm text-red-400">{error}</div>
      )}

      {resolutionTime && (
        <div className="rounded-xl border border-green-700/40 bg-green-900/20 px-4 py-3 text-sm text-green-300">
          Tiempo de resolución: <strong>{resolutionTime}</strong>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5 space-y-4">
            <h2 className="text-sm font-semibold text-amber-300 uppercase tracking-wider">Información general</h2>

            <InfoRow label="Origen">
              {ORIGIN_LABELS[os.claimOrigin] ?? os.claimOrigin}
            </InfoRow>

            <InfoRow label="Unidad">
              {os.unit
                ? `${os.unit.internalCode} — ${os.unit.brand} ${os.unit.model}`
                : os.externalVehicle ?? '—'}
            </InfoRow>

            <InfoRow label="Cliente">
              {(os.client?.name ?? os.clientName) || '—'}
            </InfoRow>

            <InfoRow label="Asignado a">
              {canEdit && os.status !== 'CLOSED' ? (
                editField === 'assignedToName' ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      className="flex-1 rounded border border-slate-600 bg-slate-700 px-2 py-1 text-sm text-white focus:border-amber-400 focus:outline-none"
                      onBlur={() => void handleInlineEdit('assignedToName', editValue)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void handleInlineEdit('assignedToName', editValue) }}
                    />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => { setEditField('assignedToName'); setEditValue(os.assignedToName ?? '') }}
                    className="text-sm text-slate-300 hover:text-amber-300 text-left"
                  >
                    {os.assignedToName || <span className="text-slate-500 italic">Sin asignar — click para editar</span>}
                  </button>
                )
              ) : (
                os.assignedToName || '—'
              )}
            </InfoRow>

            <InfoRow label="Fecha estimada de resolución">
              {formatDate(os.estimatedResolutionAt)}
            </InfoRow>

            {os.closedAt && <InfoRow label="Fecha de cierre">{formatDate(os.closedAt)}</InfoRow>}
          </div>

          {canEdit && os.status !== 'CLOSED' && (
            <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
              <h2 className="mb-3 text-sm font-semibold text-amber-300 uppercase tracking-wider">Cambiar estado</h2>
              <div className="flex flex-wrap gap-2">
                {(['OPEN', 'IN_PROGRESS', 'WAITING_PARTS'] as ServiceOrderStatus[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={os.status === s || isSaving}
                    onClick={() => handleStatusChange(s)}
                    className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
                      os.status === s
                        ? 'border border-amber-400 bg-amber-400/10 text-amber-300 cursor-default'
                        : 'border border-slate-600 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
            <h2 className="mb-3 text-sm font-semibold text-amber-300 uppercase tracking-wider">Falla reportada</h2>
            {canEdit && os.status !== 'CLOSED' && editField === 'reportedFault' ? (
              <div>
                <textarea
                  autoFocus
                  rows={4}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                  onBlur={() => void handleInlineEdit('reportedFault', editValue)}
                />
              </div>
            ) : (
              <p
                className={`text-sm text-slate-200 whitespace-pre-wrap ${canEdit && os.status !== 'CLOSED' ? 'cursor-pointer hover:text-amber-300' : ''}`}
                onClick={() => canEdit && os.status !== 'CLOSED' && (setEditField('reportedFault'), setEditValue(os.reportedFault))}
              >
                {os.reportedFault}
              </p>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
            <h2 className="mb-3 text-sm font-semibold text-amber-300 uppercase tracking-wider">Repuestos utilizados</h2>
            {canEdit && os.status !== 'CLOSED' && editField === 'sparePartsUsed' ? (
              <textarea
                autoFocus
                rows={3}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full rounded border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
                onBlur={() => void handleInlineEdit('sparePartsUsed', editValue)}
              />
            ) : (
              <p
                className={`text-sm text-slate-300 whitespace-pre-wrap ${canEdit && os.status !== 'CLOSED' ? 'cursor-pointer hover:text-amber-300' : ''}`}
                onClick={() => canEdit && os.status !== 'CLOSED' && (setEditField('sparePartsUsed'), setEditValue(os.sparePartsUsed ?? ''))}
              >
                {os.sparePartsUsed || <span className="text-slate-500 italic">Sin repuestos registrados{canEdit && os.status !== 'CLOSED' ? ' — click para editar' : ''}</span>}
              </p>
            )}
          </div>

          {(os.resolutionDetail || os.status === 'CLOSED') && (
            <div className="rounded-xl border border-green-700/40 bg-green-900/10 p-5">
              <h2 className="mb-3 text-sm font-semibold text-green-400 uppercase tracking-wider">Detalle de resolución</h2>
              <p className="text-sm text-slate-200 whitespace-pre-wrap">{os.resolutionDetail || '—'}</p>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-slate-700 bg-slate-800/60 p-5">
        <h2 className="mb-4 text-sm font-semibold text-amber-300 uppercase tracking-wider">Registro fotográfico</h2>
        <div className="flex flex-wrap gap-3">
          {os.photoUrls.map((url) => (
            <div key={url} className="relative group">
              <a href={url} target="_blank" rel="noopener noreferrer">
                <img src={url} alt="Foto OS" className="h-24 w-24 rounded-lg object-cover border border-slate-600" />
              </a>
              {canEdit && os.status !== 'CLOSED' && (
                <button
                  type="button"
                  onClick={() => void handleDeletePhoto(url)}
                  className="absolute -top-2 -right-2 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full bg-red-600 text-xs text-white"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {canEdit && os.status !== 'CLOSED' && (
            <>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handlePhotoUpload(file)
                  e.target.value = ''
                }}
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                disabled={isUploadingPhoto}
                className="flex h-24 w-24 items-center justify-center rounded-lg border-2 border-dashed border-slate-600 text-slate-400 hover:border-amber-400 hover:text-amber-400 disabled:opacity-50"
              >
                {isUploadingPhoto ? '...' : '+'}
              </button>
            </>
          )}

          {os.photoUrls.length === 0 && !(canEdit && os.status !== 'CLOSED') && (
            <p className="text-sm text-slate-500 italic">Sin fotos registradas.</p>
          )}
        </div>
      </div>

      {showCloseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800 p-6 shadow-xl">
            <h2 className="mb-4 text-lg font-bold text-white">Cerrar Orden de Servicio</h2>
            <p className="mb-3 text-sm text-slate-400">Describí cómo se resolvió el problema. Este texto quedará registrado en la OS.</p>
            <textarea
              autoFocus
              rows={5}
              placeholder="Detalle de la resolución..."
              value={closeResolution}
              onChange={(e) => setCloseResolution(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none"
            />
            {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => { setShowCloseModal(false); setCloseResolution(''); setError('') }}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleClose()}
                disabled={isSaving}
                className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-500 disabled:opacity-50"
              >
                {isSaving ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const InfoRow = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-xs text-slate-500">{label}</span>
    <span className="text-sm text-slate-200">{children}</span>
  </div>
)
