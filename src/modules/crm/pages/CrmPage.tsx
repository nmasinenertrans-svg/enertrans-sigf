import { useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { CrmActivity, CrmDeal, CrmDealStage } from '../../../types/domain'

const STAGES: Array<{ key: CrmDealStage; label: string }> = [
  { key: 'LEAD', label: 'Leads' },
  { key: 'CONTACTED', label: 'Contactado' },
  { key: 'QUALIFICATION', label: 'Calificado' },
  { key: 'PROPOSAL', label: 'Propuesta' },
  { key: 'NEGOTIATION', label: 'Negociacion' },
  { key: 'WON', label: 'Ganadas' },
  { key: 'LOST', label: 'Perdidas' },
]

const EMPTY_FORM = { title: '', companyName: '', amount: '', currency: 'ARS' as 'ARS' | 'USD', assignedToUserId: '' }
const EMPTY_ACTIVITY = { summary: '' }

const money = (value: number, currency: 'ARS' | 'USD') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0)

const stale = (dateValue?: string | null) => {
  if (!dateValue) {
    return true
  }
  const date = new Date(dateValue)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return Date.now() - date.getTime() > 1000 * 60 * 60 * 24 * 14
}

const getActivitySortTime = (activity: CrmActivity) => {
  const value = activity.dueAt || activity.updatedAt || activity.createdAt
  const parsed = value ? new Date(value).getTime() : 0
  return Number.isNaN(parsed) ? 0 : parsed
}

