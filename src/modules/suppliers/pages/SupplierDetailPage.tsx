import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { Supplier } from '../../../types/domain'

const normalize = (value: string) => value.trim().toLowerCase()

const isUrlLike = (value: string): boolean => /^https?:\/\//i.test(value.trim())

const normalizeMapQuery = (value: string): string => decodeURIComponent(value).replace(/\+/g, ' ').trim()

const extractMapQueryFromUrl = (rawUrl: string): string | null => {
  try {
    const parsed = new URL(rawUrl)
    const host = parsed.hostname.toLowerCase()
    if (!host.includes('google.')) {
      return null
    }

    const queryFromParams =
      parsed.searchParams.get('q') ||
      parsed.searchParams.get('query') ||
      parsed.searchParams.get('destination')

    if (queryFromParams?.trim()) {
      return normalizeMapQuery(queryFromParams)
    }

    const atMatch = parsed.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
    if (atMatch?.[1] && atMatch[2]) {
      return `${atMatch[1]},${atMatch[2]}`
    }

    const placeMatch = parsed.pathname.match(/\/place\/([^/]+)/)
    if (placeMatch?.[1]) {
      return normalizeMapQuery(placeMatch[1])
    }
  } catch {
    return null
  }

  return null
}

const buildMapEmbedUrl = (mapsUrl: string, address: string): string => {
  const rawLink = mapsUrl.trim()
  const rawAddress = address.trim()

  if (rawLink.includes('/maps/embed') || rawLink.includes('output=embed')) {
    return rawLink
  }

  if (rawLink && isUrlLike(rawLink)) {
    const queryFromUrl = extractMapQueryFromUrl(rawLink)
    if (queryFromUrl) {
      return `https://www.google.com/maps?q=${encodeURIComponent(queryFromUrl)}&output=embed`
    }
  }

  if (rawAddress) {
    return `https://www.google.com/maps?q=${encodeURIComponent(rawAddress)}&output=embed`
  }

  if (rawLink) {
    return `https://www.google.com/maps?q=${encodeURIComponent(rawLink)}&output=embed`
  }

  return ''
}

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)

export const SupplierDetailPage = () => {
  const { supplierId } = useParams()
  const {
    state: { suppliers, repairs, featureFlags },
    actions: { setSuppliers, setAppError },
  } = useAppContext()

  const [isLoading, setIsLoading] = useState(false)
  const mountedRef = useRef(true)

  const supplier = useMemo(() => suppliers.find((item) => item.id === supplierId) ?? null, [suppliers, supplierId])

  const fetchSupplier = useCallback(async () => {
    if (!supplierId || supplier) return
    setIsLoading(true)
    try {
      const response = await apiRequest<Supplier>(`/suppliers/${supplierId}`)
      if (!mountedRef.current) return
      const nextSuppliers = suppliers.some((item) => item.id === response.id)
        ? suppliers.map((item) => (item.id === response.id ? response : item))
        : [response, ...suppliers]
      setSuppliers(nextSuppliers)
    } catch {
      if (mountedRef.current) setAppError('No se pudo cargar la ficha del proveedor.')
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [supplierId, supplier, suppliers, setSuppliers, setAppError])

  useEffect(() => {
    mountedRef.current = true
    void fetchSupplier()
    return () => {
      mountedRef.current = false
    }
  }, [fetchSupplier])

  const repairMetrics = useMemo(() => {
    if (!supplier) {
      return { repairsCount: 0, totalCost: 0 }
    }

    const related = repairs.filter(
      (repair) => repair.supplierId === supplier.id || normalize(repair.supplierName || '') === normalize(supplier.name),
    )

    return {
      repairsCount: related.length,
      totalCost: related.reduce((acc, item) => acc + (item.realCost ?? 0), 0),
    }
  }, [repairs, supplier])

  const mapEmbedUrl = useMemo(
    () => (supplier ? buildMapEmbedUrl(supplier.mapsUrl || '', supplier.address || '') : ''),
    [supplier],
  )

  if (!featureFlags.showSuppliersModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Ficha de proveedor</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  if (!supplierId) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.suppliers} label="Volver a proveedores" />
        <p className="mt-3 text-sm text-slate-600">Proveedor no especificado.</p>
      </section>
    )
  }

  if (!supplier && isLoading) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.suppliers} label="Volver a proveedores" />
        <p className="mt-3 text-sm text-slate-600">Cargando ficha del proveedor...</p>
      </section>
    )
  }

  if (!supplier) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.suppliers} label="Volver a proveedores" />
        <p className="mt-3 text-sm text-slate-600">No se encontro el proveedor solicitado.</p>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.suppliers} label="Volver a proveedores" />
        <h2 className="text-2xl font-bold text-slate-900">Ficha de proveedor</h2>
        <p className="text-sm text-slate-600">Detalle administrativo, comercial y ubicacion.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-bold text-slate-900">{supplier.name}</h3>
          <p className="mt-1 text-sm text-slate-600">{supplier.serviceType || 'Sin rubro especificado'}</p>

          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metodo de pago</p>
              <p className="mt-1 font-semibold text-slate-900">{supplier.paymentMethod || 'Sin definir'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Plazo</p>
              <p className="mt-1 font-semibold text-slate-900">{supplier.paymentTerms || 'Sin definir'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direccion</p>
              <p className="mt-1 font-semibold text-slate-900">{supplier.address || 'Sin direccion cargada'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contacto</p>
              <p className="mt-1 font-semibold text-slate-900">{supplier.contactName || '-'}</p>
              <p className="mt-1 text-slate-700">{supplier.contactPhone || '-'}</p>
              <p className="mt-1 text-slate-700">{supplier.contactEmail || '-'}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metricas</p>
              <p className="mt-1 text-slate-700">Reparaciones: {repairMetrics.repairsCount}</p>
              <p className="mt-1 text-slate-700">Costo acumulado: {formatMoney(repairMetrics.totalCost)}</p>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Observaciones</p>
            <p className="mt-1 text-slate-800">{supplier.notes || 'Sin observaciones'}</p>
          </div>

          {supplier.mapsUrl ? (
            <div className="mt-4">
              <a
                href={supplier.mapsUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
              >
                Abrir en Google Maps
              </a>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-800">Ubicacion</h3>
          {mapEmbedUrl ? (
            <div className="mt-3 aspect-square overflow-hidden rounded-xl border border-slate-200">
              <iframe
                title={`Mapa de ${supplier.name}`}
                src={mapEmbedUrl}
                className="h-full w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
          ) : (
            <div className="mt-3 flex aspect-square items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center text-xs text-slate-500">
              Carga direccion o link de Google Maps para ver el mapa en la ficha.
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
