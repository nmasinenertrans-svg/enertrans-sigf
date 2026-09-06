import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { buildContractView } from '../../contracts/services/contractsService'
import { buildTireView } from '../../tires/services/tiresService'

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

const TruckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M2.5 6.5h11v10h-11z" />
    <path d="M13.5 10h4.2l3.3 3.3v3.2h-7.5z" />
    <circle cx="6.5" cy="18" r="1.7" />
    <circle cx="16.5" cy="18" r="1.7" />
  </svg>
)

const AlertIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 3.5 21.5 20h-19L12 3.5z" />
    <path d="M12 9.5v4.5" />
    <circle cx="12" cy="16.8" r="0.9" fill="currentColor" stroke="none" />
  </svg>
)

const ClipboardIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="5" y="4.5" width="14" height="16" rx="2" />
    <path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
    <path d="M8.5 11h7M8.5 14.5h7M8.5 17.5h4" />
  </svg>
)

const RefreshIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 12a8 8 0 0 1 14-5.2M20 12a8 8 0 0 1-14 5.2" />
    <path d="M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6" />
  </svg>
)

const CalendarIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <rect x="4" y="5.5" width="16" height="15" rx="2" />
    <path d="M4 10h16M8 3v4M16 3v4" />
  </svg>
)

const TireIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v5M12 15.5v5M20.5 12h-5M8.5 12h-5M17.7 6.3l-3.5 3.5M9.8 14.2l-3.5 3.5M17.7 17.7l-3.5-3.5M9.8 9.8 6.3 6.3" />
  </svg>
)

const CheckIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M5 12.5 10 17l9-10" />
  </svg>
)

const StatCard = ({
  label,
  value,
  icon,
  tone,
  onClick,
  disabled,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: 'slate' | 'rose' | 'amber' | 'sky'
  onClick: () => void
  disabled: boolean
}) => {
  const toneStyles: Record<typeof tone, { bg: string; border: string; iconBg: string; iconText: string; valueText: string; labelText: string }> = {
    slate: {
      bg: 'bg-white',
      border: 'border-slate-200',
      iconBg: 'bg-slate-100',
      iconText: 'text-slate-600',
      valueText: 'text-slate-900',
      labelText: 'text-slate-500',
    },
    rose: {
      bg: 'bg-gradient-to-br from-rose-50 to-white',
      border: 'border-rose-200',
      iconBg: 'bg-rose-100',
      iconText: 'text-rose-600',
      valueText: 'text-rose-900',
      labelText: 'text-rose-700',
    },
    amber: {
      bg: 'bg-gradient-to-br from-amber-50 to-white',
      border: 'border-amber-200',
      iconBg: 'bg-amber-100',
      iconText: 'text-amber-700',
      valueText: 'text-amber-900',
      labelText: 'text-amber-700',
    },
    sky: {
      bg: 'bg-gradient-to-br from-sky-50 to-white',
      border: 'border-sky-200',
      iconBg: 'bg-sky-100',
      iconText: 'text-sky-700',
      valueText: 'text-sky-900',
      labelText: 'text-sky-700',
    },
  }
  const styles = toneStyles[tone]

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        'group relative flex items-center gap-4 overflow-hidden rounded-2xl border p-5 text-left shadow-sm transition-all',
        styles.bg,
        styles.border,
        disabled ? 'cursor-default opacity-90' : 'hover:-translate-y-1 hover:shadow-lg',
      ].join(' ')}
    >
      <span className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', styles.iconBg, styles.iconText].join(' ')}>
        <span className="h-6 w-6">{icon}</span>
      </span>
      <div className="min-w-0">
        <p className={['text-xs font-semibold uppercase tracking-wide', styles.labelText].join(' ')}>{label}</p>
        <p className={['mt-1 text-3xl font-extrabold tracking-tight', styles.valueText].join(' ')}>{value}</p>
      </div>
    </button>
  )
}

