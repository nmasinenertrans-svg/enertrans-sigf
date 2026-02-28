import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

const donutSize = 190
const donutRadius = 70
const donutStroke = 18

const statusColors = {
  overdue: '#ef4444',
  soon: '#facc15',
  ok: '#22c55e',
  missing: '#94a3b8',
} as const

const formatCount = (value: number) => value.toString()

type Segment = { label: string; value: number; color: string }

const toSegments = (items: Segment[]) => items.filter((item) => item.value > 0)

const buildDonutPaths = (segments: Segment[]) => {
  const total = segments.reduce((acc, item) => acc + item.value, 0)
  if (total === 0) {
    return []
  }

  const circumference = 2 * Math.PI * donutRadius
  let offset = 0

  return segments.map((segment) => {
    const percent = segment.value / total
    const length = percent * circumference
    const dashArray = `${length} ${circumference - length}`
    const dashOffset = -offset
    offset += length

    return {
      ...segment,
      dashArray,
      dashOffset,
    }
  })
}

const DonutChart = ({
  title,
  segments,
  onSegmentClick,
}: {
  title: string
  segments: Segment[]
  onSegmentClick?: (segment: Segment) => void
}) => {
  const visibleSegments = toSegments(segments)
  const paths = buildDonutPaths(visibleSegments)
  const total = segments.reduce((acc, item) => acc + item.value, 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
      <div className="mt-4 flex flex-col items-center gap-4">
        <svg width={donutSize} height={donutSize} viewBox="0 0 200 200">
          <g transform="translate(100,100)">
            <circle r={donutRadius} fill="transparent" stroke="#e2e8f0" strokeWidth={donutStroke} />
            {paths.map((segment, index) => (
              <circle
                key={`${segment.label}-${index}`}
                r={donutRadius}
                fill="transparent"
                stroke={segment.color}
                strokeWidth={donutStroke}
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                strokeLinecap="butt"
                transform="rotate(-90)"
              />
            ))}
          </g>
        </svg>

        <div className="w-full overflow-hidden rounded-lg border border-slate-200">
          <div className="grid grid-cols-3 bg-slate-50 text-xs font-semibold uppercase text-slate-500">
            <div className="border-r border-slate-200 px-3 py-2">Estado</div>
            <div className="border-r border-slate-200 px-3 py-2 text-right">Cantidad</div>
            <div className="px-3 py-2 text-right">%</div>
          </div>
          {segments.map((item) => {
            const percent = total > 0 ? Math.round((item.value / total) * 100) : 0
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onSegmentClick?.(item)}
                disabled={!onSegmentClick}
                className="grid w-full grid-cols-3 border-t border-slate-200 text-left text-sm enabled:hover:bg-slate-50 disabled:cursor-default"
              >
                <div className="flex items-center gap-2 px-3 py-2 text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </div>
                <div className="px-3 py-2 text-right font-semibold text-slate-900">{formatCount(item.value)}</div>
                <div className="px-3 py-2 text-right font-semibold text-slate-900">{percent}%</div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const OccupancyChart = ({
  segments,
  onSegmentClick,
}: {
  segments: Segment[]
  onSegmentClick?: (segment: Segment) => void
}) => {
  const visibleSegments = toSegments(segments)
  const paths = buildDonutPaths(visibleSegments)
  const total = segments.reduce((acc, item) => acc + item.value, 0)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-800">Ocupacion de flota por cliente</h3>
        <span className="text-xs text-slate-500">Distribucion por unidades asignadas</span>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="flex items-center justify-center">
          <svg width={200} height={200} viewBox="0 0 200 200">
            <g transform="translate(100,100)">
              <circle r={donutRadius} fill="transparent" stroke="#e2e8f0" strokeWidth={donutStroke} />
              {paths.map((segment, index) => (
                <circle
                  key={`${segment.label}-${index}`}
                  r={donutRadius}
                  fill="transparent"
                  stroke={segment.color}
                  strokeWidth={donutStroke}
                  strokeDasharray={segment.dashArray}
                  strokeDashoffset={segment.dashOffset}
                  strokeLinecap="butt"
                  transform="rotate(-90)"
                />
              ))}
            </g>
          </svg>
        </div>

        <div className="grid gap-2">
          {segments.map((item) => {
            const percent = total > 0 ? Math.round((item.value / total) * 100) : 0
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => onSegmentClick?.(item)}
                disabled={!onSegmentClick}
                className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-left enabled:hover:bg-slate-50 disabled:cursor-default"
              >
                <div className="flex items-center gap-2 text-sm text-slate-700">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.color }} />
                  {item.label}
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {formatCount(item.value)} ({percent}%)
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const daysBetween = (target: Date, reference: Date) =>
  Math.ceil((target.getTime() - reference.getTime()) / (1000 * 60 * 60 * 24))

const getDocumentStatus = (expiresAt?: string, thresholdDays = 30) => {
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

const palette = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b']

export const DashboardPage = () => {
  const {
    state: { fleetUnits, workOrders },
  } = useAppContext()
  const navigate = useNavigate()

  const outOfServiceCount = fleetUnits.filter((unit) => unit.operationalStatus === 'OUT_OF_SERVICE').length
  const openWorkOrdersCount = workOrders.filter((order) => order.status !== 'CLOSED').length
  const pendingReauditCount = workOrders.filter((order) => order.pendingReaudit).length

  const rtoSegments = useMemo(() => {
    const counts = { overdue: 0, soon: 0, ok: 0, missing: 0 }
    fleetUnits.forEach((unit) => {
      const status = getDocumentStatus(unit.documents?.rto?.expiresAt)
      counts[status] += 1
    })

    return [
      { label: 'Vencidos', value: counts.overdue, color: statusColors.overdue },
      { label: 'Proximos a vencer', value: counts.soon, color: statusColors.soon },
      { label: 'Vigentes', value: counts.ok, color: statusColors.ok },
      { label: 'Sin registro', value: counts.missing, color: statusColors.missing },
    ]
  }, [fleetUnits])

  const hoistSegments = useMemo(() => {
    const counts = { overdue: 0, soon: 0, ok: 0, missing: 0 }
    fleetUnits.forEach((unit) => {
      if (unit.documents?.hoistNotApplicable) {
        return
      }
      const status = getDocumentStatus(unit.documents?.hoist?.expiresAt)
      counts[status] += 1
    })

    return [
      { label: 'Vencidos', value: counts.overdue, color: statusColors.overdue },
      { label: 'Proximos a vencer', value: counts.soon, color: statusColors.soon },
      { label: 'Vigentes', value: counts.ok, color: statusColors.ok },
      { label: 'Sin registro', value: counts.missing, color: statusColors.missing },
    ]
  }, [fleetUnits])

  const occupancySegments = useMemo(() => {
    const counts = new Map<string, number>()
    fleetUnits.forEach((unit) => {
      const client = unit.clientName?.trim() || 'Sin asignar'
      counts.set(client, (counts.get(client) ?? 0) + 1)
    })

    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    const limited = sorted.slice(0, 6)
    const remaining = sorted.slice(6)
    const othersCount = remaining.reduce((acc, item) => acc + item[1], 0)

    const segments = limited.map(([label, value], index) => ({
      label,
      value,
      color: palette[index % palette.length],
    }))

    if (othersCount > 0) {
      segments.push({ label: 'Otros', value: othersCount, color: palette[segments.length % palette.length] })
    }

    if (segments.length === 0) {
      segments.push({ label: 'Sin asignar', value: 0, color: palette[0] })
    }

    return segments
  }, [fleetUnits])

  const mapLabelToDocStatus = (label: string): 'overdue' | 'soon' | 'ok' | 'missing' | null => {
    const key = label.toLowerCase()
    if (key.includes('vencid')) {
      return 'overdue'
    }
    if (key.includes('proxim')) {
      return 'soon'
    }
    if (key.includes('vigent')) {
      return 'ok'
    }
    if (key.includes('registro')) {
      return 'missing'
    }
    return null
  }

  const handleRtoSegmentClick = (segment: Segment) => {
    const status = mapLabelToDocStatus(segment.label)
    if (!status) {
      return
    }
    navigate(`${ROUTE_PATHS.fleet.list}?docType=rto&docStatus=${status}`)
  }

  const handleHoistSegmentClick = (segment: Segment) => {
    const status = mapLabelToDocStatus(segment.label)
    if (!status) {
      return
    }
    navigate(`${ROUTE_PATHS.fleet.list}?docType=hoist&docStatus=${status}`)
  }

  const handleOccupancySegmentClick = (segment: Segment) => {
    if (!segment.label || segment.label === 'Otros') {
      return
    }
    navigate(`${ROUTE_PATHS.fleet.list}?client=${encodeURIComponent(segment.label)}`)
  }

  return (
    <section className="space-y-6">
      <header className="text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-400">Inicio</p>
        <h2 className="mt-2 text-2xl font-bold text-slate-900">Resumen documental y operacion de flota</h2>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <button
          type="button"
          onClick={() => navigate(ROUTE_PATHS.fleet.list)}
          className="rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total flota</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{fleetUnits.length}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`${ROUTE_PATHS.fleet.list}?status=OUT_OF_SERVICE`)}
          className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Fuera de servicio</p>
          <p className="mt-2 text-2xl font-bold text-rose-800">{outOfServiceCount}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`${ROUTE_PATHS.workOrders}?status=OPEN&includeInProgress=1`)}
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">OT abiertas</p>
          <p className="mt-2 text-2xl font-bold text-amber-800">{openWorkOrdersCount}</p>
        </button>
        <button
          type="button"
          onClick={() => navigate(`${ROUTE_PATHS.audits}?pendingReaudit=1`)}
          className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">Pendiente re-auditoria</p>
          <p className="mt-2 text-2xl font-bold text-sky-800">{pendingReauditCount}</p>
        </button>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DonutChart title="Estado de RTO/VTV" segments={rtoSegments} onSegmentClick={handleRtoSegmentClick} />
        <DonutChart title="Estado de Certificacion" segments={hoistSegments} onSegmentClick={handleHoistSegmentClick} />
      </div>

      <OccupancyChart segments={occupancySegments} onSegmentClick={handleOccupancySegmentClick} />
    </section>
  )
}
