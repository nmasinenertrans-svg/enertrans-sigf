const ORS_DIRECTIONS_URL = 'https://api.openrouteservice.org/v2/directions/driving-car'

export interface GeoPoint {
  lat: number
  lng: number
}

export interface RouteDistanceResult {
  distanceKm: number
  source: 'ROUTE' | 'STRAIGHT_LINE'
}

const haversineKm = (a: GeoPoint, b: GeoPoint): number => {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const sinLat = Math.sin(dLat / 2)
  const sinLng = Math.sin(dLng / 2)
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const round2 = (value: number): number => Math.round(value * 100) / 100

/**
 * Distancia real por ruta via OpenRouteService (requiere ORS_API_KEY, nivel
 * gratuito sin tarjeta). Si no esta configurada la clave, o el servicio falla,
 * se cae a distancia en linea recta (haversine) y se marca el origen del dato
 * para que el frontend avise que es una aproximacion.
 */
export const calculateRouteDistanceKm = async (origin: GeoPoint, destination: GeoPoint): Promise<RouteDistanceResult> => {
  const apiKey = process.env.ORS_API_KEY

  if (apiKey) {
    try {
      const response = await fetch(ORS_DIRECTIONS_URL, {
        method: 'POST',
        headers: {
          Authorization: apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          coordinates: [
            [origin.lng, origin.lat],
            [destination.lng, destination.lat],
          ],
        }),
      })

      if (response.ok) {
        const data = (await response.json()) as { routes?: Array<{ summary?: { distance?: number } }> }
        const meters = data.routes?.[0]?.summary?.distance
        if (typeof meters === 'number' && Number.isFinite(meters)) {
          return { distanceKm: round2(meters / 1000), source: 'ROUTE' }
        }
      } else {
        console.warn('ORS routing error:', response.status, await response.text())
      }
    } catch (error) {
      console.warn('ORS routing exception:', error)
    }
  }

  return { distanceKm: round2(haversineKm(origin, destination)), source: 'STRAIGHT_LINE' }
}
