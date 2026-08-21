import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'

interface ParsedRow {
  rowNumber: number
  fechaRaw: string
  performedAtIso: string | null
  dominio: string
  unitId: string | null
  km: number | null
  tipo: string
  rubro: string
  trabajo: string
  observaciones: string
  proveedor: string
  costoRepuestos: number
  costoManoObra: number
  costoTotal: number
  moneda: 'ARS' | 'USD'
  errors: string[]
}

interface ImportOutcome {
  received: number
  imported: number
  failed: number
  errors: { index: number; message?: string }[]
}

const normalizeHeaderCell = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()

const findColumn = (header: unknown[], match: (normalized: string) => boolean): number =>
  header.findIndex((cell) => match(normalizeHeaderCell(cell)))

const parseMoneyLoose = (value: unknown): number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const raw = String(value ?? '').trim()
  if (!raw) return 0
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

const parseKmLoose = (value: unknown): number | null => {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const cleaned = raw.replace(/[^\d]/g, '')
  if (!cleaned) return null
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

const parseFechaToIso = (value: unknown): string | null => {
  const raw = String(value ?? '').trim()
  const match = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (!match) return null
  const [, dd, mm, yyyy] = match
  const day = Number(dd)
  const month = Number(mm)
  const year = Number(yyyy)
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day, 12))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const buildDescription = (row: { tipo: string; rubro: string; trabajo: string; observaciones: string }): string => {
  const parts: string[] = []
  if (row.tipo) parts.push(`[${row.tipo}]`)
  if (row.rubro) parts.push(row.rubro)
  if (row.trabajo) parts.push(row.trabajo)
  let description = parts.join(' - ').trim() || 'Reparacion importada'
  if (row.observaciones) description += ` (${row.observaciones})`
  return description
}