const DonutChart = ({
  title,
  segments,
  centerLabel,
  onSegmentClick,
}: {
  title: string
  segments: Segment[]
  centerLabel: string
  onSegmentClick?: (segment: Segment) => void
}) => {
  const visibleSegments = toSegments(segments)
  const paths = buildDonutPaths(visibleSegments)
  const total = segments.reduce((acc, item) => acc + item.value, 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <h3 className="text-sm font-bold text-slate-800">{title}</h3>
      <div className="mt-4 flex flex-col items-center gap-4">
        <div className="relative" style={{ width: donutSize, height: donutSize }}>
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
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold tracking-tight text-slate-900">{total}</span>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{centerLabel}</span>
          </div>
        </div>

        <div className="w-full overflow-hidden rounded-xl border border-slate-200">
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
  const [showAllClients, setShowAllClients] = useState(false)
  const hasMoreThanTop = segments.length > 5
  const listedSegments = showAllClients || !hasMoreThanTop ? segments : segments.slice(0, 5)
  const hiddenClientsCount = hasMoreThanTop ? segments.length - 5 : 0
  const visibleSegments = toSegments(listedSegments)
  const paths = buildDonutPaths(visibleSegments)
  const total = segments.reduce((acc, item) => acc + item.value, 0)

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-800">Ocupacion de flota por cliente</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Distribucion por unidades asignadas</span>
          {hasMoreThanTop ? (
            <button
              type="button"
              onClick={() => setShowAllClients((current) => !current)}
              className="rounded-md border border-slate-300 px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              {showAllClients ? 'Ver top 5' : `Ver todos (${segments.length})`}
            </button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-6 lg:grid-cols-[220px_1fr]">
        <div className="flex items-center justify-center">
          <div className="relative" style={{ width: 200, height: 200 }}>
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
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-extrabold tracking-tight text-slate-900">{total}</span>
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">unidades</span>
            </div>
          </div>
        </div>

        <div className="grid gap-2">
          {listedSegments.map((item) => {
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
          {!showAllClients && hiddenClientsCount > 0 ? (
            <p className="px-1 text-xs text-slate-500">
              +{hiddenClientsCount} clientes ocultos. Usa &quot;Ver todos&quot; para ver la lista completa.
            </p>
          ) : null}
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
const UNASSIGNED_CLIENT_FILTER = '__UNASSIGNED__'

const AttentionRow = ({
  icon,
  tone,
  label,
  detail,
  count,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  tone: 'rose' | 'amber' | 'sky' | 'emerald'
  label: string
  detail: string
  count: number
  onClick: () => void
  disabled: boolean
}) => {
  const toneStyles: Record<typeof tone, { iconBg: string; iconText: string; badge: string }> = {
    rose: { iconBg: 'bg-rose-100', iconText: 'text-rose-600', badge: 'bg-rose-600' },
    amber: { iconBg: 'bg-amber-100', iconText: 'text-amber-700', badge: 'bg-amber-500' },
    sky: { iconBg: 'bg-sky-100', iconText: 'text-sky-700', badge: 'bg-sky-600' },
    emerald: { iconBg: 'bg-emerald-100', iconText: 'text-emerald-700', badge: 'bg-emerald-600' },
  }
  const styles = toneStyles[tone]

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-4 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left transition-colors enabled:hover:border-slate-300 enabled:hover:bg-slate-50 disabled:cursor-default"
    >
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', styles.iconBg, styles.iconText].join(' ')}>
        <span className="h-5 w-5">{icon}</span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-800">{label}</p>
        <p className="truncate text-xs text-slate-500">{detail}</p>
      </div>
      <span className={['flex h-8 min-w-[2rem] items-center justify-center rounded-full px-2 text-sm font-extrabold text-white', styles.badge].join(' ')}>
        {count}
      </span>
    </button>
  )
}

const ATTENTION_THRESHOLD_DAYS = 30

export const DashboardPage = () => {
  const {
    state: { fleetUnits, workOrders, contracts, tires, featureFlags },
  } = useAppContext()
  const navigate = useNavigate()
  const dashboardInteractive = featureFlags.interactiveDashboard

  const outOfServiceCount = fleetUnits.filter((unit) => unit.operationalStatus === 'OUT_OF_SERVICE').length
  const openWorkOrdersCount = workOrders.filter((order) => order.status !== 'CLOSED').length
  const pendingReauditCount = workOrders.filter((order) => order.pendingReaudit).length

  const contractsExpiringSoon = useMemo(() => {
    return buildContractView(contracts, fleetUnits)
      .filter((contract) => contract.status === 'ACTIVE' && contract.daysUntilExpiration <= ATTENTION_THRESHOLD_DAYS)
      .sort((a, b) => a.daysUntilExpiration - b.daysUntilExpiration)
  }, [contracts, fleetUnits])

  const tiresNeedingChange = useMemo(
    () => buildTireView(tires, fleetUnits).filter((tire) => tire.isActive && tire.wearLevel === 'CAMBIO'),
    [tires, fleetUnits],
  )

  const attentionItemsCount =
    contractsExpiringSoon.length + tiresNeedingChange.length + pendingReauditCount + outOfServiceCount

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
    const segments = sorted.map(([label, value], index) => ({
      label,
      value,
      color: palette[index % palette.length],
    }))

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
    if (!segment.label) {
      return
    }
    if (segment.label === 'Sin asignar') {
      navigate(`${ROUTE_PATHS.fleet.list}?client=${UNASSIGNED_CLIENT_FILTER}`)
      return
    }
    navigate(`${ROUTE_PATHS.fleet.list}?client=${encodeURIComponent(segment.label)}`)
  }

  const todayLabel = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <section className="space-y-6">
      <header className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 to-slate-700 px-6 py-8 text-center shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-400">Inicio</p>
        <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-white">Resumen documental y operacion de flota</h2>
        <p className="mt-2 text-sm capitalize text-slate-300">{todayLabel}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Total flota"
          value={fleetUnits.length}
          icon={<TruckIcon className="h-full w-full" />}
          tone="slate"
          disabled={!dashboardInteractive}
          onClick={() => navigate(ROUTE_PATHS.fleet.list)}
        />
        <StatCard
          label="Fuera de servicio"
          value={outOfServiceCount}
          icon={<AlertIcon className="h-full w-full" />}
          tone="rose"
          disabled={!dashboardInteractive}
          onClick={() => navigate(`${ROUTE_PATHS.fleet.list}?status=OUT_OF_SERVICE`)}
        />
        <StatCard
          label="OT abiertas"
          value={openWorkOrdersCount}
          icon={<ClipboardIcon className="h-full w-full" />}
          tone="amber"
          disabled={!dashboardInteractive}
          onClick={() => navigate(`${ROUTE_PATHS.workOrders}?status=OPEN&includeInProgress=1`)}
        />
        <StatCard
          label="Pendiente re-inspeccion"
          value={pendingReauditCount}
          icon={<RefreshIcon className="h-full w-full" />}
          tone="sky"
          disabled={!dashboardInteractive}
          onClick={() => navigate(`${ROUTE_PATHS.audits}?pendingReaudit=1`)}
        />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900">Atencion hoy</h3>
            <p className="text-xs text-slate-500">Lo que conviene resolver primero, juntado en un solo lugar.</p>
          </div>
          {attentionItemsCount === 0 ? (
            <span className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-700">
              <CheckIcon className="h-3.5 w-3.5" /> Todo al dia
            </span>
          ) : null}
        </div>

        {attentionItemsCount === 0 ? (
          <p className="mt-4 text-sm text-slate-500">No hay pendientes criticos por ahora.</p>
        ) : (
          <div className="mt-4 grid gap-2.5 md:grid-cols-2">
            {outOfServiceCount > 0 ? (
              <AttentionRow
                icon={<AlertIcon className="h-full w-full" />}
                tone="rose"
                label="Unidades fuera de servicio"
                detail="Requieren revision antes de volver a operar"
                count={outOfServiceCount}
                disabled={!dashboardInteractive}
                onClick={() => navigate(`${ROUTE_PATHS.fleet.list}?status=OUT_OF_SERVICE`)}
              />
            ) : null}
            {pendingReauditCount > 0 ? (
              <AttentionRow
                icon={<RefreshIcon className="h-full w-full" />}
                tone="sky"
                label="Re-inspecciones pendientes"
                detail="Ordenes de trabajo esperando cierre con re-inspeccion"
                count={pendingReauditCount}
                disabled={!dashboardInteractive}
                onClick={() => navigate(`${ROUTE_PATHS.audits}?pendingReaudit=1`)}
              />
            ) : null}
            {contractsExpiringSoon.length > 0 ? (
              <AttentionRow
                icon={<CalendarIcon className="h-full w-full" />}
                tone="amber"
                label="Contratos por vencer"
                detail={`Proximos ${ATTENTION_THRESHOLD_DAYS} dias (o ya vencidos)`}
                count={contractsExpiringSoon.length}
                disabled={!dashboardInteractive}
                onClick={() => navigate(ROUTE_PATHS.contracts)}
              />
            ) : null}
            {tiresNeedingChange.length > 0 ? (
              <AttentionRow
                icon={<TireIcon className="h-full w-full" />}
                tone="amber"
                label="Cubiertas para cambiar"
                detail="Superaron el kilometraje de cambio recomendado"
                count={tiresNeedingChange.length}
                disabled={!dashboardInteractive}
                onClick={() => navigate(ROUTE_PATHS.tires)}
              />
            ) : null}
          </div>
        )}
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DonutChart
          title="Estado de RTO/VTV"
          segments={rtoSegments}
          centerLabel="unidades"
          onSegmentClick={dashboardInteractive ? handleRtoSegmentClick : undefined}
        />
        <DonutChart
          title="Estado de Certificacion"
          segments={hoistSegments}
          centerLabel="unidades"
          onSegmentClick={dashboardInteractive ? handleHoistSegmentClick : undefined}
        />
      </div>

      <OccupancyChart
        segments={occupancySegments}
        onSegmentClick={dashboardInteractive ? handleOccupancySegmentClick : undefined}
      />
    </section>
  )
}
