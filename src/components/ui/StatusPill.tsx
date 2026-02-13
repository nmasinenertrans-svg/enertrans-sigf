import type { VisualStatus } from '../../types/domain'

interface StatusPillProps {
  status: VisualStatus
}

const statusLabelMap: Record<VisualStatus, string> = {
  OVERDUE: 'Vencido',
  OK: 'OK',
  DUE_SOON: 'Por vencer',
}

const statusClassMap: Record<VisualStatus, string> = {
  OVERDUE: 'border-rose-300 bg-rose-50 text-rose-700',
  OK: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  DUE_SOON: 'border-amber-300 bg-amber-50 text-amber-700',
}

export const StatusPill = ({ status }: StatusPillProps) => (
  <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClassMap[status]}`}>
    {statusLabelMap[status]}
  </span>
)
