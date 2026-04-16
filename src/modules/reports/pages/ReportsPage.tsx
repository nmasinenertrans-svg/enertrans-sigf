import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS, buildFleetDetailPath } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import { apiRequest } from '../../../services/api/apiClient'
import { getFleetUnitTypeLabel, getOperationalStatusLabel, normalizeFleetUnits } from '../../fleet/services/fleetService'
import {
  fleetOperationalStatuses,
  fleetUnitTypes,
  type ExternalRequest,
  type FleetOperationalStatus,
  type FleetUnit,
  type RepairRecord,
  type TaskRecord,
  type WorkOrder,
} from '../../../types/domain'

type ProviderMetrics = {
  providerName: string
  repairsCount: number
  totalCost: number
  totalInvoiced: number
  totalMargin: number
  leadHoursTotal: number
  leadCount: number
  avgLeadHours: number | null
  maxLeadHours: number | null
}

type AssigneeCompliance = {
  assignee: string
  total: number
  done: number
  completionRate: number
}

type OccupancyPdfSegment = {
  label: string
  value: number
  share: number
  color: string
}

type OccupancyDimension = 'CLIENT' | 'TYPE' | 'STATUS' | 'OWNER' | 'LOCATION'

type OccupancyPivotRow = {
  label: string
  total: number
  share: number
  breakdownCounts: Record<string, number>
  unitCodes: string[]
  unitsByBreakdown: Record<string, Array<{ id: string; code: string }>>
}

const formatDateTime = (value?: string) => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
}

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(
    Number.isFinite(value) ? value : 0,
  )

const formatHoursToHuman = (hours: number | null) => {
  if (!hours || hours <= 0) {
    return 'Sin datos'
  }
  if (hours >= 24) {
    return `${(hours / 24).toFixed(1)} dias`
  }
  return `${hours.toFixed(1)} hs`
}

const toCsvValue = (value: string | number | null | undefined) => {
  const text = String(value ?? '')
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

const buildCsv = (headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
  const headerLine = headers.map(toCsvValue).join(',')
  const lines = rows.map((row) => row.map(toCsvValue).join(','))
  return [headerLine, ...lines].join('\n')
}

const downloadCsv = (filename: string, csv: string) => {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

const downloadXlsx = (filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) => {
  const worksheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte')
  XLSX.writeFile(workbook, filename)
}

const buildPdf = (title: string, subtitle: string, headers: string[], rows: string[][]) => {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
  const marginX = 40
  let cursorY = 48

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text(title, marginX, cursorY)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  cursorY += 18
  doc.text(subtitle, marginX, cursorY)

  cursorY += 20
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(headers.join(' | '), marginX, cursorY)
  cursorY += 10
  doc.setLineWidth(0.5)
  doc.line(marginX, cursorY, 555, cursorY)
  cursorY += 12

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)

  rows.forEach((row) => {
    const line = row.join(' | ')
    if (cursorY > 770) {
      doc.addPage()
      cursorY = 50
    }
    doc.text(line, marginX, cursorY)
    cursorY += 14
  })

  return doc
}

const isWithinRange = (value: string | undefined, startDate?: string, endDate?: string) => {
  if (!value) {
    return true
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  if (startDate) {
    const start = new Date(startDate)
    if (!Number.isNaN(start.getTime()) && date < start) {
      return false
    }
  }
  if (endDate) {
    const end = new Date(endDate)
    if (!Number.isNaN(end.getTime())) {
      const inclusiveEnd = new Date(end)
      inclusiveEnd.setHours(23, 59, 59, 999)
      if (date > inclusiveEnd) {
        return false
      }
    }
  }
  return true
}

const getRepairLeadHours = (
  repair: RepairRecord,
  workOrderMap: Map<string, WorkOrder>,
  externalRequestMap: Map<string, ExternalRequest>,
) => {
  if (!repair.createdAt) {
    return null
  }
  const repairDate = new Date(repair.createdAt)
  if (Number.isNaN(repairDate.getTime())) {
    return null
  }

  let sourceDateValue = ''
  if (repair.sourceType === 'EXTERNAL_REQUEST') {
    sourceDateValue = externalRequestMap.get(repair.externalRequestId ?? '')?.createdAt ?? ''
  } else {
    sourceDateValue = workOrderMap.get(repair.workOrderId ?? '')?.createdAt ?? ''
  }
  if (!sourceDateValue) {
    return null
  }

  const sourceDate = new Date(sourceDateValue)
  if (Number.isNaN(sourceDate.getTime())) {
    return null
  }
  const hours = (repairDate.getTime() - sourceDate.getTime()) / (1000 * 60 * 60)
  if (!Number.isFinite(hours) || hours < 0) {
    return null
  }
  return hours
}

const percentage = (part: number, total: number) => (total > 0 ? (part / total) * 100 : 0)

const palette = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b']

// ─── Gráfico dona SVG reutilizable ────────────────────────────────────────────
interface DonutSlice {
  label: string
  value: number
  color: string
}

const DonutChart = ({ slices, size = 160 }: { slices: DonutSlice[]; size?: number }) => {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size }}>
        <p className="text-xs text-slate-400">Sin datos</p>
      </div>
    )
  }
  const cx = size / 2
  const cy = size / 2
  const R = size * 0.42
  const r = size * 0.24
  let angle = -Math.PI / 2

  const arcPath = (startAngle: number, sweep: number) => {
    const endAngle = startAngle + sweep
    const x1 = cx + R * Math.cos(startAngle)
    const y1 = cy + R * Math.sin(startAngle)
    const x2 = cx + R * Math.cos(endAngle)
    const y2 = cy + R * Math.sin(endAngle)
    const xi1 = cx + r * Math.cos(endAngle)
    const yi1 = cy + r * Math.sin(endAngle)
    const xi2 = cx + r * Math.cos(startAngle)
    const yi2 = cy + r * Math.sin(startAngle)
    const large = sweep > Math.PI ? 1 : 0
    return `M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2} L ${xi1} ${yi1} A ${r} ${r} 0 ${large} 0 ${xi2} ${yi2} Z`
  }

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {slices.map((slice) => {
        if (slice.value === 0) return null
        const sweep = (slice.value / total) * 2 * Math.PI
        const path = arcPath(angle, sweep)
        angle += sweep
        return <path key={slice.label} d={path} fill={slice.color} stroke="white" strokeWidth="1.5" />
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" fontSize={size * 0.11} fontWeight="bold" fill="#111827">
        {total}
      </text>
      <text x={cx} y={cy + size * 0.09} textAnchor="middle" fontSize={size * 0.08} fill="#6b7280">
        unidades
      </text>
    </svg>
  )
}

const TRUCK_TYPES: FleetUnit['unitType'][] = ['CHASSIS', 'CHASSIS_WITH_HYDROCRANE', 'TRACTOR', 'TRACTOR_WITH_HYDROCRANE']
const PICKUP_TYPES: FleetUnit['unitType'][] = ['PICKUP']

const isWithoutContract = (clientName?: string | null): boolean => {
  const v = (clientName ?? '').trim().toUpperCase()
  return !v || v === 'SIN CONTRATO'
}

const buildOccupancyPieChart = (segments: OccupancyPdfSegment[]) => {
  const canvas = document.createElement('canvas')
  canvas.width = 360
  canvas.height = 360
  const context = canvas.getContext('2d')
  if (!context) {
    return null
  }

  const total = segments.reduce((sum, segment) => sum + segment.value, 0) || 1
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  const radius = 130
  let angle = -Math.PI / 2

  context.clearRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)

  segments.forEach((segment) => {
    const slice = (segment.value / total) * Math.PI * 2
    context.beginPath()
    context.moveTo(centerX, centerY)
    context.arc(centerX, centerY, radius, angle, angle + slice)
    context.closePath()
    context.fillStyle = segment.color
    context.fill()

    if (segment.share >= 6) {
      const mid = angle + slice / 2
      const labelX = centerX + Math.cos(mid) * (radius * 0.65)
      const labelY = centerY + Math.sin(mid) * (radius * 0.65)
      context.fillStyle = '#0f172a'
      context.font = 'bold 18px Arial'
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(`${segment.share.toFixed(1)}%`, labelX, labelY)
    }

    angle += slice
  })

  context.beginPath()
  context.arc(centerX, centerY, radius * 0.45, 0, Math.PI * 2)
  context.fillStyle = '#ffffff'
  context.fill()

  context.fillStyle = '#111827'
  context.font = 'bold 22px Arial'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(`${total}`, centerX, centerY - 10)
  context.font = '14px Arial'
  context.fillStyle = '#475569'
  context.fillText('unidades', centerX, centerY + 18)

  return canvas.toDataURL('image/png')
}

