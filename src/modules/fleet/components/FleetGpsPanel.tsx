import { useEffect, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, Polyline, Popup, TileLayer } from 'react-leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import { apiRequest } from '../../../services/api/apiClient'

// Vite sirve los assets de Leaflet con hash en el nombre, lo que rompe la
// resolucion de iconos por default del paquete. Se pisan explicitamente con
// las URLs ya procesadas por el bundler.
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

interface TelemetryPositionDto {
  id: string
  deviceExternalId: string
  provider: string
  capturedAt: string
  latitude: number
  longitude: number
  speedKph: number | null
  odometerKm: number | null
  fuelLevelPct: number | null
  engineOn: boolean | null
}

interface FleetGpsPanelProps {
  unitId: string
}

const formatDateTime = (value: string): string => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

const formatKm = (value: number | null): string => (value === null ? '—' : `${value.toLocaleString('es-AR')} km`)

export const FleetGpsPanel = ({ unitId }: FleetGpsPanelProps) => {
  const [positions, setPositions] = useState<TelemetryPositionDto[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    apiRequest<TelemetryPositionDto[]>(`/integrations/gps/positions?unitId=${unitId}&limit=200`)
      .then((data) => {
        if (cancelled) return
        setPositions(data)
        setStatus('ready')
      })
      .catch(() => {
        if (cancelled) return
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [unitId])

  if (status === 'loading') {
    return <p className="text-sm text-slate-500">Cargando datos GPS...</p>
  }

  if (status === 'error') {
    return <p className="text-sm text-red-600">No se pudieron cargar los datos GPS de esta unidad.</p>
  }

  if (positions.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-sm text-slate-600">
          Todavia no hay datos GPS para esta unidad. Van a aparecer automaticamente cuando el proveedor (RSV,
          Microtrack) empiece a mandar posiciones vinculadas a esta unidad.
        </p>
      </div>
    )
  }

  const latest = positions[0]
  const trail: [number, number][] = [...positions].reverse().map((position) => [position.latitude, position.longitude])

  return (
    <div className="space-y-5">
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Ultima posicion conocida</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Fecha y hora</p>
            <p className="font-semibold text-slate-900">{formatDateTime(latest.capturedAt)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Velocidad</p>
            <p className="font-semibold text-slate-900">{latest.speedKph !== null ? `${latest.speedKph} km/h` : '—'}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Proveedor</p>
            <p className="font-semibold text-slate-900">
              {latest.provider} · {latest.deviceExternalId}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Odometro</p>
            <p className="font-semibold text-slate-900">{formatKm(latest.odometerKm)}</p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Combustible</p>
            <p className="font-semibold text-slate-900">
              {latest.fuelLevelPct !== null ? `${latest.fuelLevelPct}%` : '—'}
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Motor</p>
            <p className="font-semibold text-slate-900">
              {latest.engineOn === null ? '—' : latest.engineOn ? 'Encendido' : 'Apagado'}
            </p>
          </div>
        </div>
      </article>

      <article className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="h-[420px] w-full">
          <MapContainer center={[latest.latitude, latest.longitude]} zoom={13} className="h-full w-full">
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution="&copy; OpenStreetMap contributors"
            />
            {trail.length > 1 ? <Polyline positions={trail} pathOptions={{ color: '#d97706', weight: 3 }} /> : null}
            <Marker position={[latest.latitude, latest.longitude]}>
              <Popup>
                {formatDateTime(latest.capturedAt)}
                <br />
                {latest.speedKph !== null ? `${latest.speedKph} km/h` : 'Sin velocidad'}
              </Popup>
            </Marker>
          </MapContainer>
        </div>
      </article>
    </div>
  )
}
