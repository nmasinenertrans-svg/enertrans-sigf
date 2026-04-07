import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import { apiRequest } from '../../../services/api/apiClient'
import { getFleetUnitTypeLabel, normalizeFleetUnits } from '../../fleet/services/fleetService'
import type { ExternalRequest, FleetUnit, RepairRecord, TaskRecord, WorkOrder } from '../../../types/domain'

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

type OccupancyPdfSection = {
  key: string
  title: string
  totalUnits: number
  hydroCount: number | null
  rows: Array<{
    label: string
    count: number
    share: number
  }>
  segments: OccupancyPdfSegment[]
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

const drawWrappedText = (doc: jsPDF, text: string, x: number, y: number, maxWidth: number, lineHeight = 12) => {
  const lines = doc.splitTextToSize(text, maxWidth)
  doc.text(lines, x, y)
  return lines.length * lineHeight
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

const normalizeOccupancyClientLabel = (value: string) => {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return 'Sin asignar'
  }
  return normalized.toUpperCase()
}

const createOccupancySection = (
  key: string,
  title: string,
  units: FleetUnit[],
  includeHydroCount = false,
): OccupancyPdfSection | null => {
  if (!units.length) {
    return null
  }

  const clientMap = new Map<string, { label: string; count: number }>()
  units.forEach((unit) => {
    const label = normalizeOccupancyClientLabel(unit.clientName ?? '')
    const current = clientMap.get(label) ?? { label, count: 0 }
    current.count += 1
    clientMap.set(label, current)
  })

  const totalUnits = units.length
  const rows = Array.from(clientMap.values())
    .map((entry) => ({
      label: entry.label,
      count: entry.count,
      share: percentage(entry.count, totalUnits),
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))

  const segments = rows.map((entry, index) => ({
    label: entry.label,
    value: entry.count,
    share: entry.share,
    color: palette[index % palette.length],
  }))

  return {
    key,
    title,
    totalUnits,
    hydroCount: includeHydroCount ? units.filter((unit) => unit.hasHydroCrane).length : null,
    rows,
    segments,
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
  const [showAllClients, setShowAllClients] = useState(false)
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({})

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

  const occupancyByClient = useMemo(() => {
    const normalizeClient = (value: string) => value.replace(/\s+/g, ' ').trim().toUpperCase()
    const map = new Map<string, { label: string; count: number; unitCodes: string[] }>()

    reportFleetUnits.forEach((unit) => {
      const rawClient = unit.clientName?.trim() || 'Sin asignar'
      const normalized = normalizeClient(rawClient)
      const key = normalized || 'SIN ASIGNAR'
      const current = map.get(key) ?? {
        label: key === 'SIN ASIGNAR' ? 'Sin asignar' : normalized,
        count: 0,
        unitCodes: [],
      }
      current.count += 1
      current.unitCodes.push(unit.internalCode)
      map.set(key, current)
    })

    const detail = Array.from(map.values())
      .map((entry) => ({
        ...entry,
        unitCodes: Array.from(new Set(entry.unitCodes)).sort((a, b) => a.localeCompare(b)),
      }))
      .sort((a, b) => b.count - a.count)

    const topLimit = 8
    const top = detail.slice(0, topLimit)
    const remainder = detail.slice(topLimit)
    const remainderCount = remainder.reduce((accumulator, item) => accumulator + item.count, 0)
    const totalUnits = detail.reduce((accumulator, item) => accumulator + item.count, 0)

    const segments = top.map((entry, index) => ({
      label: entry.label,
      value: entry.count,
      color: palette[index % palette.length],
    }))

    if (remainderCount > 0) {
      segments.push({
        label: `Otros (${remainder.length})`,
        value: remainderCount,
        color: '#64748b',
      })
    }

    const segmentsWithShare = segments.map((segment) => ({
      ...segment,
      share: percentage(segment.value, totalUnits),
    }))

    const detailWithShare = detail.map((entry) => ({
      ...entry,
      share: percentage(entry.count, totalUnits),
    }))

    return {
      segments: segmentsWithShare,
      detail: detailWithShare,
      totalUnits,
      totalClients: detail.length,
      unassignedUnits: detail.find((item) => item.label === 'Sin asignar')?.count ?? 0,
    }
  }, [fleetUnits])

  const visibleClientRows = useMemo(
    () => (showAllClients ? occupancyByClient.detail : occupancyByClient.detail.slice(0, 10)),
    [occupancyByClient.detail, showAllClients],
  )

  const occupancyPdfSections = useMemo(() => {
    const sections = [
      createOccupancySection(
        'pickup',
        'CAMIONETAS - PICKUP',
        reportFleetUnits.filter((unit) => unit.unitType === 'PICKUP'),
      ),
      createOccupancySection(
        'chassis',
        'CAMIONES - CHASIS',
        reportFleetUnits.filter((unit) => unit.unitType === 'CHASSIS' || unit.unitType === 'CHASSIS_WITH_HYDROCRANE'),
        true,
      ),
      createOccupancySection(
        'tractors',
        'CAMIONES - TRACTORES',
        reportFleetUnits.filter((unit) => unit.unitType === 'TRACTOR' || unit.unitType === 'TRACTOR_WITH_HYDROCRANE'),
        true,
      ),
      createOccupancySection(
        'semi-trailers',
        'SEMIRREMOLQUES',
        reportFleetUnits.filter((unit) => unit.unitType === 'SEMI_TRAILER'),
      ),
    ].filter(Boolean) as OccupancyPdfSection[]

    const coveredTypes = new Set<FleetUnit['unitType']>([
      'PICKUP',
      'CHASSIS',
      'CHASSIS_WITH_HYDROCRANE',
      'TRACTOR',
      'TRACTOR_WITH_HYDROCRANE',
      'SEMI_TRAILER',
    ])

    const remainingTypes = Array.from(new Set<FleetUnit['unitType']>(reportFleetUnits.map((unit) => unit.unitType))).filter(
      (unitType) => !coveredTypes.has(unitType),
    )

    remainingTypes.forEach((unitType) => {
      const title = getFleetUnitTypeLabel(unitType).toUpperCase()
      const section = createOccupancySection(
        unitType.toLowerCase(),
        title,
        reportFleetUnits.filter((unit) => unit.unitType === unitType),
      )
      if (section) {
        sections.push(section)
      }
    })

    return sections
  }, [reportFleetUnits])

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
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' })
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const margin = 32
    const blockGap = 18
    let cursorY = 36

    const ensureSpace = (neededHeight: number) => {
      if (cursorY + neededHeight <= pageHeight - 36) {
        return
      }
      doc.addPage()
      cursorY = 36
    }

    doc.setFillColor('#000000')
    doc.rect(margin, cursorY, pageWidth - margin * 2, 26, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(15)
    doc.setTextColor('#facc15')
    doc.text('REPORTE DE OCUPACION DE FLOTA', pageWidth / 2, cursorY + 17, { align: 'center' })
    cursorY += 40

    doc.setTextColor('#475569')
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(`Emitido: ${new Date().toLocaleString('es-AR')}`, margin, cursorY)
    cursorY += 14
    doc.text(`Total de unidades: ${occupancyByClient.totalUnits} | Clientes: ${occupancyByClient.totalClients}`, margin, cursorY)
    cursorY += 20

    occupancyPdfSections.forEach((section) => {
      const chartImage = buildOccupancyPieChart(section.segments)
      const tableX = margin
      const tableWidth = 290
      const chartX = tableX + tableWidth + 16
      const chartSize = 180
      const headerHeight = 22
      const rowHeight = 18
      const tableBodyRows = Math.max(section.rows.length, 1)
      const tableHeight = headerHeight + rowHeight * (tableBodyRows + 2)
      const blockHeight = Math.max(tableHeight, chartSize) + 42

      ensureSpace(blockHeight)

      doc.setFillColor('#000000')
      doc.rect(margin, cursorY, pageWidth - margin * 2, 24, 'F')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(13)
      doc.setTextColor('#facc15')
      doc.text(section.title, pageWidth / 2, cursorY + 16, { align: 'center' })
      cursorY += 34

      if (section.hydroCount !== null) {
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(9)
        doc.setTextColor('#166534')
        doc.text(`CON HIDROGRUA: ${section.hydroCount}`, tableX, cursorY)
        cursorY += 14
      }

      const tableTop = cursorY
      doc.setDrawColor('#1f2937')
      doc.setFillColor('#000000')
      doc.rect(tableX, tableTop, tableWidth, headerHeight, 'FD')
      doc.setTextColor('#22c55e')
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.text('Etiquetas de fila', tableX + 8, tableTop + 14)
      doc.text('Cantidad', tableX + 170, tableTop + 14)
      doc.text('Porcentaje', tableX + 230, tableTop + 14)

      let rowY = tableTop + headerHeight
      doc.setTextColor('#111827')
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)

      section.rows.forEach((row) => {
        doc.setFillColor('#ffffff')
        doc.rect(tableX, rowY, tableWidth, rowHeight, 'FD')
        doc.text(row.label, tableX + 8, rowY + 12)
        doc.text(String(row.count), tableX + 185, rowY + 12, { align: 'right' })
        doc.text(`${row.share.toFixed(1)}%`, tableX + 280, rowY + 12, { align: 'right' })
        rowY += rowHeight
      })

      doc.setFillColor('#22c55e')
      doc.rect(tableX, rowY, tableWidth, rowHeight, 'FD')
      doc.setTextColor('#ffffff')
      doc.setFont('helvetica', 'bold')
      doc.text('Total general', tableX + 8, rowY + 12)
      doc.text(String(section.totalUnits), tableX + 185, rowY + 12, { align: 'right' })
      doc.text('100%', tableX + 280, rowY + 12, { align: 'right' })

      if (chartImage) {
        doc.setDrawColor('#cbd5e1')
        doc.setFillColor('#ffffff')
        doc.roundedRect(chartX, tableTop, chartSize, chartSize, 8, 8, 'FD')
        doc.addImage(chartImage, 'PNG', chartX + 8, tableTop + 8, chartSize - 16, chartSize - 16)
      } else {
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(9)
        doc.setTextColor('#64748b')
        drawWrappedText(doc, 'No se pudo generar el grafico.', chartX + 12, tableTop + 20, chartSize - 24)
      }

      cursorY = Math.max(rowY + rowHeight, tableTop + chartSize) + blockGap
    })

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
              <h3 className="text-lg font-semibold text-slate-900">Ocupacion por cliente</h3>
              <p className="text-xs text-slate-500">Distribucion de unidades activas (top 8 + otros)</p>
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
                Clientes: {occupancyByClient.totalClients}
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-700">
                Sin asignar: {occupancyByClient.unassignedUnits}
              </span>
            </div>
          </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[220px_1fr]">
            <div className="relative flex items-center justify-center">
              <svg width={200} height={200} viewBox="0 0 200 200">
                <g transform="translate(100,100)">
                  <circle r={70} fill="transparent" stroke="#e2e8f0" strokeWidth={18} />
                  {occupancyByClient.segments.reduce<{ dashOffset: number; elements: ReactNode[] }>(
                    (acc, segment, index) => {
                      const total = occupancyByClient.segments.reduce((sum, item) => sum + item.value, 0) || 1
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
                <p className="text-2xl font-bold text-slate-900">{occupancyByClient.totalUnits}</p>
              </div>
            </div>
            <div className="space-y-2">
              {occupancyByClient.segments.map((segment) => (
                <div key={segment.label} className="rounded-lg border border-slate-200 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <div className="flex items-center gap-2 font-semibold text-slate-800">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <span className="text-xs font-semibold text-slate-600">{segment.value} ({segment.share.toFixed(1)}%)</span>
                  </div>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, segment.share))}%`, backgroundColor: segment.color }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Unidades por cliente</h3>
            {occupancyByClient.detail.length > 10 ? (
              <button
                type="button"
                onClick={() => setShowAllClients((previous) => !previous)}
                className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
              >
                {showAllClients ? 'Ver menos' : 'Ver todos'}
              </button>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            {visibleClientRows.length === 0 ? (
              <p className="text-sm text-slate-500">No hay unidades activas.</p>
            ) : (
              visibleClientRows.map((entry) => {
                const isExpanded = Boolean(expandedClients[entry.label])
                const visibleCodes = isExpanded ? entry.unitCodes : entry.unitCodes.slice(0, 6)
                const hiddenCount = Math.max(0, entry.unitCodes.length - visibleCodes.length)
                return (
                  <div key={entry.label} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">{entry.label}</p>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                        {entry.count} ({entry.share.toFixed(1)}%)
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {visibleCodes.map((code) => (
                        <span key={`${entry.label}-${code}`} className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                          {code}
                        </span>
                      ))}
                      {hiddenCount > 0 ? (
                        <span className="rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">+{hiddenCount} mas</span>
                      ) : null}
                    </div>
                    {entry.unitCodes.length > 6 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedClients((previous) => ({ ...previous, [entry.label]: !isExpanded }))}
                        className="mt-2 text-[11px] font-semibold text-amber-700 hover:text-amber-800"
                      >
                        {isExpanded ? 'Ocultar patentes' : 'Ver todas las patentes'}
                      </button>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
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
    </section>
  )
}






