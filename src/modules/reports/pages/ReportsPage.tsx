import { useMemo, useState, type ReactNode } from 'react'
import { jsPDF } from 'jspdf'
import * as XLSX from 'xlsx'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import { getFleetUnitTypeLabel } from '../../fleet/services/fleetService'
import type { FleetUnit } from '../../../types/domain'

const formatDateTime = (value?: string) => {
  if (!value) {
    return ''
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('es-AR')
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

export const ReportsPage = () => {
  const {
    state: { audits, workOrders, repairs, fleetUnits, featureFlags },
  } = useAppContext()

  if (!featureFlags.showReportsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Reportes</h2>
        <p className="mt-2 text-sm text-slate-600">Este módulo está deshabilitado por configuración.</p>
      </section>
    )
  }

  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')

  const unitMap = useMemo(() => {
    const map = new Map<string, { domain: string; client: string; typeLabel: string }>()
    fleetUnits.forEach((unit) => {
      map.set(unit.id, {
        domain: unit.internalCode,
        client: unit.ownerCompany,
        typeLabel: getFleetUnitTypeLabel(unit.unitType),
      })
    })
    return map
  }, [fleetUnits])

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

  const rangeLabel = startDate || endDate ? `Periodo: ${startDate || 'Inicio'} → ${endDate || 'Hoy'}` : 'Periodo completo'

  const palette = ['#0ea5e9', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6', '#14b8a6', '#f97316', '#64748b']

  const occupancyByClient = useMemo(() => {
    const counts = new Map<string, { count: number; units: FleetUnit[] }>()
    fleetUnits.forEach((unit) => {
      const client = unit.clientName?.trim() || 'Sin asignar'
      const current = counts.get(client) ?? { count: 0, units: [] }
      current.count += 1
      current.units.push(unit)
      counts.set(client, current)
    })

    const sorted = Array.from(counts.entries()).sort((a, b) => b[1].count - a[1].count)
    const segments = sorted.map(([label, value], index) => ({
      label,
      value: value.count,
      color: palette[index % palette.length],
    }))

    return { segments, detail: sorted }
  }, [fleetUnits])

  const exportAuditsCsv = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'AU-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    downloadCsv('auditorias.csv', buildCsv(headers, rows))
  }

  const exportAuditsPdf = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'AU-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    const doc = buildPdf('Reporte de Auditorias', rangeLabel, headers, rows)
    doc.save('auditorias.pdf')
  }

  const exportAuditsXlsx = () => {
    const headers = ['Codigo', 'Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'Auditor', 'Resultado']
    const rows = filteredAudits.map((audit) => [
      audit.code ?? 'AU-LEGACY',
      formatDateTime(audit.performedAt),
      unitMap.get(audit.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(audit.unitId)?.client ?? 'Sin cliente',
      unitMap.get(audit.unitId)?.typeLabel ?? 'Sin tipo',
      audit.auditorName ?? '',
      audit.result,
    ])
    downloadXlsx('auditorias.xlsx', headers, rows)
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
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'OT', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      repair.workOrderId.slice(0, 8),
      repair.supplierName,
      repair.realCost,
      repair.invoicedToClient,
      repair.margin,
    ])
    downloadCsv('reparaciones.csv', buildCsv(headers, rows))
  }

  const exportRepairsPdf = () => {
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo', 'OT', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      repair.workOrderId.slice(0, 8),
      repair.supplierName,
      repair.realCost.toFixed(2),
      repair.invoicedToClient.toFixed(2),
      repair.margin.toFixed(2),
    ])
    const doc = buildPdf('Reporte de Reparaciones', rangeLabel, headers, rows)
    doc.save('reparaciones.pdf')
  }

  const exportRepairsXlsx = () => {
    const headers = ['Fecha', 'Dominio', 'Cliente', 'Tipo unidad', 'OT', 'Proveedor', 'Costo', 'Facturado', 'Margen']
    const rows = filteredRepairs.map((repair) => [
      formatDateTime(repair.createdAt),
      unitMap.get(repair.unitId)?.domain ?? 'Unidad no disponible',
      unitMap.get(repair.unitId)?.client ?? 'Sin cliente',
      unitMap.get(repair.unitId)?.typeLabel ?? 'Sin tipo',
      repair.workOrderId.slice(0, 8),
      repair.supplierName,
      repair.realCost,
      repair.invoicedToClient,
      repair.margin,
    ])
    downloadXlsx('reparaciones.xlsx', headers, rows)
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Reportes</h2>
        <p className="text-sm text-slate-600">Exportaciones en PDF y CSV para Auditorias, OT y Reparaciones.</p>
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-semibold text-slate-900">Ocupación por cliente</h3>
            <span className="text-xs text-slate-500">Unidades activas por cliente</span>
          </div>
          <div className="mt-4 grid gap-6 lg:grid-cols-[220px_1fr]">
            <div className="flex items-center justify-center">
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
            </div>
            <div className="grid gap-2">
              {occupancyByClient.segments.length === 0 ? (
                <p className="text-sm text-slate-500">No hay unidades activas.</p>
              ) : (
                occupancyByClient.segments.map((segment) => (
                  <div key={segment.label} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
                    <div className="flex items-center gap-2 text-sm text-slate-700">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: segment.color }} />
                      {segment.label}
                    </div>
                    <div className="text-sm font-semibold text-slate-900">{segment.value}</div>
                  </div>
                ))
              )}
            </div>
          </div>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-semibold text-slate-900">Unidades por cliente</h3>
          <div className="mt-4 space-y-3">
            {occupancyByClient.detail.length === 0 ? (
              <p className="text-sm text-slate-500">No hay unidades activas.</p>
            ) : (
              occupancyByClient.detail.map(([client, data]) => (
                <div key={client} className="rounded-lg border border-slate-200 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-slate-800">{client}</p>
                    <span className="text-sm font-semibold text-slate-900">{data.count}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    {data.units.map((unit) => unit.internalCode).join(', ') || 'Sin unidades'}
                  </p>
                </div>
              ))
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

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">Auditorias</h3>
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
