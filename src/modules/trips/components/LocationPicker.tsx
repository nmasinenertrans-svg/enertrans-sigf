import { useEffect, useState } from 'react'
import L from 'leaflet'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
import 'leaflet/dist/leaflet.css'
import { decodePlusCode, parsePlusCodeSearch, type PlusCodeMatch } from '../services/plusCode'

// Vite sirve los assets de Leaflet con hash en el nombre, lo que rompe la
// resolucion de iconos por default del paquete. Se pisan explicitamente con
// las URLs ya procesadas por el bundler. (Mismo fix que FleetGpsPanel.)
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

interface NominatimResult {
  display_name: string
  lat: string
  lon: string
}

interface LocationPickerProps {
  label: string
  lat: number | null
  lng: number | null
  addressLabel: string
  onChange: (value: { label: string; lat: number; lng: number }) => void
  errorMessage?: string
}

const DEFAULT_CENTER: [number, number] = [-34.6497, -58.6198] // Base Enertrans, Haedo

const RecenterOnChange = ({ lat, lng }: { lat: number | null; lng: number | null }) => {
  const map = useMap()
  useEffect(() => {
    if (lat !== null && lng !== null) {
      map.setView([lat, lng], Math.max(map.getZoom(), 13))
    }
  }, [lat, lng, map])
  return null
}

const ClickHandler = ({ onClick }: { onClick: (lat: number, lng: number) => void }) => {
  useMapEvents({
    click: (event) => onClick(event.latlng.lat, event.latlng.lng),
  })
  return null
}

export const LocationPicker = ({ label, lat, lng, addressLabel, onChange, errorMessage }: LocationPickerProps) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [plusCodeHint, setPlusCodeHint] = useState<string | null>(null)

  const handleSearch = async () => {
    const query = searchTerm.trim()
    if (!query) {
      return
    }
    setIsSearching(true)
    setPlusCodeHint(null)
    try {
      const plusCode = parsePlusCodeSearch(query)
      if (plusCode) {
        await handlePlusCodeSearch(plusCode)
        return
      }

      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=ar&q=${encodeURIComponent(query)}`,
      )
      const data = (await response.json()) as NominatimResult[]
      setSearchResults(Array.isArray(data) ? data : [])
    } catch {
      setSearchResults([])
    } finally {
      setIsSearching(false)
    }
  }

  const handlePlusCodeSearch = async (plusCode: PlusCodeMatch) => {
    if (plusCode.isShortCode && !plusCode.referenceQuery) {
      setSearchResults([])
      setPlusCodeHint('Es un Plus Code corto: agregá una localidad de referencia, ej. "7VGW+5H Puerto Madryn".')
      return
    }

    let referenceLat = 0
    let referenceLng = 0

    if (plusCode.isShortCode) {
      const referenceResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ar&q=${encodeURIComponent(plusCode.referenceQuery)}`,
      )
      const referenceData = (await referenceResponse.json()) as NominatimResult[]
      if (!referenceData[0]) {
        setSearchResults([])
        setPlusCodeHint(`No encontré "${plusCode.referenceQuery}" para usar como referencia del Plus Code.`)
        return
      }
      referenceLat = Number(referenceData[0].lat)
      referenceLng = Number(referenceData[0].lon)
    }

    const decoded = decodePlusCode(plusCode.code, referenceLat, referenceLng)
    let label = `Plus Code ${plusCode.code}${plusCode.referenceQuery ? ` (${plusCode.referenceQuery})` : ''}`

    try {
      const reverseResponse = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${decoded.lat}&lon=${decoded.lng}`,
      )
      const reverseData = (await reverseResponse.json()) as { display_name?: string }
      if (reverseData?.display_name) {
        label = reverseData.display_name
      }
    } catch {
      // se queda con el label del Plus Code armado arriba
    }

    setSearchResults([{ display_name: label, lat: String(decoded.lat), lon: String(decoded.lng) }])
  }

  const selectResult = (result: NominatimResult) => {
    onChange({ label: result.display_name, lat: Number(result.lat), lng: Number(result.lon) })
    setSearchResults([])
    setSearchTerm('')
  }

  const handleMapClick = (clickLat: number, clickLng: number) => {
    onChange({ label: `${clickLat.toFixed(5)}, ${clickLng.toFixed(5)}`, lat: clickLat, lng: clickLng })
  }

  const center: [number, number] = lat !== null && lng !== null ? [lat, lng] : DEFAULT_CENTER

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <p className="text-sm font-semibold text-slate-700">{label}</p>

      <div className="mt-2 flex gap-2">
        <input
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSearch()
            }
          }}
          placeholder="Buscar dirección o Plus Code (ej: 7VGW+5H Puerto Madryn)..."
          className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={isSearching}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          {isSearching ? 'Buscando...' : 'Buscar'}
        </button>
      </div>

      {plusCodeHint ? <p className="mt-1 text-xs font-semibold text-amber-700">{plusCodeHint}</p> : null}

      {searchResults.length > 0 ? (
        <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
          {searchResults.map((result) => (
            <button
              key={`${result.lat}-${result.lon}`}
              type="button"
              onClick={() => selectResult(result)}
              className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
            >
              {result.display_name}
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-2 h-56 overflow-hidden rounded-lg border border-slate-300">
        <MapContainer center={center} zoom={lat !== null ? 14 : 11} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution="&copy; OpenStreetMap contributors"
          />
          <ClickHandler onClick={handleMapClick} />
          <RecenterOnChange lat={lat} lng={lng} />
          {lat !== null && lng !== null ? <Marker position={[lat, lng]} /> : null}
        </MapContainer>
      </div>
      <p className="mt-1 text-xs text-slate-500">Tocá el mapa para ajustar el punto exacto.</p>
      {addressLabel ? <p className="mt-1 text-xs font-semibold text-slate-700">{addressLabel}</p> : null}
      {errorMessage ? <p className="mt-1 text-xs text-rose-600">{errorMessage}</p> : null}
    </div>
  )
}
