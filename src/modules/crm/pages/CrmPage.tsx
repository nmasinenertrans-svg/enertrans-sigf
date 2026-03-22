import { useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { CrmActivity, CrmActivityType, CrmDeal, CrmDealStage } from '../../../types/domain'

const stageOrder: Array<{ key: CrmDealStage; label: string; accent: string; badge: string }> = [
  { key: 'LEAD', label: 'Leads', accent: 'border-slate-300', badge: 'bg-slate-100 text-slate-700' },
  { key: 'CONTACTED', label: 'Contactado', accent: 'border-sky-300', badge: 'bg-sky-50 text-sky-700' },
  { key: 'QUALIFICATION', label: 'Calificado', accent: 'border-blue-300', badge: 'bg-blue-50 text-blue-700' },
  { key: 'PROPOSAL', label: 'Propuesta', accent: 'border-violet-300', badge: 'bg-violet-50 text-violet-700' },
  { key: 'NEGOTIATION', label: 'Negociacion', accent: 'border-amber-300', badge: 'bg-amber-50 text-amber-700' },
  { key: 'WON', label: 'Ganadas', accent: 'border-emerald-300', badge: 'bg-emerald-50 text-emerald-700' },
  { key: 'LOST', label: 'Perdidas', accent: 'border-rose-300', badge: 'bg-rose-50 text-rose-700' },
]

const activityTypeOptions: Array<{ value: CrmActivityType; label: string }> = [
  { value: 'CALL', label: 'Llamada' },
  { value: 'WHATSAPP', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
  { value: 'MEETING', label: 'Reunion' },
  { value: 'TASK', label: 'Tarea' },
]

type NewDealForm = {
  title: string
  companyName: string
  contactName: string
  contactEmail: string
  contactPhone: string
  source: string
  serviceLine: string
  amount: string
  currency: 'ARS' | 'USD'
  expectedCloseDate: string
  assignedToUserId: string
  notes: string
}

type ActivityDraft = {
  type: CrmActivityType
  summary: string
  dueAt: string
}

const emptyForm: NewDealForm = {
  title: '',
  companyName: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  source: '',
  serviceLine: '',
  amount: '',
  currency: 'ARS',
  expectedCloseDate: '',
  assignedToUserId: '',
  notes: '',
}

const emptyActivityDraft: ActivityDraft = {
  type: 'TASK',
  summary: '',
  dueAt: '',
}

const toDateLabel = (value?: string | null): string => {
  if (!value) {
    return 'Sin fecha'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Sin fecha'
  }
  return parsed.toLocaleDateString('es-AR')
}

const toDateTimeLabel = (value?: string | null): string => {
  if (!value) {
    return 'Sin actividad'
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'Sin actividad'
  }
  return parsed.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}

const formatMoney = (amount: number, currency: 'ARS' | 'USD') =>
  new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount || 0)

const getDealLastTouch = (deal: CrmDeal): number => {
  const fallback = deal.updatedAt ?? deal.createdAt ?? ''
  const source = deal.lastContactAt ?? fallback
  const parsed = new Date(source).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export const CrmPage = () => {
  const { can } = usePermissions()
  const {
    state: { users },
    actions: { setAppError },
  } = useAppContext()

  const [isLoading, setIsLoading] = useState(true)
  const [isSavingDeal, setIsSavingDeal] = useState(false)
  const [deals, setDeals] = useState<CrmDeal[]>([])
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [form, setForm] = useState<NewDealForm>(emptyForm)
  const [stageDraftByDeal, setStageDraftByDeal] = useState<Record<string, CrmDealStage>>({})
  const [activityDraftByDeal, setActivityDraftByDeal] = useState<Record<string, ActivityDraft>>({})
  const [search, setSearch] = useState('')

  const canCreate = can('CRM', 'create')
  const canEdit = can('CRM', 'edit')
  const canDelete = can('CRM', 'delete')

  const salesUsers = useMemo(
    () => users.filter((user) => ['DEV', 'GERENTE', 'COORDINADOR'].includes(user.role)),
    [users],
  )

  const loadCrm = async () => {
    try {
      const response = await apiRequest<{ deals: CrmDeal[]; activities: CrmActivity[] }>('/crm')
      setDeals(Array.isArray(response.deals) ? response.deals : [])
      setActivities(Array.isArray(response.activities) ? response.activities : [])
      setStageDraftByDeal(
        (Array.isArray(response.deals) ? response.deals : []).reduce<Record<string, CrmDealStage>>((acc, deal) => {
          acc[deal.id] = deal.stage
          return acc
        }, {}),
      )
    } catch {
      setAppError('No se pudo cargar el CRM comercial.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadCrm()
  }, [])

  const filteredDeals = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return deals
    }
    return deals.filter((deal) =>
      [deal.title, deal.companyName, deal.contactName, deal.serviceLine, deal.source].join(' ').toLowerCase().includes(query),
    )
  }, [deals, search])

  const activityByDeal = useMemo(() => {
    return activities.reduce<Record<string, CrmActivity[]>>((acc, activity) => {
      if (!acc[activity.dealId]) {
        acc[activity.dealId] = []
      }
      acc[activity.dealId].push(activity)
      return acc
    }, {})
  }, [activities])

  const kpis = useMemo(() => {
    const activeDeals = deals.filter((deal) => !['WON', 'LOST'].includes(deal.stage))
    const pipelineAmount = activeDeals.reduce((sum, deal) => sum + (deal.amount ?? 0), 0)
    const weightedForecast = activeDeals.reduce((sum, deal) => sum + (deal.amount ?? 0) * ((deal.probability ?? 0) / 100), 0)

    const now = new Date()
    const wonThisMonth = deals
      .filter((deal) => deal.stage === 'WON' && deal.wonAt)
      .filter((deal) => {
        const won = new Date(deal.wonAt as string)
        return won.getFullYear() === now.getFullYear() && won.getMonth() === now.getMonth()
      })
      .reduce((sum, deal) => sum + (deal.amount ?? 0), 0)

    const staleLimit = Date.now() - 1000 * 60 * 60 * 24 * 14
    const staleCount = activeDeals.filter((deal) => getDealLastTouch(deal) < staleLimit).length

    return { pipelineAmount, weightedForecast, wonThisMonth, staleCount }
  }, [deals])

  const handleCreateDeal = async () => {
    if (!canCreate) {
      return
    }
    if (!form.title.trim() || !form.companyName.trim()) {
      setAppError('Completá al menos titulo y empresa para crear la oportunidad.')
      return
    }

    setIsSavingDeal(true)
    try {
      const created = await apiRequest<CrmDeal>('/crm/deals', {
        method: 'POST',
        body: {
          ...form,
          amount: Number(form.amount || 0),
          expectedCloseDate: form.expectedCloseDate || undefined,
          assignedToUserId: form.assignedToUserId || null,
        },
      })
      setDeals((prev) => [created, ...prev])
      setStageDraftByDeal((prev) => ({ ...prev, [created.id]: created.stage }))
      setForm(emptyForm)
    } catch {
      setAppError('No se pudo crear la oportunidad comercial.')
    } finally {
      setIsSavingDeal(false)
    }
  }

  const handleStageChange = async (dealId: string) => {
    if (!canEdit) {
      return
    }
    const nextStage = stageDraftByDeal[dealId]
    if (!nextStage) {
      return
    }

    try {
      const updated = await apiRequest<CrmDeal>(`/crm/deals/${dealId}/stage`, {
        method: 'PATCH',
        body: { stage: nextStage },
      })
      setDeals((prev) => prev.map((deal) => (deal.id === dealId ? { ...deal, ...updated } : deal)))
    } catch {
      setAppError('No se pudo mover la oportunidad de etapa.')
    }
  }

  const handleAddActivity = async (dealId: string) => {
    if (!canEdit) {
      return
    }
    const draft = activityDraftByDeal[dealId] ?? emptyActivityDraft
    if (!draft.summary.trim()) {
      setAppError('Escribí un resumen para registrar la actividad.')
      return
    }

    try {
      const created = await apiRequest<CrmActivity>(`/crm/deals/${dealId}/activities`, {
        method: 'POST',
        body: {
          type: draft.type,
          summary: draft.summary,
          dueAt: draft.dueAt || undefined,
        },
      })
      setActivities((prev) => [created, ...prev])
      setActivityDraftByDeal((prev) => ({ ...prev, [dealId]: emptyActivityDraft }))
    } catch {
      setAppError('No se pudo registrar la actividad comercial.')
    }
  }

  const handleToggleActivity = async (activity: CrmActivity) => {
    if (!canEdit) {
      return
    }
    const nextStatus = activity.status === 'DONE' ? 'PENDING' : 'DONE'
    try {
      const updated = await apiRequest<CrmActivity>(`/crm/activities/${activity.id}`, {
        method: 'PATCH',
        body: { status: nextStatus },
      })
      setActivities((prev) => prev.map((item) => (item.id === activity.id ? updated : item)))
    } catch {
      setAppError('No se pudo actualizar el estado de la actividad.')
    }
  }

  const handleDeleteDeal = async (deal: CrmDeal) => {
    if (!canDelete) {
      return
    }
    const confirmed = window.confirm(`¿Eliminar oportunidad "${deal.title}" de ${deal.companyName}?`)
    if (!confirmed) {
      return
    }

    try {
      await apiRequest(`/crm/deals/${deal.id}`, { method: 'DELETE' })
      setDeals((prev) => prev.filter((item) => item.id !== deal.id))
      setActivities((prev) => prev.filter((item) => item.dealId !== deal.id))
    } catch {
      setAppError('No se pudo eliminar la oportunidad.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">CRM Comercial</h2>
        <p className="text-sm text-slate-600">Embudo de ventas, seguimiento de actividades y forecast de cierre.</p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Pipeline activo</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatMoney(kpis.pipelineAmount, 'ARS')}</p>
        </article>
        <article className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-500">Forecast ponderado</p>
          <p className="mt-2 text-2xl font-bold text-blue-900">{formatMoney(kpis.weightedForecast, 'ARS')}</p>
        </article>
        <article className="rounded-xl border border-emerald-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-500">Ganado este mes</p>
          <p className="mt-2 text-2xl font-bold text-emerald-900">{formatMoney(kpis.wonThisMonth, 'ARS')}</p>
        </article>
        <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-600">Oportunidades estancadas</p>
          <p className="mt-2 text-2xl font-bold text-amber-900">{kpis.staleCount}</p>
        </article>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">Nueva oportunidad</h3>
          <p className="text-sm text-slate-600">Carga comercial estandar para seguimiento de punta a punta.</p>
          <form
            className="mt-4 grid grid-cols-1 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleCreateDeal()
            }}
          >
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Titulo de oportunidad"
            />
            <input
              value={form.companyName}
              onChange={(event) => setForm((prev) => ({ ...prev, companyName: event.target.value }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Empresa"
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.contactName}
                onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Contacto"
              />
              <input
                value={form.contactPhone}
                onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Telefono"
              />
            </div>
            <input
              value={form.contactEmail}
              onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Email"
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.source}
                onChange={(event) => setForm((prev) => ({ ...prev, source: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Origen lead"
              />
              <input
                value={form.serviceLine}
                onChange={(event) => setForm((prev) => ({ ...prev, serviceLine: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Servicio"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.amount}
                type="number"
                min={0}
                onChange={(event) => setForm((prev) => ({ ...prev, amount: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Monto estimado"
              />
              <select
                value={form.currency}
                onChange={(event) => setForm((prev) => ({ ...prev, currency: event.target.value as 'ARS' | 'USD' }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="ARS">ARS</option>
                <option value="USD">USD</option>
              </select>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                type="date"
                value={form.expectedCloseDate}
                onChange={(event) => setForm((prev) => ({ ...prev, expectedCloseDate: event.target.value }))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <select
                value={form.assignedToUserId}
                onChange={(event) => setForm((prev) => ({ ...prev, assignedToUserId: event.target.value }))}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">Sin asignar</option>
                {salesUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.fullName}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="min-h-[90px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Contexto comercial"
            />
            <button
              type="submit"
              disabled={!canCreate || isSavingDeal}
              className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-60"
            >
              {isSavingDeal ? 'Guardando...' : 'Crear oportunidad'}
            </button>
          </form>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Pipeline comercial</h3>
              <p className="text-sm text-slate-600">Gestioná el avance de oportunidades y tareas de seguimiento.</p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              placeholder="Buscar oportunidad..."
            />
          </div>

          {isLoading ? (
            <div className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
              Cargando CRM...
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-3">
              {stageOrder.map((stage) => {
                const stageDeals = filteredDeals.filter((deal) => deal.stage === stage.key)
                return (
                  <section key={stage.key} className={`rounded-xl border ${stage.accent} bg-slate-50 p-3`}>
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-bold text-slate-900">{stage.label}</h4>
                      <span className={`rounded-full px-2 py-1 text-xs font-semibold ${stage.badge}`}>{stageDeals.length}</span>
                    </div>

                    <div className="space-y-3">
                      {stageDeals.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-xs text-slate-500">
                          Sin oportunidades.
                        </div>
                      ) : (
                        stageDeals.map((deal) => {
                          const dealActivities = (activityByDeal[deal.id] ?? []).slice(0, 3)
                          const draft = activityDraftByDeal[deal.id] ?? emptyActivityDraft
                          return (
                            <article key={deal.id} className="rounded-lg border border-slate-200 bg-white p-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">{deal.title}</p>
                                  <p className="text-xs font-semibold text-slate-600">{deal.companyName}</p>
                                  <p className="text-xs text-slate-500">{deal.contactName || 'Sin contacto'}</p>
                                </div>
                                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-700">
                                  {deal.probability}%
                                </span>
                              </div>

                              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600">
                                <span>{formatMoney(deal.amount, deal.currency)}</span>
                                <span className="text-right">Cierre: {toDateLabel(deal.expectedCloseDate)}</span>
                                <span className="col-span-2">Ult. contacto: {toDateTimeLabel(deal.lastContactAt)}</span>
                                <span className="col-span-2">
                                  Responsable: {deal.assignedToUser?.fullName ?? deal.createdByUser?.fullName ?? 'Sin asignar'}
                                </span>
                              </div>

                              <div className="mt-3 flex items-center gap-2">
                                <select
                                  value={stageDraftByDeal[deal.id] ?? deal.stage}
                                  onChange={(event) =>
                                    setStageDraftByDeal((prev) => ({
                                      ...prev,
                                      [deal.id]: event.target.value as CrmDealStage,
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                                >
                                  {stageOrder.map((option) => (
                                    <option key={option.key} value={option.key}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => void handleStageChange(deal.id)}
                                  disabled={!canEdit}
                                  className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                                >
                                  Mover
                                </button>
                              </div>

                              <div className="mt-3 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Actividades</p>
                                {dealActivities.length === 0 ? (
                                  <p className="text-xs text-slate-500">Sin actividades registradas.</p>
                                ) : (
                                  dealActivities.map((activity) => (
                                    <button
                                      key={activity.id}
                                      type="button"
                                      onClick={() => void handleToggleActivity(activity)}
                                      disabled={!canEdit}
                                      className={[
                                        'w-full rounded-md border px-2 py-1 text-left text-xs',
                                        activity.status === 'DONE'
                                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                          : 'border-amber-200 bg-amber-50 text-amber-800',
                                      ].join(' ')}
                                    >
                                      {activity.summary}
                                    </button>
                                  ))
                                )}
                              </div>

                              <div className="mt-2 space-y-2">
                                <select
                                  value={draft.type}
                                  onChange={(event) =>
                                    setActivityDraftByDeal((prev) => ({
                                      ...prev,
                                      [deal.id]: {
                                        ...(prev[deal.id] ?? emptyActivityDraft),
                                        type: event.target.value as CrmActivityType,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs"
                                >
                                  {activityTypeOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                <input
                                  value={draft.summary}
                                  onChange={(event) =>
                                    setActivityDraftByDeal((prev) => ({
                                      ...prev,
                                      [deal.id]: {
                                        ...(prev[deal.id] ?? emptyActivityDraft),
                                        summary: event.target.value,
                                      },
                                    }))
                                  }
                                  className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                  placeholder="Nueva actividad..."
                                />
                                <div className="flex items-center gap-2">
                                  <input
                                    type="date"
                                    value={draft.dueAt}
                                    onChange={(event) =>
                                      setActivityDraftByDeal((prev) => ({
                                        ...prev,
                                        [deal.id]: {
                                          ...(prev[deal.id] ?? emptyActivityDraft),
                                          dueAt: event.target.value,
                                        },
                                      }))
                                    }
                                    className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void handleAddActivity(deal.id)}
                                    disabled={!canEdit}
                                    className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                                  >
                                    +Act
                                  </button>
                                </div>
                              </div>

                              {canDelete ? (
                                <div className="mt-2 flex justify-end">
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteDeal(deal)}
                                    className="rounded-md border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-50"
                                  >
                                    Eliminar
                                  </button>
                                </div>
                              ) : null}
                            </article>
                          )
                        })
                      )}
                    </div>
                  </section>
                )
              })}
            </div>
          )}
        </article>
      </section>
    </section>
  )
}
