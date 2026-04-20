import { useCallback, useEffect, useMemo, useState } from 'react'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { ApiRequestError, apiRequest } from '../../../services/api/apiClient'

const getApiErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof ApiRequestError) {
    try {
      const parsed = JSON.parse(error.responseBody) as { message?: string }
      if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message
    } catch {
      if (typeof error.responseBody === 'string' && error.responseBody.trim()) return error.responseBody
    }
  }
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
import type { CrmActivity, CrmActivityType, CrmDeal, CrmDealKind, CrmDealStage, CrmDealUnitStatus } from '../../../types/domain'

const STAGES: Array<{ key: CrmDealStage; label: string }> = [
  { key: 'LEAD', label: 'Lead' }, { key: 'CONTACTED', label: 'Contactado' }, { key: 'QUALIFICATION', label: 'Calificado' },
  { key: 'PROPOSAL', label: 'Propuesta' }, { key: 'NEGOTIATION', label: 'Negociacion' }, { key: 'WON', label: 'Ganada' }, { key: 'LOST', label: 'Perdida' },
]
const ACTIVITY_TYPES: Array<{ key: CrmActivityType; label: string }> = [
  { key: 'CALL', label: 'Llamada' }, { key: 'WHATSAPP', label: 'WhatsApp' }, { key: 'EMAIL', label: 'Email' }, { key: 'MEETING', label: 'Reunion' }, { key: 'TASK', label: 'Tarea' },
]
const DEAL_KINDS: Array<{ key: CrmDealKind; label: string }> = [
  { key: 'TENDER', label: 'Concurso' }, { key: 'CONTRACT', label: 'Contrato' },
]
const LINK_STATUSES: Array<{ key: CrmDealUnitStatus; label: string }> = [
  { key: 'EN_CONCURSO', label: 'En concurso' }, { key: 'ADJUDICADA', label: 'Adjudicada' }, { key: 'PERDIDA', label: 'Perdida' }, { key: 'LIBERADA', label: 'Liberada' },
]

type DealForm = { title: string; companyName: string; dealKind: CrmDealKind; referenceCode: string; isHistorical: boolean; contactName: string; contactEmail: string; contactPhone: string; source: string; serviceLine: string; amount: string; currency: 'ARS' | 'USD'; probability: string; stage: CrmDealStage; expectedCloseDate: string; assignedToUserId: string; notes: string; lostReason: string }
type ActivityForm = { type: CrmActivityType; summary: string; dueAt: string }
type UnitSearch = { id: string; internalCode: string; ownerCompany: string; clientName: string; linkedStatusInCurrentDeal?: CrmDealUnitStatus | null; blockedBy?: { dealId: string; dealTitle: string; dealKind: CrmDealKind; companyName: string; stage: CrmDealStage; status: CrmDealUnitStatus } | null }

const EMPTY_DEAL: DealForm = { title: '', companyName: '', dealKind: 'TENDER', referenceCode: '', isHistorical: false, contactName: '', contactEmail: '', contactPhone: '', source: '', serviceLine: '', amount: '', currency: 'ARS', probability: '', stage: 'LEAD', expectedCloseDate: '', assignedToUserId: '', notes: '', lostReason: '' }
const EMPTY_ACTIVITY: ActivityForm = { type: 'TASK', summary: '', dueAt: '' }

