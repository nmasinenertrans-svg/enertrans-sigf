import type { AuditHistoryViewItem } from '../types'

interface AuditHistoryListProps {
  items: AuditHistoryViewItem[]
  onViewAudit: (auditId: string) => void
  onExportPdf: (auditId: string) => void
  onRequestDelete: (auditId: string) => void
  canDelete?: boolean
}

export const AuditHistoryList = ({ items, onViewAudit, onExportPdf, onRequestDelete, canDelete = true }: AuditHistoryListProps) => {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        No hay auditorías registradas para la unidad seleccionada.
      </div>
    )
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <article key={item.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Unidad</p>
              <h4 className="mt-1 text-base font-bold text-slate-900">{item.unitLabel}</h4>
              <p className="text-xs font-semibold text-slate-500">{item.code}</p>
              <p className="text-sm text-slate-600">{new Date(item.performedAt).toLocaleString()}</p>
            </div>
            <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${item.resultClassName}`}>{item.resultLabel}</span>
          </div>

          <p className="mt-3 text-sm text-slate-700">
            <span className="font-semibold">Auditor:</span> {item.auditorName}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">Observaciones:</span> {item.observations || 'Sin observaciones.'}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">KM motor:</span> {item.unitKilometers ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">Horas motor:</span> {item.engineHours ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">Horas hidrogrua:</span> {item.hydroHours ?? 0}
          </p>
          <p className="mt-1 text-sm text-slate-700">
            <span className="font-semibold">Fotos:</span> {item.photoCount}
          </p>

          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
            Secciones: {item.sections.length}
          </div>

          {item.syncState && item.syncState !== 'SYNCED' ? (
            <div
              className={`mt-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                item.syncState === 'ERROR'
                  ? 'border-rose-300 bg-rose-50 text-rose-700'
                  : item.syncState === 'LOCAL_ONLY'
                    ? 'border-amber-300 bg-amber-50 text-amber-700'
                    : 'border-sky-300 bg-sky-50 text-sky-700'
              }`}
            >
              {item.syncState === 'PENDING'
                ? 'Pendiente de sincronizacion (solo visible hasta confirmar servidor).'
                : item.syncState === 'LOCAL_ONLY'
                  ? 'Guardada solo en este dispositivo (sincronizacion pendiente).'
                  : `Error de sincronizacion${item.syncError ? `: ${item.syncError}` : '.'}`}
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => onViewAudit(item.id)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100"
            >
              Ver inspeccion
            </button>
            <button
              type="button"
              onClick={() => onExportPdf(item.id)}
              className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700"
            >
              Generar PDF
            </button>
            {canDelete ? (
              <button
                type="button"
                onClick={() => onRequestDelete(item.id)}
                className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100"
              >
                Eliminar
              </button>
            ) : null}
          </div>
        </article>
      ))}
    </div>
  )
}


