import type { AuditChecklistStatus } from '../../../types/domain'
import { statusLabelMap } from '../services/auditsService'
import type { AuditChecklistSectionDraft } from '../types'

interface AuditChecklistEditorProps {
  sections: AuditChecklistSectionDraft[]
  onItemStatusChange: (sectionId: string, itemId: string, status: AuditChecklistStatus) => void
  onItemObservationChange: (sectionId: string, itemId: string, observation: string) => void
  readOnly?: boolean
}

const checklistStatusOptions: AuditChecklistStatus[] = ['OK', 'BAD', 'NA']

const statusButtonStyleMap: Record<AuditChecklistStatus, string> = {
  OK: 'border-emerald-300 text-emerald-700 hover:bg-emerald-50 data-[active=true]:bg-emerald-500 data-[active=true]:text-white data-[active=true]:border-emerald-500',
  BAD: 'border-rose-300 text-rose-700 hover:bg-rose-50 data-[active=true]:bg-rose-500 data-[active=true]:text-white data-[active=true]:border-rose-500',
  NA: 'border-slate-300 text-slate-700 hover:bg-slate-100 data-[active=true]:bg-slate-700 data-[active=true]:text-white data-[active=true]:border-slate-700',
}

export const AuditChecklistEditor = ({
  sections,
  onItemStatusChange,
  onItemObservationChange,
  readOnly = false,
}: AuditChecklistEditorProps) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="space-y-4">
      {sections.map((section, sectionIndex) => (
        <article key={section.id} className="overflow-hidden rounded-lg border border-slate-300">
          <div className="border-b border-slate-300 bg-amber-50 px-4 py-2 text-xs font-bold uppercase tracking-wide text-slate-700">
            {sectionIndex + 1}. {section.title}
          </div>

          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div className="grid grid-cols-[minmax(260px,1fr)_80px_80px_80px_1fr] items-center gap-2 border-b border-slate-300 bg-slate-100 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-slate-600">
                <span>Item</span>
                <span className="text-center">OK</span>
                <span className="text-center">MAL</span>
                <span className="text-center">N/A</span>
                <span>Observaciones</span>
              </div>

              {section.items.map((item, itemIndex) => (
                <div
                  key={item.id}
                  className={[
                    'grid grid-cols-[minmax(260px,1fr)_80px_80px_80px_1fr] items-center gap-2 border-b border-slate-200 px-4 py-2',
                    itemIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/70',
                  ].join(' ')}
                >
                  <div className="text-sm text-slate-800">
                    <span className="mr-2 text-xs font-semibold text-slate-500">{itemIndex + 1}.</span>
                    {item.label}
                  </div>

                  {checklistStatusOptions.map((status) => (
                    <button
                      key={status}
                      type="button"
                      disabled={readOnly}
                      onClick={() => onItemStatusChange(section.id, item.id, status)}
                      data-active={item.status === status}
                      className={[
                        'mx-auto w-16 rounded border px-2 py-1 text-[11px] font-semibold transition-colors',
                        statusButtonStyleMap[status],
                        readOnly ? 'cursor-default opacity-60 hover:bg-transparent' : '',
                      ].join(' ')}
                    >
                      {statusLabelMap[status]}
                    </button>
                  ))}

                  <input
                    className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-amber-400"
                    value={item.observation}
                    onChange={(event) => onItemObservationChange(section.id, item.id, event.target.value)}
                    placeholder="Observación"
                    readOnly={readOnly}
                  />
                </div>
              ))}
            </div>
          </div>
        </article>
      ))}
    </div>
  </section>
)