const asDateInput = (value?: string | null) => (value ? new Date(value).toISOString().slice(0, 10) : '')
const money = (value: number, currency: 'ARS' | 'USD') => new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value || 0)
const sortTime = (item: CrmActivity) => new Date(item.dueAt || item.updatedAt || item.createdAt || 0).getTime() || 0
const stale = (value?: string | null) => {
  if (!value) return true
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) || Date.now() - ts > 1000 * 60 * 60 * 24 * 14
}
const overdue = (activity: CrmActivity) => activity.status === 'PENDING' && Boolean(activity.dueAt) && new Date(activity.dueAt as string).getTime() < Date.now()
const trim = (v: string) => v.trim()
const num = (v: string, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const toForm = (deal: CrmDeal): DealForm => ({ title: deal.title || '', companyName: deal.companyName || '', dealKind: deal.dealKind || 'TENDER', referenceCode: deal.referenceCode || '', isHistorical: !!deal.isHistorical, contactName: deal.contactName || '', contactEmail: deal.contactEmail || '', contactPhone: deal.contactPhone || '', source: deal.source || '', serviceLine: deal.serviceLine || '', amount: String(deal.amount || 0), currency: deal.currency || 'ARS', probability: String(deal.probability || 0), stage: deal.stage, expectedCloseDate: asDateInput(deal.expectedCloseDate), assignedToUserId: deal.assignedToUserId || '', notes: deal.notes || '', lostReason: deal.lostReason || '' })

export const CrmPage = () => {
  const { can } = usePermissions()
  const { state: { users }, actions: { setAppError } } = useAppContext()
  const canCreate = can('CRM', 'create')
  const canEdit = can('CRM', 'edit')
  const canDelete = can('CRM', 'delete')
  const salesUsers = useMemo(() => users.filter((u) => ['DEV', 'GERENTE', 'COORDINADOR'].includes(u.role)), [users])

  const [deals, setDeals] = useState<CrmDeal[]>([])
  const [activities, setActivities] = useState<CrmActivity[]>([])
  const [selectedDealId, setSelectedDealId] = useState('')
  const [search, setSearch] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('')
  const [draggingDealId, setDraggingDealId] = useState<string | null>(null)
  const [stageDraft, setStageDraft] = useState<Record<string, CrmDealStage>>({})
  const [createForm, setCreateForm] = useState<DealForm>(EMPTY_DEAL)
  const [editForm, setEditForm] = useState<DealForm>(EMPTY_DEAL)
  const [activityForm, setActivityForm] = useState<ActivityForm>(EMPTY_ACTIVITY)
  const [confirmDelete, setConfirmDelete] = useState<CrmDeal | null>(null)
  const [unitQuery, setUnitQuery] = useState('')
  const [unitStatus, setUnitStatus] = useState<CrmDealUnitStatus>('EN_CONCURSO')
  const [unitNote, setUnitNote] = useState('')
  const [unitResults, setUnitResults] = useState<UnitSearch[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateSaving, setIsCreateSaving] = useState(false)
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [isActivitySaving, setIsActivitySaving] = useState(false)
  const [isConvertingId, setIsConvertingId] = useState<string | null>(null)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)
  const [isSearchingUnit, setIsSearchingUnit] = useState(false)
  const [isAutomationRunning, setIsAutomationRunning] = useState(false)
  const [automationStatus, setAutomationStatus] = useState('')

  const loadCrm = useCallback(async (withLoader = false) => {
    if (withLoader) setIsLoading(true)
    try {
      const data = await apiRequest<{ deals: CrmDeal[]; activities: CrmActivity[] }>('/crm')
      const nextDeals = Array.isArray(data.deals) ? data.deals : []
      setDeals(nextDeals)
      setActivities(Array.isArray(data.activities) ? data.activities : [])
      setStageDraft(nextDeals.reduce<Record<string, CrmDealStage>>((acc, deal) => { acc[deal.id] = deal.stage; return acc }, {}))
      setSelectedDealId((prev) => (prev && nextDeals.some((deal) => deal.id === prev) ? prev : nextDeals[0]?.id || ''))
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo cargar CRM.'))
    } finally {
      if (withLoader) setIsLoading(false)
    }
  }, [setAppError])

  useEffect(() => { void loadCrm(true) }, [loadCrm])

  const filteredDeals = useMemo(() => {
    const q = search.toLowerCase().trim()
    return deals.filter((deal) => {
      if (ownerFilter && (deal.assignedToUserId || '') !== ownerFilter) return false
      if (!q) return true
      return [deal.title, deal.companyName, deal.referenceCode, deal.contactName, deal.source, deal.serviceLine].join(' ').toLowerCase().includes(q)
    })
  }, [deals, ownerFilter, search])

  useEffect(() => {
    if (!filteredDeals.length) { setSelectedDealId(''); return }
    if (!selectedDealId || !filteredDeals.some((deal) => deal.id === selectedDealId)) setSelectedDealId(filteredDeals[0].id)
  }, [filteredDeals, selectedDealId])

  const selectedDeal = useMemo(() => deals.find((deal) => deal.id === selectedDealId) ?? null, [deals, selectedDealId])
  useEffect(() => { setEditForm(selectedDeal ? toForm(selectedDeal) : EMPTY_DEAL) }, [selectedDeal])
  const selectedActivities = useMemo(() => activities.filter((a) => a.dealId === selectedDealId).sort((a, b) => sortTime(b) - sortTime(a)), [activities, selectedDealId])

  const kpis = useMemo(() => {
    const open = deals.filter((deal) => deal.stage !== 'WON' && deal.stage !== 'LOST')
    const won = deals.filter((deal) => deal.stage === 'WON').length
    const lost = deals.filter((deal) => deal.stage === 'LOST').length
    return {
      pipelineArs: open.filter((deal) => deal.currency === 'ARS').reduce((sum, deal) => sum + (deal.amount || 0), 0),
      pipelineUsd: open.filter((deal) => deal.currency === 'USD').reduce((sum, deal) => sum + (deal.amount || 0), 0),
      winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
      pendingActivities: activities.filter((activity) => activity.status === 'PENDING').length,
      overdueActivities: activities.filter((activity) => overdue(activity)).length,
      staleDeals: open.filter((deal) => stale(deal.lastContactAt ?? deal.updatedAt ?? deal.createdAt)).length,
    }
  }, [activities, deals])

  const payload = (form: DealForm) => ({ title: trim(form.title), companyName: trim(form.companyName), dealKind: form.dealKind, referenceCode: trim(form.referenceCode), isHistorical: form.isHistorical, contactName: trim(form.contactName), contactEmail: trim(form.contactEmail), contactPhone: trim(form.contactPhone), source: trim(form.source), serviceLine: trim(form.serviceLine), amount: num(form.amount), currency: form.currency, probability: form.probability.trim() ? num(form.probability) : undefined, stage: form.stage, expectedCloseDate: form.expectedCloseDate ? new Date(`${form.expectedCloseDate}T00:00:00.000Z`).toISOString() : undefined, assignedToUserId: salesUsers.some((u) => u.id === form.assignedToUserId) ? form.assignedToUserId : null, notes: trim(form.notes), lostReason: form.stage === 'LOST' ? trim(form.lostReason) : '' })

  const createDeal = async () => {
    if (!canCreate) return
    if (!trim(createForm.title) || !trim(createForm.companyName)) { setAppError('Completa titulo y empresa.'); return }
    setIsCreateSaving(true)
    try {
      const created = await apiRequest<CrmDeal>('/crm/deals', { method: 'POST', body: payload(createForm) })
      setDeals((prev) => [created, ...prev]); setStageDraft((prev) => ({ ...prev, [created.id]: created.stage })); setCreateForm(EMPTY_DEAL); setSelectedDealId(created.id)
    } catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo crear la oportunidad.')) } finally { setIsCreateSaving(false) }
  }
  const saveDeal = async () => {
    if (!canEdit || !selectedDeal) return
    setIsEditSaving(true)
    try {
      const updated = await apiRequest<CrmDeal>(`/crm/deals/${selectedDeal.id}`, { method: 'PATCH', body: payload(editForm) })
      setDeals((prev) => prev.map((deal) => deal.id === updated.id ? updated : deal)); setStageDraft((prev) => ({ ...prev, [updated.id]: updated.stage })); void loadCrm(false)
    } catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo actualizar la oportunidad.')) } finally { setIsEditSaving(false) }
  }
  const moveStage = async (dealId: string, stage: CrmDealStage) => {
    if (!canEdit) return
    const current = deals.find((deal) => deal.id === dealId); if (!current || current.stage === stage) return
    const prev = deals
    setDeals((list) => list.map((deal) => deal.id === dealId ? { ...deal, stage } : deal)); setStageDraft((map) => ({ ...map, [dealId]: stage }))
    try {
      const reason = selectedDeal?.id === dealId && stage === 'LOST' ? trim(editForm.lostReason) : ''
      const updated = await apiRequest<CrmDeal>(`/crm/deals/${dealId}/stage`, { method: 'PATCH', body: { stage, lostReason: reason } })
      setDeals((list) => list.map((deal) => deal.id === dealId ? updated : deal)); void loadCrm(false)
    } catch (error) { setDeals(prev); setStageDraft((map) => ({ ...map, [dealId]: current.stage })); setAppError(getApiErrorMessage(error, 'No se pudo mover la etapa.')) }
  }
  const convertDeal = async (deal: CrmDeal) => {
    if (!canEdit) return
    setIsConvertingId(deal.id)
    try { const res = await apiRequest<{ deal: CrmDeal }>(`/crm/deals/${deal.id}/convert-client`, { method: 'POST' }); setDeals((list) => list.map((item) => item.id === deal.id ? res.deal : item)); void loadCrm(false) }
    catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo convertir a cliente.')) } finally { setIsConvertingId(null) }
  }
  const addActivity = async () => {
    if (!canEdit || !selectedDeal) return
    if (!trim(activityForm.summary)) { setAppError('Completa el resumen de actividad.'); return }
    setIsActivitySaving(true)
    try {
      const created = await apiRequest<CrmActivity>(`/crm/deals/${selectedDeal.id}/activities`, { method: 'POST', body: { type: activityForm.type, summary: trim(activityForm.summary), dueAt: activityForm.dueAt ? new Date(`${activityForm.dueAt}T00:00:00.000Z`).toISOString() : undefined } })
      setActivities((prev) => [created, ...prev]); setActivityForm(EMPTY_ACTIVITY)
    } catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo registrar la actividad.')) } finally { setIsActivitySaving(false) }
  }
  const toggleActivity = async (activity: CrmActivity) => {
    if (!canEdit) return
    try { const updated = await apiRequest<CrmActivity>(`/crm/activities/${activity.id}`, { method: 'PATCH', body: { status: activity.status === 'DONE' ? 'PENDING' : 'DONE' } }); setActivities((list) => list.map((item) => item.id === updated.id ? updated : item)) }
    catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo actualizar la actividad.')) }
  }
  const deleteDeal = async () => {
    if (!confirmDelete || !canDelete) return
    setIsDeletingId(confirmDelete.id)
    try { await apiRequest(`/crm/deals/${confirmDelete.id}`, { method: 'DELETE' }); setDeals((list) => list.filter((item) => item.id !== confirmDelete.id)); setActivities((list) => list.filter((item) => item.dealId !== confirmDelete.id)); setConfirmDelete(null) }
    catch (error) { setAppError(getApiErrorMessage(error, 'No se pudo eliminar la oportunidad.')) } finally { setIsDeletingId(null) }
  }

  const searchUnits = async () => {
    if (!selectedDeal) return
    setIsSearchingUnit(true)
    try {
      const data = await apiRequest<UnitSearch[]>(`/crm/deals/${selectedDeal.id}/units/search?q=${encodeURIComponent(trim(unitQuery))}`)
      setUnitResults(Array.isArray(data) ? data : [])
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudieron buscar unidades.'))
    } finally {
      setIsSearchingUnit(false)
    }
  }

  const linkUnit = async (unitId: string) => {
    if (!selectedDeal || !canEdit) return
    try {
      await apiRequest(`/crm/deals/${selectedDeal.id}/units`, { method: 'POST', body: { unitId, status: unitStatus, notes: trim(unitNote) } })
      setUnitNote('')
      await searchUnits()
      await loadCrm(false)
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo vincular la unidad.'))
    }
  }

  const updateLink = async (linkId: string, status: CrmDealUnitStatus) => {
    if (!selectedDeal || !canEdit) return
    try {
      await apiRequest(`/crm/deals/${selectedDeal.id}/units/${linkId}`, { method: 'PATCH', body: { status } })
      await searchUnits()
      await loadCrm(false)
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo actualizar la unidad.'))
    }
  }

  const unlinkUnit = async (linkId: string) => {
    if (!selectedDeal || !canEdit) return
    try {
      await apiRequest(`/crm/deals/${selectedDeal.id}/units/${linkId}`, { method: 'DELETE' })
      await searchUnits()
      await loadCrm(false)
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo desvincular la unidad.'))
    }
  }

  const runAutomations = async () => {
    if (!canEdit) return
    setIsAutomationRunning(true)
    setAutomationStatus('')
    try {
      const result = await apiRequest<{ generated: number; scannedDeals: number; scannedActivities: number; skippedBecauseRunning: boolean; }>('/crm/automations/run', { method: 'POST' })
      if (result.skippedBecauseRunning) {
        setAutomationStatus('Automatizacion en curso. Reintenta en unos segundos.')
        return
      }
      setAutomationStatus(`Automatizacion ejecutada: ${result.generated} alertas (${result.scannedDeals} oportunidades / ${result.scannedActivities} actividades).`)
      await loadCrm(false)
    } catch (error) {
      setAppError(getApiErrorMessage(error, 'No se pudo ejecutar automatizaciones CRM.'))
    } finally {
      setIsAutomationRunning(false)
    }
  }

  return (
    <section className="space-y-5">
      <header><BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" /><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-2xl font-bold text-slate-900">CRM Comercial</h2><p className="text-sm text-slate-600">Pipeline completo con concursos/contratos, unidades vinculadas, carga historica manual y seguimiento de actividades.</p></div><button type="button" onClick={() => void runAutomations()} disabled={!canEdit || isAutomationRunning} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60">{isAutomationRunning ? 'Ejecutando...' : 'Ejecutar automatizaciones'}</button></div>{automationStatus ? <p className="mt-2 text-xs font-semibold text-emerald-700">{automationStatus}</p> : null}</header>
      <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Pipeline ARS</p><p className="text-xl font-bold">{money(kpis.pipelineArs, 'ARS')}</p></article>
        <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><p className="text-xs text-slate-500">Pipeline USD</p><p className="text-xl font-bold">{money(kpis.pipelineUsd, 'USD')}</p></article>
        <article className="rounded-xl border border-blue-200 bg-white p-4 shadow-sm"><p className="text-xs text-blue-600">Win rate</p><p className="text-xl font-bold text-blue-900">{kpis.winRate}%</p></article>
        <article className="rounded-xl border border-amber-200 bg-white p-4 shadow-sm"><p className="text-xs text-amber-700">Pendientes / Vencidas</p><p className="text-xl font-bold text-amber-900">{kpis.pendingActivities} / {kpis.overdueActivities}</p></article>
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-4">
          <h3 className="text-lg font-bold text-slate-900">Nueva oportunidad</h3>
          <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void createDeal() }}>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Titulo" value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Empresa" value={createForm.companyName} onChange={(e) => setCreateForm((p) => ({ ...p, companyName: e.target.value }))} />
            <div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={createForm.dealKind} onChange={(e) => setCreateForm((p) => ({ ...p, dealKind: e.target.value as CrmDealKind }))}>{DEAL_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo / referencia" value={createForm.referenceCode} onChange={(e) => setCreateForm((p) => ({ ...p, referenceCode: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Origen" value={createForm.source} onChange={(e) => setCreateForm((p) => ({ ...p, source: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Servicio" value={createForm.serviceLine} onChange={(e) => setCreateForm((p) => ({ ...p, serviceLine: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Contacto" value={createForm.contactName} onChange={(e) => setCreateForm((p) => ({ ...p, contactName: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Telefono" value={createForm.contactPhone} onChange={(e) => setCreateForm((p) => ({ ...p, contactPhone: e.target.value }))} /></div>
            <div className="grid grid-cols-3 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" placeholder="Monto" value={createForm.amount} onChange={(e) => setCreateForm((p) => ({ ...p, amount: e.target.value }))} /><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={createForm.currency} onChange={(e) => setCreateForm((p) => ({ ...p, currency: e.target.value as 'ARS' | 'USD' }))}><option value="ARS">ARS</option><option value="USD">USD</option></select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={0} max={100} placeholder="Prob %" value={createForm.probability} onChange={(e) => setCreateForm((p) => ({ ...p, probability: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={createForm.stage} onChange={(e) => setCreateForm((p) => ({ ...p, stage: e.target.value as CrmDealStage }))}>{STAGES.map((stage) => <option key={stage.key} value={stage.key}>{stage.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={createForm.expectedCloseDate} onChange={(e) => setCreateForm((p) => ({ ...p, expectedCloseDate: e.target.value }))} /></div>
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={createForm.assignedToUserId} onChange={(e) => setCreateForm((p) => ({ ...p, assignedToUserId: e.target.value }))}><option value="">Sin asignar</option>{salesUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select>
            {createForm.stage === 'LOST' ? <textarea className="min-h-[64px] rounded-lg border border-rose-300 px-3 py-2 text-sm" placeholder="Motivo de perdida" value={createForm.lostReason} onChange={(e) => setCreateForm((p) => ({ ...p, lostReason: e.target.value }))} /> : null}
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={createForm.isHistorical} onChange={(e) => setCreateForm((p) => ({ ...p, isHistorical: e.target.checked }))} /> Carga historica</label>
            <button type="submit" disabled={isCreateSaving || !canCreate} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-60">{isCreateSaving ? 'Guardando...' : 'Crear oportunidad'}</button>
          </form>
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-8">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold text-slate-900">Pipeline</h3><div className="flex flex-wrap gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}><option value="">Todos</option>{salesUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
          <div className="mt-2 text-xs text-slate-500">Estancadas: {kpis.staleDeals}</div>
          {isLoading ? <div className="mt-4 text-sm text-slate-500">Cargando CRM...</div> : <div className="mt-4 overflow-x-auto"><div className="flex min-w-max gap-3">{STAGES.map((stage) => { const stageDeals = filteredDeals.filter((d) => d.stage === stage.key); return <section key={stage.key} className="w-[290px] rounded-xl border border-slate-200 bg-slate-50 p-3" onDragOver={(e) => { if (canEdit) e.preventDefault() }} onDrop={(e) => { if (!canEdit) return; e.preventDefault(); const id = e.dataTransfer.getData('text/plain') || draggingDealId; if (id) void moveStage(id, stage.key); setDraggingDealId(null) }}><div className="mb-2 flex items-center justify-between"><h4 className="text-sm font-bold">{stage.label}</h4><span className="rounded-full bg-white px-2 py-1 text-xs">{stageDeals.length}</span></div><div className="space-y-2">{stageDeals.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-white p-2 text-xs text-slate-500">Sin oportunidades</div> : stageDeals.map((deal) => <article key={deal.id} draggable={canEdit} onDragStart={(e) => { if (!canEdit) return; e.dataTransfer.setData('text/plain', deal.id); setDraggingDealId(deal.id) }} onDragEnd={() => setDraggingDealId(null)} onClick={() => setSelectedDealId(deal.id)} className={['rounded-lg border bg-white p-3', deal.id === selectedDealId ? 'border-amber-400' : 'border-slate-200'].join(' ')}><p className="text-sm font-bold text-slate-900">{deal.title}</p><p className="text-xs font-semibold text-slate-600">{deal.companyName}</p><p className="mt-1 text-[11px] text-slate-500">{deal.dealKind === 'CONTRACT' ? 'Contrato' : 'Concurso'}{deal.referenceCode ? ` | ${deal.referenceCode}` : ''}{deal.isHistorical ? ' | Historico' : ''}</p><p className="mt-1 text-xs text-slate-500">{money(deal.amount, deal.currency)} | {deal.probability}% | Unidades: {deal.unitLinks?.length ?? 0}</p>{stale(deal.lastContactAt ?? deal.updatedAt ?? deal.createdAt) && deal.stage !== 'WON' && deal.stage !== 'LOST' ? <p className="text-[11px] font-semibold text-amber-700">Sin contacto reciente</p> : null}<div className="mt-2 flex gap-2" onClick={(e) => e.stopPropagation()}><select value={stageDraft[deal.id] ?? deal.stage} onChange={(e) => setStageDraft((p) => ({ ...p, [deal.id]: e.target.value as CrmDealStage }))} className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><button type="button" className="rounded-lg border border-slate-300 px-2 py-1 text-xs font-semibold" disabled={!canEdit} onClick={() => void moveStage(deal.id, stageDraft[deal.id] ?? deal.stage)}>Mover</button></div>{deal.stage === 'WON' && !deal.convertedClientId ? <button type="button" className="mt-2 w-full rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 disabled:opacity-60" disabled={isConvertingId === deal.id || !canEdit} onClick={(e) => { e.stopPropagation(); void convertDeal(deal) }}>{isConvertingId === deal.id ? 'Convirtiendo...' : 'Convertir a cliente'}</button> : null}</article>)}</div></section> })}</div></div>}
        </article>
      </section>
      <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-6">
          <h3 className="text-lg font-bold text-slate-900">Detalle de oportunidad</h3>
          {!selectedDeal ? <p className="mt-3 text-sm text-slate-500">Selecciona una oportunidad.</p> : <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void saveDeal() }}><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Titulo" value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Empresa" value={editForm.companyName} onChange={(e) => setEditForm((p) => ({ ...p, companyName: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={editForm.dealKind} onChange={(e) => setEditForm((p) => ({ ...p, dealKind: e.target.value as CrmDealKind }))}>{DEAL_KINDS.map((kind) => <option key={kind.key} value={kind.key}>{kind.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo / referencia" value={editForm.referenceCode} onChange={(e) => setEditForm((p) => ({ ...p, referenceCode: e.target.value }))} /></div><div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Contacto" value={editForm.contactName} onChange={(e) => setEditForm((p) => ({ ...p, contactName: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Telefono" value={editForm.contactPhone} onChange={(e) => setEditForm((p) => ({ ...p, contactPhone: e.target.value }))} /></div><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Email" value={editForm.contactEmail} onChange={(e) => setEditForm((p) => ({ ...p, contactEmail: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Origen" value={editForm.source} onChange={(e) => setEditForm((p) => ({ ...p, source: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Servicio" value={editForm.serviceLine} onChange={(e) => setEditForm((p) => ({ ...p, serviceLine: e.target.value }))} /></div><div className="grid grid-cols-3 gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" placeholder="Monto" value={editForm.amount} onChange={(e) => setEditForm((p) => ({ ...p, amount: e.target.value }))} /><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={editForm.currency} onChange={(e) => setEditForm((p) => ({ ...p, currency: e.target.value as 'ARS' | 'USD' }))}><option value="ARS">ARS</option><option value="USD">USD</option></select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="number" min={0} max={100} placeholder="Prob %" value={editForm.probability} onChange={(e) => setEditForm((p) => ({ ...p, probability: e.target.value }))} /></div><div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={editForm.stage} onChange={(e) => setEditForm((p) => ({ ...p, stage: e.target.value as CrmDealStage }))}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" type="date" value={editForm.expectedCloseDate} onChange={(e) => setEditForm((p) => ({ ...p, expectedCloseDate: e.target.value }))} /></div>{editForm.stage === 'LOST' ? <textarea className="min-h-[64px] rounded-lg border border-rose-300 px-3 py-2 text-sm" placeholder="Motivo de perdida" value={editForm.lostReason} onChange={(e) => setEditForm((p) => ({ ...p, lostReason: e.target.value }))} /> : null}<textarea className="min-h-[72px] rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Notas internas" value={editForm.notes} onChange={(e) => setEditForm((p) => ({ ...p, notes: e.target.value }))} /><label className="flex items-center gap-2 text-xs font-semibold text-slate-700"><input type="checkbox" checked={editForm.isHistorical} onChange={(e) => setEditForm((p) => ({ ...p, isHistorical: e.target.checked }))} /> Carga historica</label><div className="flex flex-wrap gap-2"><button type="submit" disabled={isEditSaving || !canEdit} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-60">{isEditSaving ? 'Guardando...' : 'Guardar cambios'}</button>{selectedDeal.stage === 'WON' && !selectedDeal.convertedClientId ? <button type="button" className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-60" disabled={isConvertingId === selectedDeal.id || !canEdit} onClick={() => void convertDeal(selectedDeal)}>{isConvertingId === selectedDeal.id ? 'Convirtiendo...' : 'Convertir a cliente'}</button> : null}{canDelete ? <button type="button" className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-rose-700 disabled:opacity-60" disabled={isDeletingId === selectedDeal.id} onClick={() => setConfirmDelete(selectedDeal)}>{isDeletingId === selectedDeal.id ? 'Eliminando...' : 'Eliminar'}</button> : null}</div></form>}
        </article>
        <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-6">
          <h3 className="text-lg font-bold text-slate-900">Unidades vinculadas ({selectedDeal?.unitLinks?.length ?? 0})</h3>
          {!selectedDeal ? <p className="mt-3 text-sm text-slate-500">Selecciona una oportunidad para gestionar unidades.</p> : <>
            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12">
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-6" placeholder="Dominio (ej: AG216KV)" value={unitQuery} onChange={(e) => setUnitQuery(e.target.value)} />
              <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-3" value={unitStatus} onChange={(e) => setUnitStatus(e.target.value as CrmDealUnitStatus)}>{LINK_STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select>
              <button type="button" onClick={() => void searchUnits()} disabled={isSearchingUnit} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white md:col-span-3">{isSearchingUnit ? 'Buscando...' : 'Buscar'}</button>
              <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-12" placeholder="Nota opcional del vinculo" value={unitNote} onChange={(e) => setUnitNote(e.target.value)} />
            </div>
            {unitResults.length > 0 ? <div className="mt-3 max-h-44 space-y-2 overflow-y-auto pr-1">{unitResults.map((unit) => <div key={unit.id} className={['rounded border p-2 text-xs', unit.blockedBy && !unit.linkedStatusInCurrentDeal ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'].join(' ')}><div className="flex items-center justify-between gap-2"><div><p className="font-semibold">{unit.internalCode} - {unit.ownerCompany}</p>{unit.blockedBy ? <p className="text-rose-700">Bloqueada por {unit.blockedBy.dealKind === 'CONTRACT' ? 'contrato' : 'concurso'} {unit.blockedBy.dealTitle}</p> : null}{unit.linkedStatusInCurrentDeal ? <p className="text-emerald-700">Ya vinculada ({unit.linkedStatusInCurrentDeal})</p> : null}</div><button type="button" disabled={Boolean(unit.linkedStatusInCurrentDeal) || Boolean(unit.blockedBy && !unit.linkedStatusInCurrentDeal)} onClick={() => void linkUnit(unit.id)} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold">Vincular</button></div></div>)}</div> : null}
            <div className="mt-3 max-h-[290px] space-y-2 overflow-y-auto pr-1">
              {(selectedDeal.unitLinks ?? []).length === 0 ? <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">Sin unidades vinculadas.</div> : (selectedDeal.unitLinks ?? []).map((link) => <div key={link.id} className="rounded border border-slate-200 bg-white p-2"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{link.unit?.internalCode} - {link.unit?.ownerCompany}</p><p className="text-xs text-slate-500">{link.unit?.clientName || 'Sin asignar'}</p></div><div className="flex items-center gap-2"><select className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" value={link.status} onChange={(e) => void updateLink(link.id, e.target.value as CrmDealUnitStatus)}>{LINK_STATUSES.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}</select><button type="button" onClick={() => void unlinkUnit(link.id)} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Quitar</button></div></div></div>)}
            </div>
          </>}
        </article>
      </section>
      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-bold text-slate-900">Actividades</h3>
        {!selectedDeal ? <p className="mt-3 text-sm text-slate-500">Selecciona una oportunidad para gestionar actividades.</p> : <>
          <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-12" onSubmit={(e) => { e.preventDefault(); void addActivity() }}>
            <select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-3" value={activityForm.type} onChange={(e) => setActivityForm((p) => ({ ...p, type: e.target.value as CrmActivityType }))}>{ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-6" placeholder="Resumen de actividad" value={activityForm.summary} onChange={(e) => setActivityForm((p) => ({ ...p, summary: e.target.value }))} />
            <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3" type="date" value={activityForm.dueAt} onChange={(e) => setActivityForm((p) => ({ ...p, dueAt: e.target.value }))} />
            <button type="submit" disabled={isActivitySaving || !canEdit} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-12">{isActivitySaving ? 'Guardando actividad...' : 'Agregar actividad'}</button>
          </form>
          <div className="mt-4 max-h-[420px] space-y-2 overflow-y-auto pr-1">
            {selectedActivities.length === 0 ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">Sin actividades.</div> : selectedActivities.map((activity) => <article key={activity.id} className={['rounded-lg border p-3', overdue(activity) ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'].join(' ')}><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-slate-900">{activity.summary}</p><p className="text-xs text-slate-500">Tipo: {ACTIVITY_TYPES.find((t) => t.key === activity.type)?.label ?? activity.type} | Vence: {activity.dueAt ? new Date(activity.dueAt).toLocaleDateString('es-AR') : 'Sin fecha'}</p></div><button type="button" className={['rounded-lg border px-3 py-1 text-xs font-semibold', activity.status === 'DONE' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'].join(' ')} disabled={!canEdit} onClick={() => void toggleActivity(activity)}>{activity.status === 'DONE' ? 'Marcar pendiente' : 'Marcar realizada'}</button></div></article>)}
          </div>
        </>}
      </section>
      <ConfirmModal isOpen={Boolean(confirmDelete)} title="Eliminar oportunidad" message={confirmDelete ? `Se eliminara ${confirmDelete.title}. Esta accion no se puede deshacer.` : ''} onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteDeal()} />
    </section>
  )
}
