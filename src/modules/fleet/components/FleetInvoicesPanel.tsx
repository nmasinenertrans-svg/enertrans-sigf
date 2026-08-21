import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { Invoice, RepairRecord } from '../../../types/domain'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

interface FleetInvoicesPanelProps {
  unitId: string
  invoices: Invoice[]
  repairs: RepairRecord[]
}

const formatDate = (value?: string | null) => {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('es-AR')
}

const formatCurrency = (value: number, currency: 'ARS' | 'USD' = 'ARS') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

export const FleetInvoicesPanel = ({ unitId, invoices, repairs }: FleetInvoicesPanelProps) => {
  const repairIdsForUnit = useMemo(
    () => new Set(repairs.filter((repair) => repair.unitId === unitId).map((repair) => repair.id)),
    [repairs, unitId],
  )

  const unitInvoices = useMemo(
    () =>
      invoices
        .filter((invoice) => invoice.unitId === unitId || (invoice.repairId && repairIdsForUnit.has(invoice.repairId)))
        .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime()),
    [invoices, unitId, repairIdsForUnit],
  )

  return (
    <div className="space-y-5">
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Facturas de la unidad</h3>
            <p className="mt-1 text-sm text-slate-600">
              Incluye facturas vinculadas directamente a esta unidad y las de sus reparaciones. La carga se hace desde
              el módulo de Facturas.
            </p>
          </div>
          <Link
            to={ROUTE_PATHS.invoices}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            Abrir módulo Facturas
          </Link>
        </div>

        {unitInvoices.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Aún no hay facturas cargadas para esta unidad.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Factura</th>
                  <th className="px-3 py-2">Proveedor</th>
                  <th className="px-3 py-2">Monto</th>
                  <th className="px-3 py-2">Archivo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unitInvoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td className="px-3 py-2 text-slate-600">{formatDate(invoice.issuedAt)}</td>
                    <td className="px-3 py-2 font-semibold text-slate-900">{invoice.code}</td>
                    <td className="px-3 py-2 text-slate-700">{invoice.providerName}</td>
                    <td className="px-3 py-2 text-slate-700">{formatCurrency(invoice.amount, invoice.currency)}</td>
                    <td className="px-3 py-2">
                      {invoice.fileUrl ? (
                        <a
                          href={invoice.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-amber-700 hover:underline"
                        >
                          Ver
                        </a>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </div>
  )
}
