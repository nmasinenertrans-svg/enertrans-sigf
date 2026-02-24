import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import type { FleetMovement, FleetUnit } from '../../../types/domain'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

interface FleetMovementsPanelProps {
  unitId: string
  fleetUnits: FleetUnit[]
  movements: FleetMovement[]
}

export const FleetMovementsPanel = ({ unitId, fleetUnits, movements }: FleetMovementsPanelProps) => {
  const currentUnit = useMemo(() => fleetUnits.find((unit) => unit.id === unitId) ?? null, [fleetUnits, unitId])

  const unitMovements = useMemo(
    () => movements.filter((movement) => movement.unitIds.includes(unitId)),
    [movements, unitId],
  )

  return (
    <div className="space-y-5">
      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Historial de remitos</h3>
            <p className="mt-1 text-sm text-slate-600">
              En esta unidad solo se muestra el historial asociado. La carga y edicion se hace desde el modulo de
              Remitos.
            </p>
          </div>
          <Link
            to={ROUTE_PATHS.movements}
            className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-100"
          >
            Abrir modulo Remitos
          </Link>
        </div>

        {currentUnit ? (
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            Unidad actual: <span className="font-semibold text-slate-900">{currentUnit.internalCode}</span> -{' '}
            {currentUnit.ownerCompany}
          </div>
        ) : null}

        {unitMovements.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">Aun no hay remitos cargados para esta unidad.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Remito</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {unitMovements.map((movement) => (
                  <tr key={movement.id} className="border-t border-slate-200">
                    <td className="px-3 py-2">{movement.remitoDate || movement.createdAt?.slice(0, 10) || ''}</td>
                    <td className="px-3 py-2">{movement.remitoNumber || 'Sin numero'}</td>
                    <td className="px-3 py-2">{movement.clientName || 'Sin cliente'}</td>
                    <td className="px-3 py-2">{movement.movementType === 'ENTRY' ? 'Entrada' : 'Devolucion'}</td>
                    <td className="px-3 py-2">
                      {movement.pdfFileUrl ? (
                        <a
                          href={movement.pdfFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-amber-600 hover:underline"
                        >
                          Ver PDF
                        </a>
                      ) : (
                        'Sin adjunto'
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
