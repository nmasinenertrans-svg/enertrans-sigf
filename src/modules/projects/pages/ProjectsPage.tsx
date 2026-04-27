import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAsyncLoader } from '../../../core/hooks/useAsyncLoader'
import { ROUTE_PATHS, buildProjectDetailPath } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import type { FleetProject, FleetUnit } from '../../../types/domain'
import { fleetProjectStatuses } from '../../../types/domain'
import { fetchProjects, createProject } from '../services/projectsService'
import { apiRequest } from '../../../services/api/apiClient'
import {
  createEmptyProjectForm,
  PROJECT_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  type ProjectFormData,
} from '../types'

const formatDate = (iso: string | null): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const itemsProgress = (project: FleetProject): string => {
  const total = project.items.length
  if (total === 0) return ''
  const done = project.items.filter((i) => i.status === 'DONE').length
  return `${done}/${total}`
}

export const ProjectsPage = () => {
  const { can } = usePermissions()
  const { state: { users }, actions: { setAppError } } = useAppContext()

  const [projects, setProjects] = useState<FleetProject[]>([])
  const [fleetUnits, setFleetUnits] = useState<FleetUnit[]>([])
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<ProjectFormData>(createEmptyProjectForm())
  const [saving, setSaving] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [unitDropdownOpen, setUnitDropdownOpen] = useState(false)

  const { isLoading } = useAsyncLoader(
    async (getMounted) => {
      if (!can('FLEET', 'view')) return
      try {
        const [projs, units] = await Promise.all([
          fetchProjects(),
          apiRequest<FleetUnit[]>('/fleet'),
        ])
        if (!getMounted()) return
        setProjects(Array.isArray(projs) ? projs : [])
        setFleetUnits(Array.isArray(units) ? units : [])
      } catch {
        setAppError('Error al cargar proyectos')
      }
    },
    [can, setAppError],
  )

  const canEdit = can('FLEET', 'edit')

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { ALL: projects.length }
    for (const s of fleetProjectStatuses) counts[s] = 0
    for (const p of projects) counts[p.status] = (counts[p.status] ?? 0) + 1
    return counts
  }, [projects])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return projects.filter((p) => {
      if (statusFilter !== 'ALL' && p.status !== statusFilter) return false
      if (q && !p.title.toLowerCase().includes(q) && !p.unitLabel.toLowerCase().includes(q)) return false
      return true
    })
  }, [projects, statusFilter, searchQuery])

  const filteredUnits = useMemo(() => {
    const q = unitSearch.trim().toLowerCase()
    if (!q) return fleetUnits.slice(0, 30)
    return fleetUnits.filter((u) =>
      u.internalCode.toLowerCase().includes(q) ||
      `${u.brand} ${u.model}`.toLowerCase().includes(q),
    ).slice(0, 30)
  }, [fleetUnits, unitSearch])

  const selectedUnit = fleetUnits.find((u) => u.id === form.unitId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim() || !form.projectType || !form.unitId) return
    setSaving(true)
    try {
      const created = await createProject({
        title: form.title.trim(),
        projectType: form.projectType,
        status: form.status,
        priority: form.priority,
        unitId: form.unitId,
        description: form.description.trim(),
        estimatedCost: Number(form.estimatedCost) || 0,
        actualCost: Number(form.actualCost) || 0,
        currency: form.currency,
        assignedToUserId: form.assignedToUserId || null,
        targetDate: form.targetDate || null,
        modificationNotes: form.modificationNotes.trim(),
      })
      setProjects((prev) => [created, ...prev])
      setForm(createEmptyProjectForm())
      setUnitSearch('')
      setShowForm(false)
    } catch {
      setAppError('Error al crear proyecto')
    } finally {
      setSaving(false)
    }
  }

  if (!can('FLEET', 'view')) return null

  return (
    <section className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <BackLink to={ROUTE_PATHS.dashboard} label="Inicio" />
          <h2 className="text-2xl font-bold text-slate-900">Proyectos de Modificación</h2>
          <p className="mt-1 text-sm text-slate-500">Cambios de configuración y adaptaciones de unidades</p>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
          >
            {showForm ? 'Cancelar' : '+ Nuevo proyecto'}
          </button>
        )}
      </header>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setStatusFilter('ALL')}
          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${statusFilter === 'ALL' ? 'border-slate-700 bg-slate-700 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}
        >
          Todos ({statusCounts['ALL']})
        </button>
        {fleetProjectStatuses.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${statusFilter === s ? 'border-slate-700 bg-slate-700 text-white' : `${PROJECT_STATUS_COLORS[s]} hover:opacity-80`}`}
          >
            {PROJECT_STATUS_LABELS[s]} ({statusCounts[s] ?? 0})
          </button>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        {/* New project form */}
        {showForm && canEdit && (
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
            <h3 className="mb-4 text-base font-bold text-slate-900">Nuevo proyecto</h3>
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Título *</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Ej: Cambio de hidrogrúa XCMG"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Unidad *</label>
                <div className="relative">
                  <input
                    value={unitSearch || selectedUnit ? (selectedUnit ? `${selectedUnit.brand} ${selectedUnit.model} — ${selectedUnit.internalCode}` : unitSearch) : unitSearch}
                    onChange={(e) => {
                      setUnitSearch(e.target.value)
                      setForm((f) => ({ ...f, unitId: '' }))
                      setUnitDropdownOpen(true)
                    }}
                    onFocus={() => setUnitDropdownOpen(true)}
                    placeholder="Buscar unidad..."
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  />
                  {unitDropdownOpen && filteredUnits.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                      {filteredUnits.map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => {
                            setForm((f) => ({ ...f, unitId: u.id }))
                            setUnitSearch('')
                            setUnitDropdownOpen(false)
                          }}
                          className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                        >
                          <span className="font-semibold">{u.internalCode}</span> — {u.brand} {u.model}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Tipo de modificación *</label>
                <select
                  value={form.projectType}
                  onChange={(e) => setForm((f) => ({ ...f, projectType: e.target.value as ProjectFormData['projectType'] }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                >
                  <option value="">Seleccionar...</option>
                  {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Estado</label>
                  <select
                    value={form.status}
                    onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as ProjectFormData['status'] }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    {fleetProjectStatuses.map((s) => (
                      <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Prioridad</label>
                  <select
                    value={form.priority}
                    onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as ProjectFormData['priority'] }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Responsable</label>
                <select
                  value={form.assignedToUserId}
                  onChange={(e) => setForm((f) => ({ ...f, assignedToUserId: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                >
                  <option value="">Sin asignar</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Fecha objetivo</label>
                <input
                  type="date"
                  value={form.targetDate}
                  onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Presupuesto estimado</label>
                  <input
                    type="number"
                    min="0"
                    value={form.estimatedCost}
                    onChange={(e) => setForm((f) => ({ ...f, estimatedCost: e.target.value }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Moneda</label>
                  <select
                    value={form.currency}
                    onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value as 'ARS' | 'USD' }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  >
                    <option value="ARS">ARS</option>
                    <option value="USD">USD</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Descripción</label>
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Detalles del proyecto..."
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                />
              </div>

              <button
                type="submit"
                disabled={saving || !form.title.trim() || !form.projectType || !form.unitId}
                className="w-full rounded-lg bg-amber-400 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
              >
                {saving ? 'Guardando...' : 'Crear proyecto'}
              </button>
            </form>
          </section>
        )}

        {/* Projects list */}
        <section className={`space-y-3 ${showForm && canEdit ? 'xl:col-span-2' : 'xl:col-span-3'}`}>
          <div className="flex items-center gap-3">
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por título o unidad..."
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            />
            <span className="whitespace-nowrap text-sm text-slate-500">{filtered.length} proyecto{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {isLoading && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              Cargando proyectos...
            </div>
          )}

          {!isLoading && filtered.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              {projects.length === 0 ? 'No hay proyectos creados.' : 'No hay proyectos que coincidan con los filtros.'}
            </div>
          )}

          {filtered.map((project) => {
            const progress = itemsProgress(project)
            return (
              <Link
                key={project.id}
                to={buildProjectDetailPath(project.id)}
                className="block rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${PROJECT_STATUS_COLORS[project.status]}`}>
                        {PROJECT_STATUS_LABELS[project.status]}
                      </span>
                      <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[project.priority]}`}>
                        {PRIORITY_LABELS[project.priority]}
                      </span>
                      {project.projectType && (
                        <span className="inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">
                          {PROJECT_TYPE_LABELS[project.projectType]}
                        </span>
                      )}
                    </div>
                    <h3 className="mt-1 truncate text-base font-bold text-slate-900">{project.title}</h3>
                    <p className="text-sm text-slate-600">{project.unitLabel || project.unitInternalCode}</p>
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    {progress && (
                      <div className="mb-1 font-semibold text-slate-700">Tareas {progress}</div>
                    )}
                    {project.targetDate && (
                      <div>Objetivo: {formatDate(project.targetDate)}</div>
                    )}
                    {project.assignedToUserName && (
                      <div className="mt-1">{project.assignedToUserName}</div>
                    )}
                  </div>
                </div>
                {project.estimatedCost > 0 && (
                  <div className="mt-2 text-xs text-slate-500">
                    Ppto: {project.currency} {project.estimatedCost.toLocaleString('es-AR')}
                    {project.actualCost > 0 && ` · Real: ${project.currency} ${project.actualCost.toLocaleString('es-AR')}`}
                  </div>
                )}
              </Link>
            )
          })}
        </section>
      </div>
    </section>
  )
}