const occupancyDimensionLabelMap: Record<OccupancyDimension, string> = {
  CLIENT: 'Cliente',
  TYPE: 'Tipo de vehículo',
  STATUS: 'Estado operativo',
  OWNER: 'Empresa propietaria',
  LOCATION: 'Ubicación',
}

const normalizeOccupancyValue = (value: string, emptyLabel: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized || emptyLabel
}

const getOccupancyDimensionValue = (unit: FleetUnit, dimension: OccupancyDimension) => {
  switch (dimension) {
    case 'CLIENT':
      return normalizeOccupancyValue(unit.clientName ?? '', 'Sin asignar')
    case 'TYPE':
      return getFleetUnitTypeLabel(unit.unitType)
    case 'STATUS':
      return getOperationalStatusLabel(unit.operationalStatus)
    case 'OWNER':
      return normalizeOccupancyValue(unit.ownerCompany ?? '', 'Sin empresa')
    case 'LOCATION':
      return normalizeOccupancyValue(unit.location ?? '', 'Sin ubicación')
    default:
      return 'Sin dato'
  }
}

export const ReportsPage = () => {
  const {
    state: { audits, workOrders, repairs, fleetUnits, externalRequests, featureFlags },
    actions: { setAppError },
  } = useAppContext()

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [tasks, setTasks] = useState<TaskRecord[]>([])
  const [isTasksLoading, setIsTasksLoading] = useState(true)
  const [leftProvider, setLeftProvider] = useState('')
  const [rightProvider, setRightProvider] = useState('')
  const [occupancyGroupBy, setOccupancyGroupBy] = useState<OccupancyDimension>('CLIENT')
  const [occupancyBreakdownBy, setOccupancyBreakdownBy] = useState<OccupancyDimension>('TYPE')
  const [occupancyClientFilter, setOccupancyClientFilter] = useState('ALL')
  const [occupancyTypeFilter, setOccupancyTypeFilter] = useState<'ALL' | FleetUnit['unitType']>('ALL')
  const [occupancyStatusFilter, setOccupancyStatusFilter] = useState<'ALL' | FleetOperationalStatus>('ALL')
  const [showAllOccupancyRows, setShowAllOccupancyRows] = useState(false)
  const [activeOccupancyRowLabel, setActiveOccupancyRowLabel] = useState<string | null>(null)
  const [activeOccupancyBreakdownLabel, setActiveOccupancyBreakdownLabel] = useState<string | null>(null)

  const reportFleetUnits = useMemo<FleetUnit[]>(() => {
    const normalized = normalizeFleetUnits(fleetUnits)
    const seen = new Set<string>()

    return normalized.filter((unit) => {
      const key = (unit.internalCode || unit.id || '').trim().toUpperCase()
      if (!key) {
        return true
      }
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      return true
    })
  }, [fleetUnits])

  useEffect(() => {
    let isMounted = true
    void apiRequest<TaskRecord[]>('/tasks')
      .then((response) => {
        if (isMounted) {
          setTasks(Array.isArray(response) ? response : [])
        }
      })
      .catch(() => {
        if (isMounted) {
          setTasks([])
          setAppError('No se pudieron cargar tareas para reportes avanzados.')
        }
      })
      .finally(() => {
        if (isMounted) {
          setIsTasksLoading(false)
        }
      })
    return () => {
      isMounted = false
    }
  }, [setAppError])

  const unitMap = useMemo(() => {
    const map = new Map<string, { domain: string; client: string; typeLabel: string }>()
    reportFleetUnits.forEach((unit) => {
      map.set(unit.id, {
        domain: unit.internalCode,
        client: unit.ownerCompany,
        typeLabel: getFleetUnitTypeLabel(unit.unitType),
      })
    })
    return map
  }, [reportFleetUnits])

  const workOrderMap = useMemo(() => new Map(workOrders.map((order) => [order.id, order])), [workOrders])
  const externalRequestMap = useMemo(
    () => new Map(externalRequests.map((request) => [request.id, request])),
    [externalRequests],
  )

  const filteredAudits = useMemo(
    () => audits.filter((audit) => isWithinRange(audit.performedAt, startDate, endDate)),
    [audits, startDate, endDate],
  )

  const filteredWorkOrders = useMemo(
    () => workOrders.filter((order) => isWithinRange(order.createdAt, startDate, endDate)),
    [workOrders, startDate, endDate],
  )

  const filteredRepairs = useMemo(
    () => repairs.filter((repair) => isWithinRange(repair.createdAt, startDate, endDate)),
    [repairs, startDate, endDate],
  )

  const filteredTasks = useMemo(
    () => tasks.filter((task) => isWithinRange(task.createdAt, startDate, endDate)),
    [tasks, startDate, endDate],
  )

  const rangeLabel = startDate || endDate ? `Periodo: ${startDate || 'Inicio'} -> ${endDate || 'Hoy'}` : 'Periodo completo'

  const occupancyClientOptions = useMemo(
    () =>
      Array.from(new Set(reportFleetUnits.map((unit) => getOccupancyDimensionValue(unit, 'CLIENT')))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [reportFleetUnits],
  )

  const availableBreakdownDimensions = useMemo(
    () =>
      (Object.keys(occupancyDimensionLabelMap) as OccupancyDimension[]).filter((dimension) => dimension !== occupancyGroupBy),
    [occupancyGroupBy],
  )

  const effectiveOccupancyBreakdownBy = availableBreakdownDimensions.includes(occupancyBreakdownBy)
    ? occupancyBreakdownBy
    : availableBreakdownDimensions[0]

  useEffect(() => {
    if (occupancyBreakdownBy !== effectiveOccupancyBreakdownBy) {
      setOccupancyBreakdownBy(effectiveOccupancyBreakdownBy)
    }
  }, [effectiveOccupancyBreakdownBy, occupancyBreakdownBy])

  const filteredOccupancyUnits = useMemo(
    () =>
      reportFleetUnits.filter((unit) => {
        if (occupancyClientFilter !== 'ALL' && getOccupancyDimensionValue(unit, 'CLIENT') !== occupancyClientFilter) {
          return false
        }
        if (occupancyTypeFilter !== 'ALL' && unit.unitType !== occupancyTypeFilter) {
          return false
        }
        if (occupancyStatusFilter !== 'ALL' && unit.operationalStatus !== occupancyStatusFilter) {
          return false
        }
        return true
      }),
    [reportFleetUnits, occupancyClientFilter, occupancyStatusFilter, occupancyTypeFilter],
  )

  const occupancyPivot = useMemo(() => {
    const rowMap = new Map<
      string,
      {
        label: string
        total: number
        unitCodes: Set<string>
        breakdownCounts: Map<string, number>
        unitsByBreakdown: Map<string, Array<{ id: string; code: string }>>
      }
    >()
    const breakdownTotals = new Map<string, number>()

    filteredOccupancyUnits.forEach((unit) => {
      const rowLabel = getOccupancyDimensionValue(unit, occupancyGroupBy)
      const breakdownLabel = getOccupancyDimensionValue(unit, effectiveOccupancyBreakdownBy)
      const currentRow = rowMap.get(rowLabel) ?? {
        label: rowLabel,
        total: 0,
        unitCodes: new Set<string>(),
        breakdownCounts: new Map<string, number>(),
        unitsByBreakdown: new Map<string, Array<{ id: string; code: string }>>(),
      }

      currentRow.total += 1
      currentRow.unitCodes.add(unit.internalCode)
      currentRow.breakdownCounts.set(breakdownLabel, (currentRow.breakdownCounts.get(breakdownLabel) ?? 0) + 1)
      const currentUnits = currentRow.unitsByBreakdown.get(breakdownLabel) ?? []
      currentUnits.push({ id: unit.id, code: unit.internalCode })
      currentRow.unitsByBreakdown.set(breakdownLabel, currentUnits)
      rowMap.set(rowLabel, currentRow)
      breakdownTotals.set(breakdownLabel, (breakdownTotals.get(breakdownLabel) ?? 0) + 1)
    })

    const totalUnits = filteredOccupancyUnits.length
    const breakdownLabels = Array.from(breakdownTotals.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label]) => label)

    const rows: OccupancyPivotRow[] = Array.from(rowMap.values())
      .map((row) => ({
        label: row.label,
        total: row.total,
        share: percentage(row.total, totalUnits),
        unitCodes: Array.from(row.unitCodes).sort((a, b) => a.localeCompare(b)),
        unitsByBreakdown: breakdownLabels.reduce<Record<string, Array<{ id: string; code: string }>>>((accumulator, label) => {
          accumulator[label] = (row.unitsByBreakdown.get(label) ?? []).slice().sort((a, b) => a.code.localeCompare(b.code))
          return accumulator
        }, {}),
        breakdownCounts: breakdownLabels.reduce<Record<string, number>>((accumulator, label) => {
          accumulator[label] = row.breakdownCounts.get(label) ?? 0
          return accumulator
        }, {}),
      }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label))

    const topLimit = 8
    const topRows = rows.slice(0, topLimit)
    const remainderRows = rows.slice(topLimit)
    const remainderCount = remainderRows.reduce((accumulator, row) => accumulator + row.total, 0)

    const segments = topRows.map((row, index) => ({
      label: row.label,
      value: row.total,
      share: row.share,
      color: palette[index % palette.length],
    }))

    if (remainderCount > 0) {
      segments.push({
        label: `Otros (${remainderRows.length})`,
        value: remainderCount,
        share: percentage(remainderCount, totalUnits),
        color: '#64748b',
      })
    }

    return {
      rows,
      breakdownLabels,
      totalUnits,
      totalGroups: rows.length,
      segments,
      unassignedUnits: filteredOccupancyUnits.filter((unit) => !unit.clientName.trim()).length,
    }
  }, [filteredOccupancyUnits, occupancyGroupBy, effectiveOccupancyBreakdownBy])

  const visibleOccupancyRows = useMemo(
    () => (showAllOccupancyRows ? occupancyPivot.rows : occupancyPivot.rows.slice(0, 8)),
    [occupancyPivot.rows, showAllOccupancyRows],
  )

  useEffect(() => {
    if (!activeOccupancyRowLabel) {
      return
    }
    const stillExists = occupancyPivot.rows.some((row) => row.label === activeOccupancyRowLabel)
    if (!stillExists) {
      setActiveOccupancyRowLabel(null)
      setActiveOccupancyBreakdownLabel(null)
    }
  }, [activeOccupancyRowLabel, occupancyPivot.rows])

  const activeOccupancyRow = useMemo(
    () => occupancyPivot.rows.find((row) => row.label === activeOccupancyRowLabel) ?? null,
    [activeOccupancyRowLabel, occupancyPivot.rows],
  )

  useEffect(() => {
    if (!activeOccupancyRow) {
      setActiveOccupancyBreakdownLabel(null)
      return
    }
    if (activeOccupancyBreakdownLabel && (activeOccupancyRow.breakdownCounts[activeOccupancyBreakdownLabel] ?? 0) > 0) {
      return
    }
    const firstAvailableBreakdown = occupancyPivot.breakdownLabels.find(
      (label) => (activeOccupancyRow.breakdownCounts[label] ?? 0) > 0,
    )
    setActiveOccupancyBreakdownLabel(firstAvailableBreakdown ?? null)
  }, [activeOccupancyBreakdownLabel, activeOccupancyRow, occupancyPivot.breakdownLabels])

  const activeOccupancyDomains = useMemo(() => {
    if (!activeOccupancyRow || !activeOccupancyBreakdownLabel) {
      return []
    }
    return activeOccupancyRow.unitsByBreakdown[activeOccupancyBreakdownLabel] ?? []
  }, [activeOccupancyBreakdownLabel, activeOccupancyRow])

  const taskMetrics = useMemo(() => {
    const operational = filteredTasks.filter((task) => !task.isInTaskBank)
    const actionable = operational.filter((task) => task.status !== 'CANCELED')
    const done = actionable.filter((task) => task.status === 'DONE')
    const inProgress = actionable.filter((task) => task.status === 'IN_PROGRESS').length
    const blocked = actionable.filter((task) => task.status === 'BLOCKED').length

    return {
      total: operational.length,
      actionable: actionable.length,
      done: done.length,
      inProgress,
      blocked,
      canceled: operational.length - actionable.length,
      completionRate: percentage(done.length, actionable.length),
    }
  }, [filteredTasks])

  const assigneeCompliance = useMemo<AssigneeCompliance[]>(() => {
    const map = new Map<string, { total: number; done: number }>()
    filteredTasks
      .filter((task) => !task.isInTaskBank && task.status !== 'CANCELED')
      .forEach((task) => {
        const assignee = task.assignedToUserName?.trim() || 'Sin asignar'
        const current = map.get(assignee) ?? { total: 0, done: 0 }
        current.total += 1
        if (task.status === 'DONE') {
          current.done += 1
        }
        map.set(assignee, current)
      })

    return Array.from(map.entries())
      .map(([assignee, values]) => ({
        assignee,
        total: values.total,
        done: values.done,
        completionRate: percentage(values.done, values.total),
      }))
      .sort((a, b) => {
        if (b.done !== a.done) {
          return b.done - a.done
        }
        if (b.completionRate !== a.completionRate) {
          return b.completionRate - a.completionRate
        }
        return b.total - a.total
      })
  }, [filteredTasks])

  const providerMetrics = useMemo<ProviderMetrics[]>(() => {
    const map = new Map<
      string,
      {
        repairsCount: number
        totalCost: number
        totalInvoiced: number
        totalMargin: number
        leadHoursTotal: number
        leadCount: number
        maxLeadHours: number | null
      }
    >()

    filteredRepairs.forEach((repair) => {
      const providerName = repair.supplierName?.trim() || 'Sin proveedor'
      const current = map.get(providerName) ?? {
        repairsCount: 0,
        totalCost: 0,
        totalInvoiced: 0,
        totalMargin: 0,
        leadHoursTotal: 0,
        leadCount: 0,
        maxLeadHours: null,
      }

      current.repairsCount += 1
      current.totalCost += repair.realCost ?? 0
      current.totalInvoiced += repair.invoicedToClient ?? 0
      current.totalMargin += repair.margin ?? 0

      const leadHours = getRepairLeadHours(repair, workOrderMap, externalRequestMap)
      if (leadHours !== null) {
        current.leadHoursTotal += leadHours
        current.leadCount += 1
        current.maxLeadHours =
          current.maxLeadHours === null ? leadHours : Math.max(current.maxLeadHours, leadHours)
      }

      map.set(providerName, current)
    })

    return Array.from(map.entries())
      .map(([providerName, values]) => ({
        providerName,
        repairsCount: values.repairsCount,
        totalCost: values.totalCost,
        totalInvoiced: values.totalInvoiced,
        totalMargin: values.totalMargin,
        leadHoursTotal: values.leadHoursTotal,
        leadCount: values.leadCount,
        avgLeadHours: values.leadCount > 0 ? values.leadHoursTotal / values.leadCount : null,
        maxLeadHours: values.maxLeadHours,
      }))
      .sort((a, b) => {
        if (b.repairsCount !== a.repairsCount) {
          return b.repairsCount - a.repairsCount
        }
        return b.totalCost - a.totalCost
      })
  }, [filteredRepairs, workOrderMap, externalRequestMap])

  const repairsLeadAverage = useMemo(() => {
    const totalLead = providerMetrics.reduce((accumulator, item) => accumulator + item.leadHoursTotal, 0)
    const totalLeadCount = providerMetrics.reduce((accumulator, item) => accumulator + item.leadCount, 0)
    return totalLeadCount > 0 ? totalLead / totalLeadCount : null
  }, [providerMetrics])

  const totalRepairCost = useMemo(
    () => filteredRepairs.reduce((accumulator, repair) => accumulator + (repair.realCost ?? 0), 0),
    [filteredRepairs],
  )
  const totalRepairInvoiced = useMemo(
    () => filteredRepairs.reduce((accumulator, repair) => accumulator + (repair.invoicedToClient ?? 0), 0),
    [filteredRepairs],
  )
  const totalRepairMargin = useMemo(
    () => filteredRepairs.reduce((accumulator, repair) => accumulator + (repair.margin ?? 0), 0),
    [filteredRepairs],
  )

  const approvedAudits = useMemo(
    () => filteredAudits.filter((audit) => audit.result === 'APPROVED').length,
    [filteredAudits],
  )
  const auditApprovalRate = percentage(approvedAudits, filteredAudits.length)

  // ─── Gráficos dona: composición de flota ─────────────────────────────────────
  const fleetCompositionSlices = useMemo<DonutSlice[]>(() => {
    const trucks = reportFleetUnits.filter((u) => TRUCK_TYPES.includes(u.unitType)).length
    const vans = reportFleetUnits.filter((u) => u.unitType === 'VAN').length
    const autos = reportFleetUnits.filter((u) => u.unitType === 'AUTOMOBILE').length
    const pickups = reportFleetUnits.filter((u) => u.unitType === 'PICKUP').length
    const semis = reportFleetUnits.filter((u) => u.unitType === 'SEMI_TRAILER').length
    return [
      { label: 'Camiones', value: trucks, color: '#0ea5e9' },
      { label: 'Furgones', value: vans, color: '#f59e0b' },
      { label: 'Automóvil', value: autos, color: '#10b981' },
      { label: 'Pickup / Camioneta', value: pickups, color: '#8b5cf6' },
      { label: 'Semirremolque', value: semis, color: '#64748b' },
    ].filter((s) => s.value > 0)
  }, [reportFleetUnits])

  const truckContractSlices = useMemo<DonutSlice[]>(() => {
    const trucks = reportFleetUnits.filter((u) => TRUCK_TYPES.includes(u.unitType))
    const withoutContract = trucks.filter((u) => isWithoutContract(u.clientName)).length
    const byClient = new Map<string, number>()
    trucks.filter((u) => !isWithoutContract(u.clientName)).forEach((u) => {
      const name = u.clientName.trim()
      byClient.set(name, (byClient.get(name) ?? 0) + 1)
    })
    const contractSlices: DonutSlice[] = Array.from(byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], index) => ({ label, value, color: palette[index % palette.length] }))
    return [
      { label: 'Sin contrato', value: withoutContract, color: '#e2e8f0' },
      ...contractSlices,
    ].filter((s) => s.value > 0)
  }, [reportFleetUnits])

  const pickupContractSlices = useMemo<DonutSlice[]>(() => {
    const pickups = reportFleetUnits.filter((u) => PICKUP_TYPES.includes(u.unitType))
    const withoutContract = pickups.filter((u) => isWithoutContract(u.clientName)).length
    const byClient = new Map<string, number>()
    pickups.filter((u) => !isWithoutContract(u.clientName)).forEach((u) => {
      const name = u.clientName.trim()
      byClient.set(name, (byClient.get(name) ?? 0) + 1)
    })
    const contractSlices: DonutSlice[] = Array.from(byClient.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([label, value], index) => ({ label, value, color: palette[index % palette.length] }))
    return [
      { label: 'Sin contrato', value: withoutContract, color: '#e2e8f0' },
      ...contractSlices,
    ].filter((s) => s.value > 0)
  }, [reportFleetUnits])

  const effectiveLeftProvider = useMemo(() => {
    if (providerMetrics.length === 0) {
      return ''
    }
    if (providerMetrics.some((item) => item.providerName === leftProvider)) {
      return leftProvider
    }
    return providerMetrics[0]?.providerName ?? ''
  }, [providerMetrics, leftProvider])

  const effectiveRightProvider = useMemo(() => {
    if (providerMetrics.length === 0) {
      return ''
    }
    if (providerMetrics.some((item) => item.providerName === rightProvider)) {
      return rightProvider
    }
    return providerMetrics[1]?.providerName ?? effectiveLeftProvider
  }, [providerMetrics, rightProvider, effectiveLeftProvider])

  const leftProviderMetrics = useMemo(
    () => providerMetrics.find((item) => item.providerName === effectiveLeftProvider) ?? null,
    [providerMetrics, effectiveLeftProvider],
  )
  const rightProviderMetrics = useMemo(
    () => providerMetrics.find((item) => item.providerName === effectiveRightProvider) ?? null,
    [providerMetrics, effectiveRightProvider],
  )

  if (!featureFlags.showReportsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Reportes</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const resolveRepairSourceCode = (repair: RepairRecord) => {
    if (repair.sourceType === 'EXTERNAL_REQUEST') {
      return externalRequestMap.get(repair.externalRequestId ?? '')?.code ?? 'N/A'
    }
    return workOrderMap.get(repair.workOrderId ?? '')?.code ?? 'N/A'
  }

  const exportAuditsCsv = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'INS-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    downloadCsv('inspecciones.csv', buildCsv(headers, rows))
  }

  const exportAuditsPdf = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'INS-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    const doc = buildPdf('Reporte de Inspecciones', rangeLabel, headers, rows)
    doc.save('inspecciones.pdf')
  }

  const exportAuditsXlsx = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'INS-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    downloadXlsx('inspecciones.xlsx', headers, rows)
  }

  const exportWorkOrdersCsv = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Estado', 'Tareas', 'Repuestos', 'Pendiente Reaudit']
    const rows = filteredWorkOrders.map((order) => [
      order.code ?? 'OT-LEGACY',
      formatDateTime(order.createdAt),
      unitMap.get(order.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(order.unitId)?.client ?? 'Sin cliente',
      unitMap.get(order.unitId)?.typeLabel ?? 'Sin tipo',
      order.status,
      order.taskList.length,
      order.spareParts.length,
      order.pendingReaudit ? 'Si' : 'No',
    ])
    downloadCsv('ordenes-trabajo.csv', buildCsv(headers, rows))
  }

  const exportWorkOrdersPdf = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo', 'Estado', 'Tareas', 'Repuestos', 'Pend. Reaudit']
    const rows = filteredWorkOrders.map((order) => [
      order.code ?? 'OT-LEGACY',
      formatDateTime(order.createdAt),
      unitMap.get(order.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(order.unitId)?.client ?? 'Sin cliente',
      unitMap.get(order.unitId)?.typeLabel ?? 'Sin tipo',
      order.status,
      String(order.taskList.length),
      String(order.spareParts.length),
      order.pendingReaudit ? 'Si' : 'No',
    ])
    const doc = buildPdf('Reporte de Ordenes de Trabajo', rangeLabel, headers, rows)
    doc.save('ordenes-trabajo.pdf')
  }

  const exportWorkOrdersXlsx = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Estado', 'Tareas', 'Repuestos', 'Pendiente Reaudit']
    const rows = filteredWorkOrders.map((order) => [
      order.code ?? 'OT-LEGACY',
      formatDateTime(order.createdAt),
      unitMap.get(order.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(order.unitId)?.client ?? 'Sin cliente',
      unitMap.get(order.unitId)?.typeLabel ?? 'Sin tipo',
      order.status,
      order.taskList.length,
      order.spareParts.length,
      order.pendingReaudit ? 'Si' : 'No',
    ])
    downloadXlsx('ordenes-trabajo.xlsx', headers, rows)
  }

  const exportRepairsCsv = () => {
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Origen', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      resolveRepairSourceCode(repair),
      repair.supplierName,
      repair.realCost,
      repair.invoicedToClient,
      repair.margin,
    ])
    downloadCsv('reparaciones.csv', buildCsv(headers, rows))
  }

  const exportRepairsPdf = () => {
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo', 'Origen', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      resolveRepairSourceCode(repair),
      repair.supplierName,
      repair.realCost.toFixed(2),
      repair.invoicedToClient.toFixed(2),
      repair.margin.toFixed(2),
    ])
    const doc = buildPdf('Reporte de Reparaciones', rangeLabel, headers, rows)
    doc.save('reparaciones.pdf')
  }

  const exportRepairsXlsx = () => {
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Origen', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      resolveRepairSourceCode(repair),
      repair.supplierName,
      repair.realCost,
      repair.invoicedToClient,
      repair.margin,
    ])
    downloadXlsx('reparaciones.xlsx', headers, rows)
  }

  const exportOccupancyPdf = () => {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 28
    let cursorY = 28

    doc.setFillColor('#000000')
    doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 28, 6, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor('#facc15')
    doc.text('REPORTE DINAMICO DE FLOTA', pageWidth / 2, cursorY + 19, { align: 'center' })
    cursorY += 42

    doc.setTextColor('#475569')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, margin, cursorY)
    cursorY += 14
    doc.text(
      `Agrupar por: ${occupancyDimensionLabelMap[occupancyGroupBy]} | Desglosar por: ${occupancyDimensionLabelMap[effectiveOccupancyBreakdownBy]}`,
      margin,
      cursorY,
    )
    cursorY += 14
    doc.text(`Total de unidades: ${occupancyPivot.totalUnits} | Grupos: ${occupancyPivot.totalGroups}`, margin, cursorY)
    cursorY += 20

    const pdfSegments = occupancyPivot.rows.map((row, index) => ({
      label: row.label,
      value: row.total,
      share: row.share,
      color: palette[index % palette.length],
    }))
    const chartImage = buildOccupancyPieChart(pdfSegments)
    const summaryColumns = occupancyPivot.rows.length > 8 ? 2 : 1
    const rowsPerColumn = Math.max(1, Math.ceil(occupancyPivot.rows.length / summaryColumns))
    const maxCardHeight = pageHeight - cursorY - margin
    const summaryRowHeight = Math.min(40, Math.max(34, Math.floor((maxCardHeight - 56) / rowsPerColumn)))
    const chartCardHeight = Math.min(maxCardHeight, Math.max(220, 56 + rowsPerColumn * summaryRowHeight))
    const chartSize = Math.min(224, Math.max(176, chartCardHeight - 30))
    if (chartImage) {
      doc.setDrawColor('#cbd5e1')
      doc.setFillColor('#ffffff')
      doc.roundedRect(margin, cursorY, 260, chartCardHeight, 8, 8, 'FD')
      doc.addImage(chartImage, 'PNG', margin + (260 - chartSize) / 2, cursorY + (chartCardHeight - chartSize) / 2, chartSize, chartSize)
    }

    const summaryStartX = margin + 280
    const summaryWidth = pageWidth - summaryStartX - margin
    let summaryY = cursorY

    doc.setDrawColor('#cbd5e1')
    doc.setFillColor('#ffffff')
    doc.roundedRect(summaryStartX, summaryY, summaryWidth, chartCardHeight, 8, 8, 'FD')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor('#0f172a')
    doc.text('Resumen por grupo', summaryStartX + 16, summaryY + 20)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor('#64748b')
    doc.text('Participacion completa sobre la flota filtrada.', summaryStartX + 16, summaryY + 36)

    summaryY += 54
    const summaryInnerWidth = summaryWidth - 24
    const summaryColumnGap = 16
    const summaryColumnWidth =
      (summaryInnerWidth - (summaryColumns - 1) * summaryColumnGap) / summaryColumns
    const cropSummaryLabel = (value: string) => {
      const maxChars = summaryColumns === 2 ? 22 : 36
      return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value
    }

    occupancyPivot.rows.forEach((row, index) => {
      const columnIndex = Math.floor(index / rowsPerColumn)
      const rowIndex = index % rowsPerColumn
      const cardX = summaryStartX + 12 + columnIndex * (summaryColumnWidth + summaryColumnGap)
      const cardY = summaryY + rowIndex * summaryRowHeight
      const cardHeight = 30
      const barTrackWidth = summaryColumnWidth - 20
      const barWidth = Math.max(12, barTrackWidth * (row.share / 100))
      const color = palette[index % palette.length]
      doc.setFillColor('#f8fafc')
      doc.roundedRect(cardX, cardY, summaryColumnWidth, cardHeight, 5, 5, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9)
      doc.setTextColor('#0f172a')
      doc.text(cropSummaryLabel(row.label), cardX + 8, cardY + 13)
      doc.setTextColor('#475569')
      doc.text(`${row.total} unidades`, cardX + summaryColumnWidth - 100, cardY + 13)
      doc.text(`${row.share.toFixed(1)}%`, cardX + summaryColumnWidth - 40, cardY + 13)
      doc.setFillColor(color)
      doc.setFillColor('#e2e8f0')
      doc.roundedRect(cardX + 8, cardY + 20, barTrackWidth, 6, 4, 4, 'F')
      doc.setFillColor(color)
      doc.roundedRect(cardX + 8, cardY + 20, barWidth, 6, 4, 4, 'F')
    })

    cursorY += chartCardHeight + 22

    const occupancyUnitRows = filteredOccupancyUnits
      .slice()
      .sort((a, b) => {
        const groupCompare = getOccupancyDimensionValue(a, occupancyGroupBy).localeCompare(
          getOccupancyDimensionValue(b, occupancyGroupBy),
        )
        if (groupCompare !== 0) {
          return groupCompare
        }
        const breakdownCompare = getOccupancyDimensionValue(a, effectiveOccupancyBreakdownBy).localeCompare(
          getOccupancyDimensionValue(b, effectiveOccupancyBreakdownBy),
        )
        if (breakdownCompare !== 0) {
          return breakdownCompare
        }
        return a.internalCode.localeCompare(b.internalCode)
      })
      .map((unit) => ({
        groupLabel: getOccupancyDimensionValue(unit, occupancyGroupBy),
        breakdownLabel: getOccupancyDimensionValue(unit, effectiveOccupancyBreakdownBy),
        domain: unit.internalCode || 'Sin dominio',
        brand: unit.brand || '-',
        model: unit.model || '-',
        year: String(unit.year || '-'),
        owner: normalizeOccupancyValue(unit.ownerCompany ?? '', 'Sin empresa'),
        client: normalizeOccupancyValue(unit.clientName ?? '', 'Sin asignar'),
        type: getFleetUnitTypeLabel(unit.unitType),
        location: normalizeOccupancyValue(unit.location ?? '', 'Sin ubicación'),
      }))

    const detailHeaders = ['Dominio', 'Marca', 'Modelo', 'Año', 'Empresa prop.', 'Cliente', 'Tipo', 'Ubicación']
    const detailColumnWidths = [72, 82, 96, 42, 112, 112, 124, 120]
    const detailFontSize = 8
    const detailRowHeight = 20
    const tableWidth = detailColumnWidths.reduce((sum, width) => sum + width, 0)
    const drawDetailHeader = (y: number) => {
      let x = margin
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(detailFontSize)
      doc.setTextColor('#ffffff')
      doc.setFillColor('#0f172a')
      detailHeaders.forEach((header, index) => {
        const width = detailColumnWidths[index] ?? 60
        doc.rect(x, y, width, detailRowHeight, 'F')
        doc.text(header, x + 3, y + 12)
        x += width
      })
    }
    const cropCell = (value: string, width: number) => {
      const safeValue = value || '-'
      const maxChars = Math.max(8, Math.floor(width / 5.8))
      return safeValue.length > maxChars ? `${safeValue.slice(0, maxChars - 1)}…` : safeValue
    }

    doc.addPage()
    cursorY = 28
    doc.setFillColor('#000000')
    doc.roundedRect(margin, cursorY, pageWidth - margin * 2, 26, 6, 6, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.setTextColor('#facc15')
    doc.text('DETALLE DE DOMINIOS', pageWidth / 2, cursorY + 17, { align: 'center' })
    cursorY += 40
    doc.setTextColor('#475569')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.text(
      `Listado de ${occupancyUnitRows.length} unidades ordenadas por ${occupancyDimensionLabelMap[occupancyGroupBy].toLowerCase()} y ${occupancyDimensionLabelMap[effectiveOccupancyBreakdownBy].toLowerCase()}.`,
      margin,
      cursorY,
    )
    cursorY += 18

    let detailY = cursorY
    let currentGroup = ''
    let currentBreakdown = ''
    let rowIndexWithinSection = 0

    occupancyUnitRows.forEach((row) => {
      const needsGroupHeader = row.groupLabel !== currentGroup || row.breakdownLabel !== currentBreakdown
      if (needsGroupHeader) {
        if (detailY > pageHeight - 92) {
          doc.addPage()
          detailY = 28
          doc.setFillColor('#000000')
          doc.roundedRect(margin, detailY, pageWidth - margin * 2, 26, 6, 6, 'F')
          doc.setFont('helvetica', 'bold')
          doc.setFontSize(14)
          doc.setTextColor('#facc15')
          doc.text('DETALLE DE DOMINIOS', pageWidth / 2, detailY + 17, { align: 'center' })
          detailY += 40
        }
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor('#0f172a')
        doc.setFillColor('#fef3c7')
        doc.roundedRect(margin, detailY, tableWidth, 20, 5, 5, 'F')
        doc.text(`${row.groupLabel} · ${row.breakdownLabel}`, margin + 8, detailY + 13)
        const sectionCount = occupancyUnitRows.filter(
          (item) => item.groupLabel === row.groupLabel && item.breakdownLabel === row.breakdownLabel,
        ).length
        doc.setTextColor('#92400e')
        doc.setFontSize(8)
        doc.text(`${sectionCount} unidad(es)`, margin + tableWidth - 70, detailY + 13)
        detailY += 26
        drawDetailHeader(detailY)
        detailY += detailRowHeight
        currentGroup = row.groupLabel
        currentBreakdown = row.breakdownLabel
        rowIndexWithinSection = 0
      }

      if (detailY > pageHeight - 34) {
        doc.addPage()
        detailY = 28
        doc.setFillColor('#000000')
        doc.roundedRect(margin, detailY, pageWidth - margin * 2, 26, 6, 6, 'F')
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(14)
        doc.setTextColor('#facc15')
        doc.text('DETALLE DE DOMINIOS', pageWidth / 2, detailY + 17, { align: 'center' })
        detailY += 40
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor('#0f172a')
        doc.setFillColor('#fef3c7')
        doc.roundedRect(margin, detailY, tableWidth, 20, 5, 5, 'F')
        doc.text(`${currentGroup} · ${currentBreakdown}`, margin + 8, detailY + 13)
        detailY += 26
        drawDetailHeader(detailY)
        detailY += detailRowHeight
      }

      let x = margin
      const values = [row.domain, row.brand, row.model, row.year, row.owner, row.client, row.type, row.location]
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(detailFontSize)
      doc.setTextColor('#111827')
      values.forEach((value, index) => {
        const width = detailColumnWidths[index] ?? 60
        doc.setDrawColor('#cbd5e1')
        doc.setFillColor(rowIndexWithinSection % 2 === 0 ? '#ffffff' : '#f8fafc')
        doc.rect(x, detailY, width, detailRowHeight, 'FD')
        doc.text(cropCell(value, width), x + 3, detailY + 12)
        x += width
      })
      detailY += detailRowHeight
      rowIndexWithinSection += 1
    })

    const noFiltersApplied = occupancyClientFilter === 'ALL' && occupancyTypeFilter === 'ALL' && occupancyStatusFilter === 'ALL'

    if (noFiltersApplied) {
      doc.addPage()
      let donY = margin

      doc.setFillColor('#000000')
      doc.roundedRect(margin, donY, pageWidth - margin * 2, 26, 6, 6, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(14)
      doc.setTextColor('#facc15')
      doc.text('COMPOSICIÓN DE FLOTA', pageWidth / 2, donY + 17, { align: 'center' })
      donY += 38

      const donCharts = [
        {
          title: 'Composición por tipo',
          subtitle: `${reportFleetUnits.length} unidades totales`,
          slices: fleetCompositionSlices,
        },
        {
          title: 'Camiones por contrato',
          subtitle: `${truckContractSlices.reduce((s, x) => s + x.value, 0)} camiones (chasis, tractor, hidro)`,
          slices: truckContractSlices,
        },
        {
          title: 'Camionetas por contrato',
          subtitle: `${pickupContractSlices.reduce((s, x) => s + x.value, 0)} pickups / camionetas`,
          slices: pickupContractSlices,
        },
      ]

      const colGap = 12
      const colWidth = (pageWidth - margin * 2 - colGap * 2) / 3
      const cardH = pageHeight - donY - margin

      donCharts.forEach((section, colIndex) => {
        const colX = margin + colIndex * (colWidth + colGap)
        const total = section.slices.reduce((s, x) => s + x.value, 0) || 1

        doc.setDrawColor('#cbd5e1')
        doc.setFillColor('#ffffff')
        doc.roundedRect(colX, donY, colWidth, cardH, 8, 8, 'FD')

        doc.setFont('helvetica', 'bold')
        doc.setFontSize(10)
        doc.setTextColor('#0f172a')
        doc.text(section.title, colX + 10, donY + 18)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(8)
        doc.setTextColor('#64748b')
        doc.text(section.subtitle, colX + 10, donY + 30)

        const chartSegs = section.slices.map((s) => ({
          label: s.label,
          value: s.value,
          share: (s.value / total) * 100,
          color: s.color,
        }))
        const chartImg = buildOccupancyPieChart(chartSegs)
        const chartSize = Math.min(colWidth - 24, 130)
        if (chartImg) {
          doc.addImage(chartImg, 'PNG', colX + (colWidth - chartSize) / 2, donY + 40, chartSize, chartSize)
        }

        let legendY = donY + 40 + chartSize + 10
        const maxLabelChars = Math.max(8, Math.floor((colWidth - 72) / 5.2))
        section.slices.forEach((slice) => {
          if (legendY > donY + cardH - 10) return
          const pct = ((slice.value / total) * 100).toFixed(0)
          const label = slice.label.length > maxLabelChars ? `${slice.label.slice(0, maxLabelChars - 1)}…` : slice.label
          doc.setFillColor(slice.color)
          doc.circle(colX + 16, legendY - 2.5, 3.5, 'F')
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(8)
          doc.setTextColor('#374151')
          doc.text(label, colX + 26, legendY)
          doc.setFont('helvetica', 'bold')
          doc.setTextColor('#0f172a')
          doc.text(`${slice.value} (${pct}%)`, colX + colWidth - 8, legendY, { align: 'right' })
          legendY += 13
        })
      })
    }

    doc.save('ocupacion-flota-por-cliente.pdf')
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Reportes</h2>
        <p className="text-sm text-slate-600">
          Cumplimiento de tareas, ranking de reparaciones y comparativa proveedor vs proveedor en tiempo y costos.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Reporte dinámico de flota</h3>
              <p className="text-xs text-slate-500">Elegí criterios y armá una vista tipo tabla dinámica sobre la flota activa.</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={exportOccupancyPdf}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                Descargar PDF
              </button>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700">
                Grupos: {occupancyPivot.totalGroups}
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                Sin asignar: {occupancyPivot.unassignedUnits}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Agrupar por
              <select
                value={occupancyGroupBy}
                onChange={(event) => setOccupancyGroupBy(event.target.value as OccupancyDimension)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              >
                {(Object.keys(occupancyDimensionLabelMap) as OccupancyDimension[]).map((dimension) => (
                  <option key={dimension} value={dimension}>
                    {occupancyDimensionLabelMap[dimension]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Desglosar por
              <select
                value={effectiveOccupancyBreakdownBy}
                onChange={(event) => setOccupancyBreakdownBy(event.target.value as OccupancyDimension)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              >
                {availableBreakdownDimensions.map((dimension) => (
                  <option key={dimension} value={dimension}>
                    {occupancyDimensionLabelMap[dimension]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Cliente
              <select
                value={occupancyClientFilter}
                onChange={(event) => setOccupancyClientFilter(event.target.value)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              >
                <option value="ALL">Todos</option>
                {occupancyClientOptions.map((client) => (
                  <option key={client} value={client}>
                    {client}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Tipo
              <select
                value={occupancyTypeFilter}
                onChange={(event) => setOccupancyTypeFilter(event.target.value as 'ALL' | FleetUnit['unitType'])}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              >
                <option value="ALL">Todos</option>
                {fleetUnitTypes.map((unitType) => (
                  <option key={unitType} value={unitType}>
                    {getFleetUnitTypeLabel(unitType)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
              Estado
              <select
                value={occupancyStatusFilter}
                onChange={(event) => setOccupancyStatusFilter(event.target.value as 'ALL' | FleetOperationalStatus)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
              >
                <option value="ALL">Todos</option>
                {fleetOperationalStatuses.map((status) => (
                  <option key={status} value={status}>
                    {getOperationalStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr]">
            <div className="relative flex items-center justify-center">
              <svg width={200} height={200} viewBox="0 0 200 200">
                <g transform="translate(100,100)">
                  <circle r={70} fill="transparent" stroke="#e2e8f0" strokeWidth={18} />
                  {occupancyPivot.segments.reduce<{ dashOffset: number; elements: ReactNode[] }>(
                    (acc, segment, index) => {
                      const total = occupancyPivot.segments.reduce((sum, item) => sum + item.value, 0) || 1
                      const circumference = 2 * Math.PI * 70
                      const length = (segment.value / total) * circumference
                      const dashArray = `${length} ${circumference - length}`
                      const element = (
                        <circle
                          key={`${segment.label}-${index}`}
                          r={70}
                          fill="transparent"
                          stroke={segment.color}
                          strokeWidth={18}
                          strokeDasharray={dashArray}
                          strokeDashoffset={-acc.dashOffset}
                          transform="rotate(-90)"
                        />
                      )
                      return { dashOffset: acc.dashOffset + length, elements: [...acc.elements, element] }
                    },
                    { dashOffset: 0, elements: [] },
                  ).elements}
                </g>
              </svg>
              <div className="pointer-events-none absolute text-center">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Unidades</p>
                <p className="text-2xl font-bold text-slate-900">{occupancyPivot.totalUnits}</p>
              </div>
            </div>
            <div className="space-y-2">
              {occupancyPivot.segments.map((segment) => (
                <div key={segment.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{segment.value} ({segment.share.toFixed(1)}%)</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(4, Math.min(100, segment.share))}%`, backgroundColor: segment.color }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Gráfico interactivo por grupo</h4>
                <p className="text-xs text-slate-500">
                  Tocá una barra para inspeccionar cómo se compone cada {occupancyDimensionLabelMap[occupancyGroupBy].toLowerCase()}.
                </p>
              </div>
              {activeOccupancyRow ? (
                <button
                  type="button"
                  onClick={() => setActiveOccupancyRowLabel(null)}
                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  Limpiar selección
                </button>
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              {visibleOccupancyRows.map((row) => {
                const isActive = row.label === activeOccupancyRowLabel
                return (
                  <button
                    key={`chart-${row.label}`}
                    type="button"
                    onClick={() => setActiveOccupancyRowLabel((current) => (current === row.label ? null : row.label))}
                    className={[
                      'w-full rounded-xl border px-3 py-3 text-left transition',
                      isActive ? 'border-amber-300 bg-amber-50 shadow-sm' : 'border-slate-200 bg-white hover:border-slate-300',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{row.label}</p>
                        <p className="text-[11px] text-slate-500">
                          {row.total} unidades · {row.share.toFixed(1)}%
                        </p>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {row.total}
                      </span>
                    </div>

                    <div className="mt-3 flex h-4 w-full overflow-hidden rounded-full bg-slate-200">
                      {occupancyPivot.breakdownLabels.map((label, index) => {
                        const value = row.breakdownCounts[label] ?? 0
                        if (value <= 0) {
                          return null
                        }
                        const width = (value / row.total) * 100
                        return (
                          <div
                            key={`${row.label}-${label}`}
                            title={`${label}: ${value} unidad(es)`}
                            className="h-full"
                            style={{
                              width: `${width}%`,
                              backgroundColor: palette[index % palette.length],
                            }}
                          />
                        )
                      })}
                    </div>
                  </button>
                )
              })}
            </div>

            {activeOccupancyRow ? (
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h5 className="text-sm font-bold text-slate-900">{activeOccupancyRow.label}</h5>
                    <p className="text-xs text-slate-500">
                      Desglose por {occupancyDimensionLabelMap[effectiveOccupancyBreakdownBy].toLowerCase()}
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                    {activeOccupancyRow.total} unidades
                  </span>
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {occupancyPivot.breakdownLabels.map((label, index) => {
                    const value = activeOccupancyRow.breakdownCounts[label] ?? 0
                    const share = activeOccupancyRow.total > 0 ? (value / activeOccupancyRow.total) * 100 : 0
                    return (
                      <div key={`detail-${label}`} className="rounded-lg border border-slate-200 p-3">
                        <div className="flex items-center justify-between gap-2 text-sm">
                          <div className="flex items-center gap-2 font-semibold text-slate-800">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                            {label}
                          </div>
                          <span className="text-xs font-semibold text-slate-600">
                            {value} ({share.toFixed(1)}%)
                          </span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(value > 0 ? 6 : 0, Math.min(100, share))}%`,
                              backgroundColor: palette[index % palette.length],
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Explorador de dominios</h3>
              <p className="text-xs text-slate-500">
                Seleccioná un grupo en el gráfico y después una categoría para ver dominios y abrir la ficha de flota.
              </p>
            </div>
            {occupancyPivot.rows.length > 8 ? (
              <button
                type="button"
                onClick={() => setShowAllOccupancyRows((previous) => !previous)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                {showAllOccupancyRows ? 'Ver menos' : 'Ver todos'}
              </button>
            ) : null}
          </div>

          <div className="mt-4 grid gap-2 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Vista</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {occupancyDimensionLabelMap[occupancyGroupBy]} por {occupancyDimensionLabelMap[effectiveOccupancyBreakdownBy].toLowerCase()}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Grupo activo</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {activeOccupancyRow?.label ?? 'Ninguno seleccionado'}
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Categoría activa</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {activeOccupancyBreakdownLabel ?? 'Elegí una categoría'}
              </p>
            </div>
          </div>

          {!activeOccupancyRow ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
              <p className="text-sm font-semibold text-slate-700">Seleccioná un grupo del gráfico interactivo</p>
              <p className="mt-1 text-xs text-slate-500">
                Por ejemplo, hacé click en INTERMEC y después elegí Pickup, Chasis, Tractor, etc.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-slate-900">{activeOccupancyRow.label}</p>
                    <p className="text-xs text-slate-500">
                      {activeOccupancyRow.total} unidades · {activeOccupancyRow.share.toFixed(1)}% del total filtrado
                    </p>
                  </div>
                  <span className="rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-semibold text-amber-700">
                    {occupancyDimensionLabelMap[effectiveOccupancyBreakdownBy]}
                  </span>
                </div>

                <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {occupancyPivot.breakdownLabels.map((label, index) => {
                    const value = activeOccupancyRow.breakdownCounts[label] ?? 0
                    const localShare = activeOccupancyRow.total > 0 ? (value / activeOccupancyRow.total) * 100 : 0
                    const isActiveBreakdown = label === activeOccupancyBreakdownLabel
                    return (
                      <button
                        key={`${activeOccupancyRow.label}-${label}`}
                        type="button"
                        disabled={value <= 0}
                        onClick={() => setActiveOccupancyBreakdownLabel(label)}
                        className={[
                          'rounded-lg border px-3 py-3 text-left transition',
                          value <= 0
                            ? 'cursor-not-allowed border-slate-100 bg-slate-50/40 opacity-50'
                            : isActiveBreakdown
                              ? 'border-amber-300 bg-white shadow-sm'
                              : 'border-slate-200 bg-white hover:border-slate-300',
                        ].join(' ')}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                            <span className="text-xs font-semibold text-slate-700">{label}</span>
                          </div>
                          <span className="text-xs font-bold text-slate-900">{value}</span>
                        </div>
                        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${Math.max(value > 0 ? 6 : 0, Math.min(100, localShare))}%`,
                              backgroundColor: palette[index % palette.length],
                            }}
                          />
                        </div>
                        <p className="mt-1 text-[11px] text-slate-500">{localShare.toFixed(1)}% del grupo</p>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      {activeOccupancyBreakdownLabel ? `${activeOccupancyBreakdownLabel} · Dominios` : 'Dominios'}
                    </h4>
                    <p className="text-xs text-slate-500">Hacé click en un dominio para abrir su ficha en flota.</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-700">
                    {activeOccupancyDomains.length} dominio(s)
                  </span>
                </div>

                {activeOccupancyDomains.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-500">No hay dominios disponibles para esa selección.</p>
                ) : (
                  <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                    {activeOccupancyDomains.map((unit) => (
                      <Link
                        key={`${unit.id}-${unit.code}`}
                        to={buildFleetDetailPath(unit.id)}
                        className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-semibold text-slate-800 transition hover:border-amber-300 hover:bg-amber-50"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span>{unit.code}</span>
                          <span className="text-xs text-amber-700">Abrir</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </article>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="grid gap-4 md:grid-cols-3">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Fecha desde
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Fecha hasta
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
          </label>
          <div className="flex items-end">
            <p className="text-xs text-slate-500">{rangeLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Cumplimiento tareas</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{taskMetrics.completionRate.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-slate-600">
            {taskMetrics.done} hechas de {taskMetrics.actionable} evaluables
          </p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reparaciones</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{filteredRepairs.length}</p>
          <p className="mt-1 text-xs text-slate-600">Registradas en el periodo</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tiempo prom. reparacion</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatHoursToHuman(repairsLeadAverage)}</p>
          <p className="mt-1 text-xs text-slate-600">Desde origen (OT/NDP) hasta carga</p>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aprobacion inspecciones</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{auditApprovalRate.toFixed(1)}%</p>
          <p className="mt-1 text-xs text-slate-600">
            {approvedAudits}/{filteredAudits.length || 0} aprobadas
          </p>
        </article>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Cumplimiento de tareas por responsable</h3>
            <span className="text-xs text-slate-500">
              {isTasksLoading ? 'Cargando tareas...' : `${assigneeCompliance.length} responsables`}
            </span>
          </div>
          <div className="mt-4 space-y-3">
            {assigneeCompliance.length === 0 ? (
              <p className="text-sm text-slate-500">No hay tareas operativas para el rango seleccionado.</p>
            ) : (
              assigneeCompliance.slice(0, 8).map((item) => (
                <div key={item.assignee} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">{item.assignee}</p>
                    <p className="text-xs font-semibold text-slate-600">
                      {item.done}/{item.total} ({item.completionRate.toFixed(1)}%)
                    </p>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${Math.max(4, Math.min(100, item.completionRate))}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Quien realizo mas reparaciones</h3>
            <span className="text-xs text-slate-500">Ranking por proveedor</span>
          </div>
          <div className="mt-4 space-y-3">
            {providerMetrics.length === 0 ? (
              <p className="text-sm text-slate-500">No hay reparaciones en el rango seleccionado.</p>
            ) : (
              providerMetrics.slice(0, 6).map((provider, index) => (
                <div key={provider.providerName} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800">
                      {index + 1}. {provider.providerName}
                    </p>
                    <p className="text-xs font-semibold text-slate-600">{provider.repairsCount} reparaciones</p>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-sky-500 transition-all"
                      style={{
                        width: `${Math.max(
                          6,
                          Math.min(100, (provider.repairsCount / (providerMetrics[0]?.repairsCount || 1)) * 100),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </article>
      </div>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-semibold text-slate-900">Proveedor vs proveedor (tiempo y plata)</h3>
          <span className="text-xs text-slate-500">{providerMetrics.length} proveedores detectados</span>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Proveedor A
            <select
              value={effectiveLeftProvider}
              onChange={(event) => setLeftProvider(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {providerMetrics.map((item) => (
                <option key={`left-${item.providerName}`} value={item.providerName}>
                  {item.providerName}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Proveedor B
            <select
              value={effectiveRightProvider}
              onChange={(event) => setRightProvider(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {providerMetrics.map((item) => (
                <option key={`right-${item.providerName}`} value={item.providerName}>
                  {item.providerName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {[leftProviderMetrics, rightProviderMetrics].map((provider, index) => (
            <div key={provider?.providerName ?? `provider-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              {provider ? (
                <>
                  <p className="text-sm font-bold text-slate-900">{provider.providerName}</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Reparaciones</p>
                      <p className="font-semibold text-slate-900">{provider.repairsCount}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Costo total</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(provider.totalCost)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Ticket promedio</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(provider.totalCost / provider.repairsCount)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Tiempo promedio</p>
                      <p className="font-semibold text-slate-900">{formatHoursToHuman(provider.avgLeadHours)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Margen total</p>
                      <p className="font-semibold text-slate-900">{formatCurrency(provider.totalMargin)}</p>
                    </div>
                    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                      <p className="text-slate-500">Max tiempo</p>
                      <p className="font-semibold text-slate-900">{formatHoursToHuman(provider.maxLeadHours)}</p>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-sm text-slate-500">Sin datos para comparar.</p>
              )}
            </div>
          ))}
        </div>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Resultado economico del periodo</h3>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Costo total reparaciones</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(totalRepairCost)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Facturado cliente</p>
            <p className="mt-1 text-lg font-bold text-slate-900">{formatCurrency(totalRepairInvoiced)}</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 sm:col-span-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Margen total</p>
            <p className={`mt-1 text-lg font-bold ${totalRepairMargin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {formatCurrency(totalRepairMargin)}
            </p>
          </div>
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Inspecciones</h3>
          <p className="mt-1 text-xs text-slate-500">Registros: {filteredAudits.length}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportAuditsPdf}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={exportAuditsCsv}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={exportAuditsXlsx}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              Descargar XLSX
            </button>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Ordenes de Trabajo</h3>
          <p className="mt-1 text-xs text-slate-500">Registros: {filteredWorkOrders.length}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportWorkOrdersPdf}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={exportWorkOrdersCsv}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={exportWorkOrdersXlsx}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              Descargar XLSX
            </button>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Reparaciones</h3>
          <p className="mt-1 text-xs text-slate-500">Registros: {filteredRepairs.length}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportRepairsPdf}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Descargar PDF
            </button>
            <button
              type="button"
              onClick={exportRepairsCsv}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Descargar CSV
            </button>
            <button
              type="button"
              onClick={exportRepairsXlsx}
              className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
            >
              Descargar XLSX
            </button>
          </div>
        </article>
      </div>

      {/* ── Composición de flota (gráficos dona) ───────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Composición de flota</h3>
          <p className="mt-1 text-xs text-slate-500">Distribución por tipo de vehículo.</p>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <DonutChart slices={fleetCompositionSlices} size={160} />
            <ul className="flex-1 space-y-2">
              {fleetCompositionSlices.map((slice) => (
                <li key={slice.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                    <span className="font-medium text-slate-700">{slice.label}</span>
                  </span>
                  <span className="font-semibold text-slate-900">
                    {slice.value}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      ({percentage(slice.value, fleetCompositionSlices.reduce((s, x) => s + x.value, 0)).toFixed(0)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Camiones por contrato</h3>
          <p className="mt-1 text-xs text-slate-500">
            {truckContractSlices.reduce((s, x) => s + x.value, 0)} camiones (chasis, tractor, hidro).
          </p>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <DonutChart slices={truckContractSlices} size={160} />
            <ul className="flex-1 space-y-2">
              {truckContractSlices.map((slice) => (
                <li key={slice.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                    <span className="font-medium text-slate-700 truncate max-w-[120px]" title={slice.label}>{slice.label}</span>
                  </span>
                  <span className="font-semibold text-slate-900">
                    {slice.value}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      ({percentage(slice.value, truckContractSlices.reduce((s, x) => s + x.value, 0)).toFixed(0)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Camionetas por contrato</h3>
          <p className="mt-1 text-xs text-slate-500">
            {pickupContractSlices.reduce((s, x) => s + x.value, 0)} pickups / camionetas.
          </p>
          <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <DonutChart slices={pickupContractSlices} size={160} />
            <ul className="flex-1 space-y-2">
              {pickupContractSlices.map((slice) => (
                <li key={slice.label} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: slice.color }} />
                    <span className="font-medium text-slate-700 truncate max-w-[120px]" title={slice.label}>{slice.label}</span>
                  </span>
                  <span className="font-semibold text-slate-900">
                    {slice.value}
                    <span className="ml-1 text-xs font-normal text-slate-400">
                      ({percentage(slice.value, pickupContractSlices.reduce((s, x) => s + x.value, 0)).toFixed(0)}%)
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
    </section>
  )
}