export const CrmPage = () => {
  const { can } = usePermissions()
  const {
    state: { users },
    actions: { setAppError },
  } = useAppContext()

  const canCreate = can('CRM', 'create')
  const canEdit = can('CRM', 'edit')
  const canDelete = can('CRM', 'delete')

  const [deals, setDeals] = useState<CrmDeal[]>([])
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [stageDraft, setStageDraft] = useState<Record<string, CrmDealStage>>({})
  const [activityDraft, setActivityDraft] = useState<Record<string, { summary: string }>>({})
  const [isConvertingDealId, setIsConvertingDealId] = useState<string | null>(null)

  const salesUsers = useMemo(() => users.filter((u) => ['DEV', 'GERENTE', 'COORDINADOR'].includes(u.role)), [users])

  const load = async () => {
    try {
      const response = await apiRequest<{ deals: CrmDeal[]; activities: CrmActivity[] }>('/crm')
      const nextDeals = Array.isArray(response.deals) ? response.deals : []
      setDeals(nextDeals)
      setActivities(Array.isArray(response.activities) ? response.activities : [])
      setStageDraft(nextDeals.reduce<Record<string, CrmDealStage>>((acc, d) => ({ ...acc, [d.id]: d.stage }), {}))
    } catch {
      setAppError('No se pudo cargar CRM.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredDeals = useMemo(() => {
    const q = search.trim().toLowerCase()
    return deals.filter((deal) => {
      if (ownerFilter && (deal.assignedToUserId || '') !== ownerFilter) {
        return false
      }
      if (!q) {
        return true
      }
      return [deal.title, deal.companyName, deal.contactName, deal.source, deal.serviceLine].join(' ').toLowerCase().includes(q)
    })
  }, [deals, ownerFilter, search])

  const kpis = useMemo(() => {
    const openDeals = deals.filter((d) => d.stage !== 'WON' && d.stage !== 'LOST')
    const pipeline = openDeals.reduce((sum, d) => sum + (d.amount || 0), 0)
    const forecast = openDeals.reduce((sum, d) => sum + (d.amount || 0) * ((d.probability || 0) / 100), 0)
    const won = deals.filter((d) => d.stage === 'WON').length
    const lost = deals.filter((d) => d.stage === 'LOST').length
    const winRate = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0
    const staleCount = openDeals.filter((d) => stale(d.lastContactAt ?? d.updatedAt ?? d.createdAt)).length
    return { pipeline, forecast, winRate, staleCount }
  }, [deals])

  const createDeal = async () => {
    if (!canCreate) return
    if (!form.title.trim() || !form.companyName.trim()) {
      setAppError('Completá titulo y empresa.')
      return
    }
    setIsSaving(true)
    try {
      const created = await apiRequest<CrmDeal>('/crm/deals', {
        method: 'POST',
        body: {
          title: form.title,
          companyName: form.companyName,
          amount: Number(form.amount || 0),
          currency: form.currency,
          assignedToUserId: form.assignedToUserId || null,
        },
      })
      setDeals((prev) => [created, ...prev])
      setStageDraft((prev) => ({ ...prev, [created.id]: created.stage }))
      setForm(EMPTY_FORM)
    } catch {
      setAppError('No se pudo crear la oportunidad.')
    } finally {
      setIsSaving(false)
    }
  }

  const moveStage = async (dealId: string, nextStage: CrmDealStage) => {
    if (!canEdit) return
    const current = deals.find((d) => d.id === dealId)
    if (!current || current.stage === nextStage) return
    const prevDeals = deals
    setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, stage: nextStage } : d)))
    setStageDraft((prev) => ({ ...prev, [dealId]: nextStage }))
    try {
      const updated = await apiRequest<CrmDeal>(`/crm/deals/${dealId}/stage`, { method: 'PATCH', body: { stage: nextStage } })
      setDeals((prev) => prev.map((d) => (d.id === dealId ? { ...d, ...updated } : d)))
    } catch {
      setDeals(prevDeals)
      setStageDraft((prev) => ({ ...prev, [dealId]: current.stage }))
      setAppError('No se pudo mover la etapa.')
    }
  }

  const addActivity = async (dealId: string) => {
    if (!canEdit) return
    const summary = (activityDraft[dealId] ?? EMPTY_ACTIVITY).summary.trim()
    if (!summary) return
    try {
      const created = await apiRequest<CrmActivity>(`/crm/deals/${dealId}/activities`, {
        method: 'POST',
        body: { type: 'TASK', summary },
      })
      setActivities((prev) => [created, ...prev])
      setActivityDraft((prev) => ({ ...prev, [dealId]: EMPTY_ACTIVITY }))
    } catch {
      setAppError('No se pudo agregar la actividad.')
    }
  }

  const convertToClient = async (deal: CrmDeal) => {
    if (!canEdit) return
    setIsConvertingDealId(deal.id)
    try {
      const response = await apiRequest<{ deal: CrmDeal; client: { id: string; name: string }; createdClient: boolean }>(
        `/crm/deals/${deal.id}/convert-client`,
        { method: 'POST' },
      )
      setDeals((prev) => prev.map((d) => (d.id === deal.id ? response.deal : d)))
      setAppError(response.createdClient ? `Cliente creado: ${response.client.name}` : `Cliente vinculado: ${response.client.name}`)
    } catch {
      setAppError('No se pudo convertir a cliente.')
    } finally {
      setIsConvertingDealId(null)
    }
  }

  const removeDeal = async (deal: CrmDeal) => {
    if (!canDelete) return
    if (!window.confirm(`¿Eliminar oportunidad "${deal.title}"?`)) return
    try {
      await apiRequest(`/crm/deals/${deal.id}`, { method: 'DELETE' })
      setDeals((prev) => prev.filter((d) => d.id !== deal.id))
      setActivities((prev) => prev.filter((a) => a.dealId !== deal.id))
    } catch {
      setAppError('No se pudo eliminar la oportunidad.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">CRM Comercial</h2>
        <p className="text-sm text-slate-600">Pipeline con drag & drop, seguimiento y conversión directa a cliente.</p>
      </header>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Pipeline</p><p className="text-xl font-bold">{money(kpis.pipeline, 'ARS')}</p></article>
        <article className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm"><p className="text-xs text-blue-600">Forecast</p><p className="text-xl font-bold text-blue-900">{money(kpis.forecast, 'ARS')}</p></article>
        <article className="rounded-xl border border-violet-200 bg-white p-4 shadow-sm"><p className="text-xs text-violet-600">Win rate</p><p className="text-xl font-bold text-violet-900">{kpis.winRate}%</p></article>
        <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"><p className="text-xs text-amber-700">Estancadas</p><p className="text-xl font-bold text-amber-900">{kpis.staleCount}</p></article>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">Nueva oportunidad</h3>
          <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void createDeal() }}>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Titulo" value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Empresa" value={form.companyName} onChange={(e) => setForm((p) => ({ ...p, companyName: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2">
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={0} placeholder="Monto" value={form.amount} onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))} />
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.currency} onChange={(e) => setForm((p) => ({ ...p, currency: e.target.value as 'ARS' | 'USD' }))}>
                <option value="ARS">ARS</option><option value="USD">USD</option>
              </select>
            </div>
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={form.assignedToUserId} onChange={(e) => setForm((p) => ({ ...p, assignedToUserId: e.target.value }))}>
              <option value="">Sin asignar</option>
              {salesUsers.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
            </select>
            <button type="submit" disabled={isSaving || !canCreate} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-60">
              {isSaving ? 'Guardando...' : 'Crear oportunidad'}
            </button>
          </form>
        </article>

        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-bold text-slate-900">Pipeline</h3>
            <div className="flex gap-2">
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="">Todos</option>
                {salesUsers.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
              </select>
              <input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>

          {isLoading ? <div className="mt-4 text-sm text-slate-500">Cargando...</div> : (
            <div className="mt-4 grid grid-cols-1 gap-3 2xl:grid-cols-3">
              {STAGES.map((stage) => {
                const stageDeals = filteredDeals.filter((deal) => deal.stage === stage.key)
                return (
                  <section key={stage.key} className="rounded-xl border border-slate-200 bg-slate-50 p-3" onDragOver={(e) => { if (canEdit) e.preventDefault() }} onDrop={(e) => {
                    if (!canEdit) return
                    e.preventDefault()
                    const dealId = e.dataTransfer.getData('text/plain') || draggingDealId
                    if (dealId) void moveStage(dealId, stage.key)
                    setDraggingDealId(null)
                  }}>
                    <div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-bold">{stage.label}</h4><span className="rounded-full bg-white px-2 py-1 text-xs">{stageDeals.length}</span></div>
                    <div className="space-y-2">
                      {stageDeals.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-2 text-xs text-slate-500">Sin oportunidades</div> : stageDeals.map((deal) => {
                        const dealActs = (activities.filter((a) => a.dealId === deal.id).slice().sort((a, b) => getActivitySortTime(b) - getActivitySortTime(a))).slice(0, 2)
                        const canConvert = deal.stage === 'WON' && !deal.convertedClientId
                        return (
                          <article key={deal.id} draggable={canEdit} onDragStart={(e) => { if (!canEdit) return; e.dataTransfer.setData('text/plain', deal.id); setDraggingDealId(deal.id) }} onDragEnd={() => setDraggingDealId(null)} className="rounded-lg border border-slate-200 bg-white p-3">
                            <p className="text-sm font-bold text-slate-900">{deal.title}</p>
                            <p className="text-xs font-semibold text-slate-600">{deal.companyName}</p>
                            <p className="mt-1 text-xs text-slate-500">{money(deal.amount, deal.currency)} · {deal.probability}%</p>
                            <p className="text-xs text-slate-500">Responsable: {deal.assignedToUser?.fullName ?? deal.createdByUser?.fullName ?? 'Sin asignar'}</p>
                            {stale(deal.lastContactAt ?? deal.updatedAt ?? deal.createdAt) && deal.stage !== 'WON' && deal.stage !== 'LOST' ? <p className="mt-1 text-[11px] font-semibold text-amber-700">Sin contacto reciente</p> : null}
                            {deal.convertedClient ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">Cliente: {deal.convertedClient.name}</p> : null}
                            <div className="mt-2 flex gap-2">
                              <select value={stageDraft[deal.id] ?? deal.stage} onChange={(e) => setStageDraft((p) => ({ ...p, [deal.id]: e.target.value as CrmDealStage }))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
                                {STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                              </select>
                              <button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold" disabled={!canEdit} onClick={() => void moveStage(deal.id, stageDraft[deal.id] ?? deal.stage)}>Mover</button>
                            </div>
                            {canConvert ? <button type="button" className="mt-2 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60" disabled={isConvertingDealId === deal.id} onClick={() => void convertToClient(deal)}>{isConvertingDealId === deal.id ? 'Convirtiendo...' : 'Convertir a cliente'}</button> : null}
                            <div className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50 p-2">
                              {dealActs.length === 0 ? <p className="text-xs text-slate-500">Sin actividades</p> : dealActs.map((act) => <button type="button" key={act.id} className={['w-full rounded-md border px-2 py-1 text-left text-xs', act.status === 'DONE' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-800'].join(' ')} onClick={() => canEdit && void apiRequest<CrmActivity>(`/crm/activities/${act.id}`, { method: 'PATCH', body: { status: act.status === 'DONE' ? 'PENDING' : 'DONE' } }).then((updated) => setActivities((prev) => prev.map((a) => a.id === updated.id ? updated : a))).catch(() => setAppError('No se pudo actualizar actividad.'))}>{act.summary}</button>)}
                            </div>
                            <div className="mt-2 flex gap-2">
                              <input value={(activityDraft[deal.id] ?? EMPTY_ACTIVITY).summary} onChange={(e) => setActivityDraft((p) => ({ ...p, [deal.id]: { summary: e.target.value } }))} className="w-full rounded-lg border border-slate-300 px-2 py-1 text-xs" placeholder="Nueva actividad..." />
                              <button type="button" className="rounded-lg bg-slate-900 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50" disabled={!canEdit} onClick={() => void addActivity(deal.id)}>+Act</button>
                            </div>
                            {canDelete ? <button type="button" className="mt-2 w-full rounded-lg border border-rose-300 bg-white px-2 py-1 text-xs font-semibold text-rose-700" onClick={() => void removeDeal(deal)}>Eliminar</button> : null}
                          </article>
                        )
                      })}
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
