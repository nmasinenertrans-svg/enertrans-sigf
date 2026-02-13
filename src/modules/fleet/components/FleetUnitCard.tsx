import { Link } from 'react-router-dom'
import type { FleetUnit } from '../../../types/domain'
import { buildFleetDetailPath, buildFleetEditPath } from '../../../core/routing/routePaths'
import { getFleetUnitTypeLabel, getOperationalStatusLabel } from '../services/fleetService'

interface FleetUnitCardProps {
  unit: FleetUnit
  onRequestDelete: (unit: FleetUnit) => void
  canEdit: boolean
  canDelete: boolean
}

export const FleetUnitCard = ({ unit, onRequestDelete, canEdit, canDelete }: FleetUnitCardProps) => (
  <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Unidad</p>
        <h3 className="mt-1 text-base font-bold text-slate-900">{unit.internalCode}</h3>
      </div>
      <span
        className={`rounded-full border px-2 py-1 text-xs font-semibold ${operationalStatusClassMap[unit.operationalStatus]}`}
      >
        {getOperationalStatusLabel(unit.operationalStatus)}
      </span>
    </div>

    <dl className="mt-4 grid grid-cols-1 gap-2 text-sm text-slate-600">
      <div className="flex justify-between gap-3">
        <dt>Tipo</dt>
        <dd className="font-semibold text-slate-800">{getFleetUnitTypeLabel(unit.unitType)}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Empresa</dt>
        <dd className="font-semibold text-slate-800">{unit.ownerCompany}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Chasis</dt>
        <dd className="font-semibold text-slate-800">{unit.chassisNumber}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Motor</dt>
        <dd className="font-semibold text-slate-800">{unit.engineNumber}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Hidrogrua</dt>
        <dd className="font-semibold text-slate-800">{unit.hasHydroCrane ? 'Si' : 'No'}</dd>
      </div>
      <div className="flex justify-between gap-3">
        <dt>Semirremolque</dt>
        <dd className="font-semibold text-slate-800">{unit.hasSemiTrailer ? 'Si' : 'No'}</dd>
      </div>
    </dl>

    <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
      {(['rto', 'insurance', 'hoist'] as const).map((docKey) => {
        const labelMap = { rto: 'RTO', insurance: 'Seguro', hoist: 'Izaje' }
        const status = getDocumentStatus(unit.documents?.[docKey]?.expiresAt)
        const statusClass = documentStatusClassMap[status]
        return (
          <span
            key={docKey}
            className={`rounded-full border px-2 py-1 ${statusClass}`}
          >
            {labelMap[docKey]}
          </span>
        )
      })}
    </div>

    <div className="mt-5 flex flex-wrap gap-2">
      <Link
        to={buildFleetDetailPath(unit.id)}
        className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
      >
        Ver detalle
      </Link>
      {canEdit ? (
        <Link
          to={buildFleetEditPath(unit.id)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
        >
          Editar
        </Link>
      ) : null}
      {canDelete ? (
        <button
          type="button"
          onClick={() => onRequestDelete(unit)}
          className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
        >
          Eliminar
        </button>
      ) : null}
    </div>
  </article>
)

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

const documentStatusClassMap: Record<'overdue' | 'soon' | 'ok' | 'missing', string> = {
  overdue: 'border-rose-300 bg-rose-50 text-rose-700',
  soon: 'border-amber-300 bg-amber-50 text-amber-700',
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  missing: 'border-slate-200 bg-slate-100 text-slate-600',
}

const operationalStatusClassMap: Record<FleetUnit['operationalStatus'], string> = {
  OPERATIONAL: 'border-emerald-300 bg-emerald-50 text-emerald-700',
  MAINTENANCE: 'border-amber-300 bg-amber-50 text-amber-700',
  OUT_OF_SERVICE: 'border-rose-300 bg-rose-50 text-rose-700',
}
