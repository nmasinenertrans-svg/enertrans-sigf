interface RepairCostCardProps {
  totalRepairs: number
  totalsByCurrency: Record<
    'ARS' | 'USD',
    {
      repairs: number
      realCost: number
      invoiced: number
      margin: number
    }
  >
}

const CurrencySummaryCard = ({
  currency,
  repairs,
  realCost,
  invoiced,
  margin,
}: {
  currency: 'ARS' | 'USD'
  repairs: number
  realCost: number
  invoiced: number
  margin: number
}) => {
  const formatter = new Intl.NumberFormat(currency === 'USD' ? 'en-US' : 'es-AR', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Totales {currency}</p>
      <p className="mt-2 text-sm font-semibold text-slate-700">Reparaciones: {repairs}</p>
      <p className="mt-1 text-sm text-slate-700">Costo real: {formatter.format(realCost)}</p>
      <p className="mt-1 text-sm text-slate-700">Facturado: {formatter.format(invoiced)}</p>
      <p className={`mt-1 text-sm font-semibold ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
        Margen: {formatter.format(margin)}
      </p>
    </article>
  )
}

export const RepairCostCard = ({ totalRepairs, totalsByCurrency }: RepairCostCardProps) => (
  <div className="grid gap-3 md:grid-cols-3">
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total reparaciones</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{totalRepairs}</p>
      <p className="mt-1 text-xs text-slate-500">Resumen separado por moneda</p>
    </article>
    <CurrencySummaryCard currency="ARS" {...totalsByCurrency.ARS} />
    <CurrencySummaryCard currency="USD" {...totalsByCurrency.USD} />
  </div>
)