export const RepairImportPage = () => {
  const {
    state: { fleetUnits },
  } = useAppContext()

  const [fileName, setFileName] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [excludedRowNumbers, setExcludedRowNumbers] = useState<Set<number>>(new Set())
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null)
  const [importErrorRowNumbers, setImportErrorRowNumbers] = useState<Map<number, string>>(new Map())

  const unitIdByDominio = useMemo(() => {
    const map = new Map<string, string>()
    fleetUnits.forEach((unit) => map.set(unit.internalCode.trim().toUpperCase(), unit.id))
    return map
  }, [fleetUnits])

  const handleFile = async (file: File) => {
    setFileName(file.name)
    setParseError(null)
    setImportResult(null)
    setImportErrorRowNumbers(new Map())
    setRows([])
    setIsParsing(true)

    try {
      const XLSX = await import('xlsx')
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })

      let sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === 'historial_mantenimiento')
      let headerRowIndex = -1
      let headerRow: unknown[] = []
      let sheetRows: unknown[][] = []

      const tryFindHeader = (candidateSheetName: string): boolean => {
        const sheet = workbook.Sheets[candidateSheetName]
        const asRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false })
        for (let i = 0; i < Math.min(asRows.length, 10); i += 1) {
          const candidate = asRows[i] ?? []
          const hasFecha = candidate.some((cell) => normalizeHeaderCell(cell) === 'fecha')
          const hasDominio = candidate.some((cell) => normalizeHeaderCell(cell) === 'dominio')
          if (hasFecha && hasDominio) {
            headerRowIndex = i
            headerRow = candidate
            sheetRows = asRows
            return true
          }
        }
        return false
      }

      if (sheetName) {
        tryFindHeader(sheetName)
      }
      if (headerRowIndex === -1) {
        sheetName = workbook.SheetNames.find((name) => tryFindHeader(name))
      }

      if (!sheetName || headerRowIndex === -1) {
        setParseError(
          'No se encontró una hoja con columnas "Fecha" y "Dominio". ¿Es la hoja "Historial_Mantenimiento" del sistema Chantasoft?',
        )
        return
      }

      const col = {
        fecha: findColumn(headerRow, (h) => h === 'fecha'),
        dominio: findColumn(headerRow, (h) => h === 'dominio'),
        km: findColumn(headerRow, (h) => h === 'km'),
        tipo: findColumn(headerRow, (h) => h === 'tipo'),
        rubro: findColumn(headerRow, (h) => h === 'rubro'),
        trabajo: findColumn(headerRow, (h) => h.includes('trabajo')),
        proveedor: findColumn(headerRow, (h) => h.includes('proveedor') || h.includes('taller')),
        costoRepuestos: findColumn(headerRow, (h) => h.includes('repuesto')),
        costoManoObra: findColumn(headerRow, (h) => h.includes('mano de obra')),
        costoTotal: findColumn(
          headerRow,
          (h) => h.includes('costo total base') || (h.includes('costo total') && !h.includes('moneda') && !h.includes('usd')),
        ),
        observaciones: findColumn(headerRow, (h) => h.includes('observacion')),
        moneda: findColumn(headerRow, (h) => h === 'moneda'),
      }

      const get = (row: unknown[], index: number): unknown => (index >= 0 ? row[index] : null)

      const parsedRows: ParsedRow[] = []
      for (let i = headerRowIndex + 1; i < sheetRows.length; i += 1) {
        const raw = sheetRows[i] ?? []
        const fechaRaw = String(get(raw, col.fecha) ?? '').trim()
        const dominioRaw = String(get(raw, col.dominio) ?? '').trim()
        if (!fechaRaw && !dominioRaw) {
          continue
        }

        const dominio = dominioRaw.toUpperCase()
        const performedAtIso = parseFechaToIso(fechaRaw)
        const unitId = unitIdByDominio.get(dominio) ?? null
        const km = parseKmLoose(get(raw, col.km))
        const tipo = String(get(raw, col.tipo) ?? '').trim()
        const rubro = String(get(raw, col.rubro) ?? '').trim()
        const trabajo = String(get(raw, col.trabajo) ?? '').trim()
        const observaciones = String(get(raw, col.observaciones) ?? '').trim()
        const proveedor = String(get(raw, col.proveedor) ?? '').trim()
        const costoRepuestos = parseMoneyLoose(get(raw, col.costoRepuestos))
        const costoManoObra = parseMoneyLoose(get(raw, col.costoManoObra))
        const costoTotalRaw = parseMoneyLoose(get(raw, col.costoTotal))
        const costoTotal = costoTotalRaw > 0 ? costoTotalRaw : Number((costoRepuestos + costoManoObra).toFixed(2))
        const monedaRaw = String(get(raw, col.moneda) ?? '').trim().toUpperCase()
        const moneda: 'ARS' | 'USD' = monedaRaw === 'USD' ? 'USD' : 'ARS'

        const errors: string[] = []
        if (!dominio) errors.push('Falta la patente (Dominio).')
        else if (!unitId) errors.push(`Patente "${dominio}" no encontrada en el sistema.`)
        if (!performedAtIso) errors.push(`Fecha inválida: "${fechaRaw}".`)
        if (!proveedor) errors.push('Falta el proveedor/taller.')
        if (costoTotal <= 0) errors.push('El costo total debe ser mayor a cero.')

        parsedRows.push({
          rowNumber: i + 1,
          fechaRaw,
          performedAtIso,
          dominio,
          unitId,
          km,
          tipo,
          rubro,
          trabajo,
          observaciones,
          proveedor,
          costoRepuestos,
          costoManoObra,
          costoTotal,
          moneda,
          errors,
        })
      }

      setRows(parsedRows)
      setExcludedRowNumbers(new Set(parsedRows.filter((row) => row.errors.length > 0).map((row) => row.rowNumber)))
    } catch {
      setParseError('No se pudo leer el archivo. Verificá que sea un Excel válido (.xlsx).')
    } finally {
      setIsParsing(false)
    }
  }

  const toggleRow = (rowNumber: number) => {
    setExcludedRowNumbers((previous) => {
      const next = new Set(previous)
      if (next.has(rowNumber)) next.delete(rowNumber)
      else next.add(rowNumber)
      return next
    })
  }

  const includedRows = rows.filter((row) => row.errors.length === 0 && !excludedRowNumbers.has(row.rowNumber))
  const invalidCount = rows.filter((row) => row.errors.length > 0).length

  const handleImport = async () => {
    if (includedRows.length === 0) return
    setIsImporting(true)
    setImportResult(null)
    setImportErrorRowNumbers(new Map())

    try {
      const payload = includedRows.map((row) => ({
        unitId: row.unitId,
        supplierName: row.proveedor,
        performedAt: row.performedAtIso,
        unitKilometers: row.km ?? undefined,
        currency: row.moneda,
        description: buildDescription(row),
        laborCost: row.costoManoObra,
        partsCost: row.costoRepuestos,
        realCost: row.costoTotal,
      }))

      const result = await apiRequest<ImportOutcome>('/repairs/import', {
        method: 'POST',
        body: { items: payload },
      })
      setImportResult(result)

      const errorMap = new Map<number, string>()
      result.errors.forEach(({ index, message }) => {
        const row = includedRows[index]
        if (row) errorMap.set(row.rowNumber, message ?? 'Error desconocido.')
      })
      setImportErrorRowNumbers(errorMap)
    } catch {
      setParseError('No se pudo conectar con el servidor para importar. Intentá de nuevo.')
    } finally {
      setIsImporting(false)
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.repairs} label="Volver a Reparaciones" />
        <h2 className="text-2xl font-bold text-slate-900">Importar planilla de historial</h2>
        <p className="text-sm text-slate-600">
          Subí la hoja "Historial_Mantenimiento" (formato Chantasoft) para cargar reparaciones históricas: fecha,
          patente, proveedor y costos. El kilometraje actual de las unidades no se modifica con esta importación.
        </p>
      </header>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <label className="block text-sm font-semibold text-slate-700">Archivo Excel (.xlsx)</label>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="mt-2 block w-full text-sm text-slate-700"
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
        {fileName ? <p className="mt-2 text-xs text-slate-500">Archivo: {fileName}</p> : null}
        {isParsing ? <p className="mt-2 text-sm text-slate-500">Leyendo archivo...</p> : null}
        {parseError ? (
          <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {parseError}
          </p>
        ) : null}
      </article>

      {rows.length > 0 ? (
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-slate-900">Vista previa</h3>
              <p className="text-sm text-slate-600">
                {rows.length} filas con datos · {rows.length - invalidCount} válidas · {invalidCount} con error
              </p>
            </div>
            <button
              type="button"
              onClick={handleImport}
              disabled={includedRows.length === 0 || isImporting}
              className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
            >
              {isImporting ? 'Importando...' : `Importar ${includedRows.length} fila(s)`}
            </button>
          </div>

          {importResult ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              Recibidas: {importResult.received} · Importadas: {importResult.imported} · Fallidas: {importResult.failed}
            </div>
          ) : null}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-slate-50 uppercase text-slate-500">
                <tr>
                  <th className="px-2 py-2">Incluir</th>
                  <th className="px-2 py-2">Fila</th>
                  <th className="px-2 py-2">Fecha</th>
                  <th className="px-2 py-2">Patente</th>
                  <th className="px-2 py-2">Proveedor</th>
                  <th className="px-2 py-2">Km</th>
                  <th className="px-2 py-2">Costo</th>
                  <th className="px-2 py-2">Moneda</th>
                  <th className="px-2 py-2">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => {
                  const isExcluded = excludedRowNumbers.has(row.rowNumber)
                  const importErrorMessage = importErrorRowNumbers.get(row.rowNumber)
                  return (
                    <tr key={row.rowNumber} className={row.errors.length > 0 ? 'bg-rose-50/40' : undefined}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          checked={row.errors.length === 0 && !isExcluded}
                          disabled={row.errors.length > 0}
                          onChange={() => toggleRow(row.rowNumber)}
                        />
                      </td>
                      <td className="px-2 py-2 text-slate-500">{row.rowNumber}</td>
                      <td className="px-2 py-2">{row.fechaRaw}</td>
                      <td className="px-2 py-2 font-semibold">{row.dominio}</td>
                      <td className="px-2 py-2">{row.proveedor}</td>
                      <td className="px-2 py-2">{row.km ?? '—'}</td>
                      <td className="px-2 py-2">{row.costoTotal.toLocaleString('es-AR')}</td>
                      <td className="px-2 py-2">{row.moneda}</td>
                      <td className="px-2 py-2">
                        {importErrorMessage ? (
                          <span className="text-rose-700">Error: {importErrorMessage}</span>
                        ) : row.errors.length > 0 ? (
                          <span className="text-rose-600">{row.errors.join(' ')}</span>
                        ) : importResult ? (
                          <span className="text-emerald-700">Importada</span>
                        ) : (
                          <span className="text-slate-400">Lista</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </article>
      ) : null}
    </section>
  )
}
