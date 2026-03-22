import { useCallback, useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { CrmActivity, CrmActivityType, CrmDeal, CrmDealKind, CrmDealStage, CrmDealUnitStatus } from '../../../types/domain'

const STAGES: Array<{ key: CrmDealStage; label: string }> = [
  { key: 'LEAD', label: 'Lead' }, { key: 'CONTACTED', label: 'Contactado' }, { key: 'QUALIFICATION', label: 'Calificado' },
  { key: 'PROPOSAL', label: 'Propuesta' }, { key: 'NEGOTIATION', label: 'Negociacion' }, { key: 'WON', label: 'Ganada' }, { key: 'LOST', label: 'Perdida' },
]
const DEAL_KINDS: Array<{ key: CrmDealKind; label: string }> = [{ key: 'TENDER', label: 'Concurso' }, { key: 'CONTRACT', label: 'Contrato' }]
const LINK_STATUSES: Array<{ key: CrmDealUnitStatus; label: string }> = [{ key: 'EN_CONCURSO', label: 'En concurso' }, { key: 'ADJUDICADA', label: 'Adjudicada' }, { key: 'PERDIDA', label: 'Perdida' }, { key: 'LIBERADA', label: 'Liberada' }]
const ACTIVITY_TYPES: Array<{ key: CrmActivityType; label: string }> = [{ key: 'CALL', label: 'Llamada' }, { key: 'WHATSAPP', label: 'WhatsApp' }, { key: 'EMAIL', label: 'Email' }, { key: 'MEETING', label: 'Reunion' }, { key: 'TASK', label: 'Tarea' }]

type DealForm = { title: string; companyName: string; dealKind: CrmDealKind; referenceCode: string; isHistorical: boolean; amount: string; currency: 'ARS' | 'USD'; probability: string; stage: CrmDealStage; expectedCloseDate: string; assignedToUserId: string; source: string; serviceLine: string; notes: string; lostReason: string }
type ActivityForm = { type: CrmActivityType; summary: string; dueAt: string }
type UnitSearch = { id: string; internalCode: string; ownerCompany: string; clientName: string; linkedStatusInCurrentDeal?: CrmDealUnitStatus | null; blockedBy?: { dealTitle: string; dealKind: CrmDealKind } | null }

const EMPTY_DEAL: DealForm = { title: '', companyName: '', dealKind: 'TENDER', referenceCode: '', isHistorical: false, amount: '', currency: 'ARS', probability: '', stage: 'LEAD', expectedCloseDate: '', assignedToUserId: '', source: '', serviceLine: '', notes: '', lostReason: '' }
const EMPTY_ACTIVITY: ActivityForm = { type: 'TASK', summary: '', dueAt: '' }

const trim = (v: string) => v.trim()
const num = (v: string, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const asDateInput = (v?: string | null) => (v ? new Date(v).toISOString().slice(0, 10) : '')
const stale = (v?: string | null) => !v || Number.isNaN(new Date(v).getTime()) || Date.now() - new Date(v).getTime() > 1000 * 60 * 60 * 24 * 14
const sortTime = (a: CrmActivity) => new Date(a.dueAt || a.updatedAt || a.createdAt || 0).getTime() || 0

const toForm = (d: CrmDeal): DealForm => ({ title: d.title || '', companyName: d.companyName || '', dealKind: d.dealKind || 'TENDER', referenceCode: d.referenceCode || '', isHistorical: !!d.isHistorical, amount: String(d.amount || 0), currency: d.currency || 'ARS', probability: String(d.probability || 0), stage: d.stage, expectedCloseDate: asDateInput(d.expectedCloseDate), assignedToUserId: d.assignedToUserId || '', source: d.source || '', serviceLine: d.serviceLine || '', notes: d.notes || '', lostReason: d.lostReason || '' })
const toPayload = (f: DealForm) => ({ title: trim(f.title), companyName: trim(f.companyName), dealKind: f.dealKind, referenceCode: trim(f.referenceCode), isHistorical: f.isHistorical, amount: num(f.amount), currency: f.currency, probability: num(f.probability), stage: f.stage, expectedCloseDate: f.expectedCloseDate ? new Date(`${f.expectedCloseDate}T00:00:00.000Z`).toISOString() : undefined, assignedToUserId: f.assignedToUserId || null, source: trim(f.source), serviceLine: trim(f.serviceLine), notes: trim(f.notes), lostReason: f.stage === 'LOST' ? trim(f.lostReason) : '' })

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
  const [isSaving, setIsSaving] = useState(false)
  const [isSearchingUnit, setIsSearchingUnit] = useState(false)

  const loadCrm = useCallback(async (loader = false) => {
    if (loader) setIsLoading(true)
    try {
      const data = await apiRequest<{ deals: CrmDeal[]; activities: CrmActivity[] }>('/crm')
      const nextDeals = Array.isArray(data.deals) ? data.deals : []
      setDeals(nextDeals)
      setActivities(Array.isArray(data.activities) ? data.activities : [])
      setStageDraft(nextDeals.reduce<Record<string, CrmDealStage>>((acc, d) => { acc[d.id] = d.stage; return acc }, {}))
      setSelectedDealId((prev) => (prev && nextDeals.some((d) => d.id === prev) ? prev : nextDeals[0]?.id || ''))
    } catch {
      setAppError('No se pudo cargar CRM.')
    } finally {
      if (loader) setIsLoading(false)
    }
  }, [setAppError])
  useEffect(() => { void loadCrm(true) }, [loadCrm])

  const filteredDeals = useMemo(() => deals.filter((d) => (!ownerFilter || (d.assignedToUserId || '') === ownerFilter) && (!search.trim() || [d.title, d.companyName, d.referenceCode, d.source].join(' ').toLowerCase().includes(search.trim().toLowerCase()))), [deals, ownerFilter, search])
  useEffect(() => { if (!filteredDeals.length) setSelectedDealId(''); else if (!filteredDeals.some((d) => d.id === selectedDealId)) setSelectedDealId(filteredDeals[0].id) }, [filteredDeals, selectedDealId])

  const selectedDeal = useMemo(() => deals.find((d) => d.id === selectedDealId) ?? null, [deals, selectedDealId])
  useEffect(() => { setEditForm(selectedDeal ? toForm(selectedDeal) : EMPTY_DEAL) }, [selectedDeal])
  const selectedActivities = useMemo(() => activities.filter((a) => a.dealId === selectedDealId).sort((a, b) => sortTime(b) - sortTime(a)), [activities, selectedDealId])

  const createDeal = async () => {
    if (!canCreate) return
    if (!trim(createForm.title) || !trim(createForm.companyName)) return setAppError('Completa titulo y empresa.')
    setIsSaving(true)
    try { await apiRequest('/crm/deals', { method: 'POST', body: toPayload(createForm) }); setCreateForm(EMPTY_DEAL); await loadCrm(false) } catch { setAppError('No se pudo crear la oportunidad.') } finally { setIsSaving(false) }
  }
  const saveDeal = async () => {
    if (!canEdit || !selectedDeal) return
    setIsSaving(true)
    try { await apiRequest(`/crm/deals/${selectedDeal.id}`, { method: 'PATCH', body: toPayload(editForm) }); await loadCrm(false) } catch { setAppError('No se pudo actualizar la oportunidad.') } finally { setIsSaving(false) }
  }
  const moveStage = async (id: string, stage: CrmDealStage) => {
    if (!canEdit) return
    try { await apiRequest(`/crm/deals/${id}/stage`, { method: 'PATCH', body: { stage } }); await loadCrm(false) } catch { setAppError('No se pudo mover la etapa.') }
  }
  const convertDeal = async () => {
    if (!selectedDeal || !canEdit) return
    try { await apiRequest(`/crm/deals/${selectedDeal.id}/convert-client`, { method: 'POST' }); await loadCrm(false) } catch { setAppError('No se pudo convertir a cliente.') }
  }
  const deleteDeal = async () => {
    if (!confirmDelete || !canDelete) return
    try { await apiRequest(`/crm/deals/${confirmDelete.id}`, { method: 'DELETE' }); setConfirmDelete(null); await loadCrm(false) } catch { setAppError('No se pudo eliminar la oportunidad.') }
  }
  const addActivity = async () => {
    if (!selectedDeal || !canEdit) return
    if (!trim(activityForm.summary)) return setAppError('Completa el resumen de actividad.')
    try { await apiRequest(`/crm/deals/${selectedDeal.id}/activities`, { method: 'POST', body: { type: activityForm.type, summary: trim(activityForm.summary), dueAt: activityForm.dueAt ? new Date(`${activityForm.dueAt}T00:00:00.000Z`).toISOString() : undefined } }); setActivityForm(EMPTY_ACTIVITY); await loadCrm(false) } catch { setAppError('No se pudo registrar la actividad.') }
  }
  const toggleActivity = async (a: CrmActivity) => {
    if (!canEdit) return
    try { await apiRequest(`/crm/activities/${a.id}`, { method: 'PATCH', body: { status: a.status === 'DONE' ? 'PENDING' : 'DONE' } }); await loadCrm(false) } catch { setAppError('No se pudo actualizar la actividad.') }
  }
  const searchUnits = async () => {
    if (!selectedDeal || !trim(unitQuery)) return setUnitResults([])
    setIsSearchingUnit(true)
    try { const data = await apiRequest<UnitSearch[]>(`/crm/deals/${selectedDeal.id}/units/search?q=${encodeURIComponent(trim(unitQuery))}`); setUnitResults(Array.isArray(data) ? data : []) } catch { setAppError('No se pudieron buscar unidades.') } finally { setIsSearchingUnit(false) }
  }
  const linkUnit = async (unitId: string) => {
    if (!selectedDeal || !canEdit) return
    try { await apiRequest(`/crm/deals/${selectedDeal.id}/units`, { method: 'POST', body: { unitId, status: unitStatus, notes: trim(unitNote) } }); setUnitNote(''); await searchUnits(); await loadCrm(false) } catch (e: any) { setAppError(e?.message || 'No se pudo vincular la unidad.') }
  }
  const updateLink = async (id: string, status: CrmDealUnitStatus) => {
    if (!selectedDeal || !canEdit) return
    try { await apiRequest(`/crm/deals/${selectedDeal.id}/units/${id}`, { method: 'PATCH', body: { status } }); await searchUnits(); await loadCrm(false) } catch (e: any) { setAppError(e?.message || 'No se pudo actualizar unidad.') }
  }
  const unlink = async (id: string) => {
    if (!selectedDeal || !canEdit) return
    try { await apiRequest(`/crm/deals/${selectedDeal.id}/units/${id}`, { method: 'DELETE' }); await searchUnits(); await loadCrm(false) } catch { setAppError('No se pudo desvincular la unidad.') }
  }

  return <section className="space-y-5">
    <header><BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" /><h2 className="text-2xl font-bold text-slate-900">CRM Comercial</h2><p className="text-sm text-slate-600">Concursos y contratos con vinculo de unidades y carga historica manual.</p></header>
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-4">
        <h3 className="text-base font-bold">Nueva oportunidad</h3>
        <div className="mt-2 grid gap-2">
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Titulo" value={createForm.title} onChange={(e) => setCreateForm((p) => ({ ...p, title: e.target.value }))} />
          <input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Empresa" value={createForm.companyName} onChange={(e) => setCreateForm((p) => ({ ...p, companyName: e.target.value }))} />
          <div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={createForm.dealKind} onChange={(e) => setCreateForm((p) => ({ ...p, dealKind: e.target.value as CrmDealKind }))}>{DEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo / referencia" value={createForm.referenceCode} onChange={(e) => setCreateForm((p) => ({ ...p, referenceCode: e.target.value }))} /></div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={createForm.isHistorical} onChange={(e) => setCreateForm((p) => ({ ...p, isHistorical: e.target.checked }))} /> Historico</label>
          <button type="button" disabled={!canCreate || isSaving} onClick={() => void createDeal()} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900">{isSaving ? 'Guardando...' : 'Crear oportunidad'}</button>
        </div>
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-8">
        <div className="flex flex-wrap gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}><option value="">Todos</option>{salesUsers.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}</select><input className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" placeholder="Buscar..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        {isLoading ? <p className="mt-3 text-sm text-slate-500">Cargando...</p> : <div className="mt-3 overflow-x-auto"><div className="flex min-w-max gap-3">{STAGES.map((stage) => <section key={stage.key} className="w-[290px] rounded-lg border border-slate-200 bg-slate-50 p-2"><div className="mb-2 flex items-center justify-between"><strong className="text-sm">{stage.label}</strong><span className="text-xs">{filteredDeals.filter((d) => d.stage === stage.key).length}</span></div><div className="space-y-2">{filteredDeals.filter((d) => d.stage === stage.key).map((deal) => <article key={deal.id} className={['rounded-lg border bg-white p-2', selectedDealId === deal.id ? 'border-amber-400' : 'border-slate-200'].join(' ')} onClick={() => setSelectedDealId(deal.id)}><p className="text-sm font-semibold">{deal.title}</p><p className="text-xs">{deal.companyName}</p><p className="text-xs">{deal.dealKind === 'CONTRACT' ? 'Contrato' : 'Concurso'} {deal.referenceCode ? `| ${deal.referenceCode}` : ''} {deal.isHistorical ? '| Historico' : ''}</p><p className="text-xs">Unidades: {deal.unitLinks?.length ?? 0}</p><div className="mt-1 flex gap-1"><select className="w-full rounded border border-slate-300 px-1 py-1 text-xs" value={stageDraft[deal.id] ?? deal.stage} onChange={(e) => setStageDraft((p) => ({ ...p, [deal.id]: e.target.value as CrmDealStage }))}>{STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><button type="button" className="rounded border border-slate-300 px-2 text-xs" onClick={(e) => { e.stopPropagation(); void moveStage(deal.id, stageDraft[deal.id] ?? deal.stage) }}>Mover</button></div>{stale(deal.lastContactAt ?? deal.updatedAt ?? deal.createdAt) && deal.stage !== 'WON' && deal.stage !== 'LOST' ? <p className="text-[11px] text-amber-700">Sin contacto reciente</p> : null}</article>)}</div></section>)}</div></div>}
      </article>
    </section>
    <section className="grid grid-cols-1 gap-4 xl:grid-cols-12">
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-6">
        <h3 className="text-base font-bold">Detalle de oportunidad</h3>
        {!selectedDeal ? <p className="mt-2 text-sm text-slate-500">Selecciona una oportunidad.</p> : <div className="mt-2 grid gap-2"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.title} onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" value={editForm.companyName} onChange={(e) => setEditForm((p) => ({ ...p, companyName: e.target.value }))} /><div className="grid grid-cols-2 gap-2"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={editForm.dealKind} onChange={(e) => setEditForm((p) => ({ ...p, dealKind: e.target.value as CrmDealKind }))}>{DEAL_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Codigo / referencia" value={editForm.referenceCode} onChange={(e) => setEditForm((p) => ({ ...p, referenceCode: e.target.value }))} /></div><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={editForm.isHistorical} onChange={(e) => setEditForm((p) => ({ ...p, isHistorical: e.target.checked }))} /> Historico</label><div className="flex gap-2"><button type="button" disabled={!canEdit || isSaving} onClick={() => void saveDeal()} className="rounded-lg bg-amber-400 px-3 py-2 text-sm font-semibold text-slate-900">Guardar</button>{selectedDeal.stage === 'WON' && !selectedDeal.convertedClientId ? <button type="button" disabled={!canEdit} onClick={() => void convertDeal()} className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700">Convertir cliente</button> : null}{canDelete ? <button type="button" onClick={() => setConfirmDelete(selectedDeal)} className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">Eliminar</button> : null}</div></div>}
      </article>
      <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm xl:col-span-6">
        <h3 className="text-base font-bold">Unidades vinculadas ({selectedDeal?.unitLinks?.length ?? 0})</h3>
        {!selectedDeal ? <p className="mt-2 text-sm text-slate-500">Selecciona una oportunidad.</p> : <>
          <div className="mt-2 grid gap-2 md:grid-cols-12"><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-6" placeholder="Dominio (ej: AG216KV)" value={unitQuery} onChange={(e) => setUnitQuery(e.target.value)} /><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-3" value={unitStatus} onChange={(e) => setUnitStatus(e.target.value as CrmDealUnitStatus)}>{LINK_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><button type="button" onClick={() => void searchUnits()} disabled={isSearchingUnit} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white md:col-span-3">{isSearchingUnit ? 'Buscando...' : 'Buscar'}</button><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-12" placeholder="Nota opcional" value={unitNote} onChange={(e) => setUnitNote(e.target.value)} /></div>
          {unitResults.length > 0 ? <div className="mt-2 max-h-44 space-y-2 overflow-y-auto">{unitResults.map((u) => <div key={u.id} className={['rounded border p-2 text-xs', u.blockedBy && !u.linkedStatusInCurrentDeal ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'].join(' ')}><div className="flex items-center justify-between gap-2"><div><p className="font-semibold">{u.internalCode} - {u.ownerCompany}</p>{u.blockedBy ? <p className="text-rose-700">Bloqueada por {u.blockedBy.dealKind === 'CONTRACT' ? 'contrato' : 'concurso'} {u.blockedBy.dealTitle}</p> : null}{u.linkedStatusInCurrentDeal ? <p className="text-emerald-700">Ya vinculada ({u.linkedStatusInCurrentDeal})</p> : null}</div><button type="button" disabled={Boolean(u.linkedStatusInCurrentDeal) || Boolean(u.blockedBy && !u.linkedStatusInCurrentDeal)} onClick={() => void linkUnit(u.id)} className="rounded border border-slate-300 bg-white px-2 py-1 font-semibold">Vincular</button></div></div>)}</div> : null}
          <div className="mt-3 space-y-2">{(selectedDeal.unitLinks ?? []).length === 0 ? <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">Sin unidades vinculadas.</div> : (selectedDeal.unitLinks ?? []).map((link) => <div key={link.id} className="rounded border border-slate-200 bg-white p-2"><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{link.unit?.internalCode} - {link.unit?.ownerCompany}</p><p className="text-xs text-slate-500">{link.unit?.clientName || 'Sin asignar'}</p></div><div className="flex items-center gap-2"><select className="rounded border border-slate-300 bg-white px-2 py-1 text-xs" value={link.status} onChange={(e) => void updateLink(link.id, e.target.value as CrmDealUnitStatus)}>{LINK_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select><button type="button" onClick={() => void unlink(link.id)} className="rounded border border-rose-300 bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700">Quitar</button></div></div></div>)}</div>
        </>}
      </article>
    </section>
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="text-base font-bold">Actividades ({selectedActivities.length})</h3>
      {!selectedDeal ? <p className="mt-2 text-sm text-slate-500">Selecciona una oportunidad.</p> : <>
        <div className="mt-2 grid gap-2 md:grid-cols-12"><select className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm md:col-span-3" value={activityForm.type} onChange={(e) => setActivityForm((p) => ({ ...p, type: e.target.value as CrmActivityType }))}>{ACTIVITY_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-6" placeholder="Resumen" value={activityForm.summary} onChange={(e) => setActivityForm((p) => ({ ...p, summary: e.target.value }))} /><input className="rounded-lg border border-slate-300 px-3 py-2 text-sm md:col-span-3" type="date" value={activityForm.dueAt} onChange={(e) => setActivityForm((p) => ({ ...p, dueAt: e.target.value }))} /><button type="button" onClick={() => void addActivity()} disabled={!canEdit} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white md:col-span-12">Agregar actividad</button></div>
        <div className="mt-3 max-h-60 space-y-2 overflow-y-auto">{selectedActivities.length === 0 ? <div className="rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-500">Sin actividades.</div> : selectedActivities.map((a) => <article key={a.id} className={['rounded border p-2', stale(a.dueAt) && a.status === 'PENDING' ? 'border-rose-300 bg-rose-50' : 'border-slate-200 bg-slate-50'].join(' ')}><div className="flex items-center justify-between gap-2"><div><p className="text-sm font-semibold">{a.summary}</p><p className="text-xs text-slate-500">Tipo {a.type} | Vence {a.dueAt ? new Date(a.dueAt).toLocaleDateString('es-AR') : '-'}</p></div><button type="button" onClick={() => void toggleActivity(a)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-semibold">{a.status === 'DONE' ? 'Marcar pendiente' : 'Marcar realizada'}</button></div></article>)}</div>
      </>}
    </section>
    <ConfirmModal isOpen={Boolean(confirmDelete)} title="Eliminar oportunidad" message={confirmDelete ? `Se eliminara ${confirmDelete.title}. Esta accion no se puede deshacer.` : ''} onCancel={() => setConfirmDelete(null)} onConfirm={() => void deleteDeal()} />
  </section>
}
