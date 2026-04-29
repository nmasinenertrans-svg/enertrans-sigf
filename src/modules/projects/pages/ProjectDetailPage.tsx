import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAsyncLoader } from '../../../core/hooks/useAsyncLoader'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { BackLink } from '../../../components/shared/BackLink'
import type { FleetProject, FleetProjectItem, FleetProjectStatus, WorkOrder, ExternalRequest } from '../../../types/domain'
import { fleetProjectStatuses, fleetProjectItemStatuses } from '../../../types/domain'
import { apiRequest } from '../../../services/api/apiClient'
import {
  fetchProject,
  updateProject,
  deleteProject,
  createProjectItem,
  updateProjectItem,
  deleteProjectItem,
  linkWorkOrder,
  unlinkWorkOrder,
  linkExternalRequest,
  unlinkExternalRequest,
} from '../services/projectsService'
import {
  PROJECT_TYPE_LABELS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_COLORS,
  PRIORITY_LABELS,
  PRIORITY_COLORS,
  ITEM_STATUS_LABELS,
  createEmptyItemForm,
  type ItemFormData,
} from '../types'

const formatDate = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const ITEM_STATUS_ICONS: Record<string, string> = {
  PENDING: '○',
  IN_PROGRESS: '◑',
  DONE: '●',
  SKIPPED: '✕',
}

const ITEM_STATUS_COLORS: Record<string, string> = {
  PENDING: 'text-slate-400',
  IN_PROGRESS: 'text-sky-500',
  DONE: 'text-emerald-500',
  SKIPPED: 'text-slate-400 line-through',
}

export const ProjectDetailPage = () => {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { can } = usePermissions()
  const { state: { users }, actions: { setAppError } } = useAppContext()

  const [project, setProject] = useState<FleetProject | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState<Partial<FleetProject>>({})
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const [itemForm, setItemForm] = useState<ItemFormData>(createEmptyItemForm())
  const [addingItem, setAddingItem] = useState(false)
  const [savingItem, setSavingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemTitle, setEditingItemTitle] = useState('')

  const [unitWorkOrders, setUnitWorkOrders] = useState<WorkOrder[]>([])
  const [unitExternalRequests, setUnitExternalRequests] = useState<ExternalRequest[]>([])
  const [woSearchOpen, setWoSearchOpen] = useState(false)
  const [ndpSearchOpen, setNdpSearchOpen] = useState(false)

  const load = useCallback(
    async (getMounted: () => boolean) => {
      if (!projectId || !can('FLEET', 'view')) return
      try {
        const [p, wos, ndps] = await Promise.all([
          fetchProject(projectId),
          apiRequest<WorkOrder[]>('/work-orders'),
          apiRequest<ExternalRequest[]>('/external-requests'),
        ])
        if (!getMounted()) return
        setProject(p)
        setUnitWorkOrders(Array.isArray(wos) ? wos : [])
        setUnitExternalRequests(Array.isArray(ndps) ? ndps : [])
      } catch {
        setAppError('Error al cargar el proyecto')
      }
    },
    [projectId, can, setAppError],
  )

  const { isLoading } = useAsyncLoader(load, [load])

  const canEdit = can('FLEET', 'edit')

  const handleStatusChange = async (status: FleetProjectStatus) => {
    if (!project) return
    setSaving(true)
    try {
      const updated = await updateProject(project.id, { status })
      setProject(updated)
    } catch {
      setAppError('Error al actualizar estado')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project) return
    setSaving(true)
    try {
      const updated = await updateProject(project.id, {
        ...editForm,
        estimatedCost: Number(editForm.estimatedCost) || 0,
        actualCost: Number(editForm.actualCost) || 0,
        targetDate: editForm.targetDate || null,
      })
      setProject(updated)
      setEditMode(false)
    } catch {
      setAppError('Error al guardar cambios')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!project) return
    setDeleting(true)
    try {
      await deleteProject(project.id)
      navigate(ROUTE_PATHS.projects.list)
    } catch {
      setAppError('Error al eliminar proyecto')
      setDeleting(false)
    }
  }

  const handleAddItem = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!project || !itemForm.title.trim()) return
    setSavingItem(true)
    try {
      const updated = await createProjectItem(project.id, {
        title: itemForm.title.trim(),
        description: itemForm.description.trim(),
        assignedToUserId: itemForm.assignedToUserId || null,
      })
      setProject(updated)
      setItemForm(createEmptyItemForm())
      setAddingItem(false)
    } catch {
      setAppError('Error al agregar tarea')
    } finally {
      setSavingItem(false)
    }
  }

  const handleItemStatusChange = async (item: FleetProjectItem, status: string) => {
    if (!project) return
    try {
      const updated = await updateProjectItem(project.id, item.id, { status })
      setProject(updated)
    } catch {
      setAppError('Error al actualizar tarea')
    }
  }

  const handleSaveItemTitle = async (item: FleetProjectItem) => {
    if (!project || !editingItemTitle.trim()) return
    try {
      const updated = await updateProjectItem(project.id, item.id, { title: editingItemTitle.trim() })
      setProject(updated)
      setEditingItemId(null)
    } catch {
      setAppError('Error al guardar tarea')
    }
  }

  const handleDeleteItem = async (item: FleetProjectItem) => {
    if (!project) return
    try {
      const updated = await deleteProjectItem(project.id, item.id)
      setProject(updated)
    } catch {
      setAppError('Error al eliminar tarea')
    }
  }

  const handleLinkWorkOrder = async (woId: string) => {
    if (!project) return
    try {
      const updated = await linkWorkOrder(project.id, woId)
      setProject(updated)
      setWoSearchOpen(false)
    } catch { setAppError('Error al vincular OT') }
  }

  const handleUnlinkWorkOrder = async (woId: string) => {
    if (!project) return
    try {
      const updated = await unlinkWorkOrder(project.id, woId)
      setProject(updated)
    } catch { setAppError('Error al desvincular OT') }
  }

  const handleLinkExternalRequest = async (erId: string) => {
    if (!project) return
    try {
      const updated = await linkExternalRequest(project.id, erId)
      setProject(updated)
      setNdpSearchOpen(false)
    } catch { setAppError('Error al vincular NDP') }
  }

  const handleUnlinkExternalRequest = async (erId: string) => {
    if (!project) return
    try {
      const updated = await unlinkExternalRequest(project.id, erId)
      setProject(updated)
    } catch { setAppError('Error al desvincular NDP') }
  }

  if (isLoading) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">Cargando proyecto...</div>
    )
  }

  if (!project) {
    return (
      <div className="py-16 text-center text-sm text-slate-500">Proyecto no encontrado.</div>
    )
  }

  const doneCount = project.items.filter((i) => i.status === 'DONE').length
  const totalCount = project.items.length

  return (
    <section className="space-y-5">
      <BackLink to={ROUTE_PATHS.projects.list} label="Proyectos" />

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${PROJECT_STATUS_COLORS[project.status]}`}>
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[project.priority]}`}>
              {PRIORITY_LABELS[project.priority]}
            </span>
            {project.projectTypes.map((t) => (
              <span key={t} className="inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">
                {PROJECT_TYPE_LABELS[t as keyof typeof PROJECT_TYPE_LABELS] ?? t}
              </span>
            ))}
          </div>
          <h2 className="mt-1 text-2xl font-bold text-slate-900">{project.title}</h2>
          <p className="text-sm text-slate-600">{project.unitLabel}</p>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              onClick={() => { setEditMode((v) => !v); setEditForm({ ...project }) }}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              {editMode ? 'Cancelar' : 'Editar'}
            </button>
            {!confirmDelete ? (
              <button
                type="button"
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-rose-300 px-3 py-1.5 text-sm font-semibold text-rose-600 hover:bg-rose-50"
              >
                Eliminar
              </button>
            ) : (
              <button
                type="button"
                disabled={deleting}
                onClick={() => void handleDelete()}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-rose-600 disabled:opacity-50"
              >
                {deleting ? 'Eliminando...' : 'Confirmar eliminar'}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Left: detail / edit form */}
        <div className="space-y-4">
          {editMode && canEdit ? (
            <form onSubmit={(e) => void handleSaveEdit(e)} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-900">Editar proyecto</h3>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Título</label>
                <input
                  value={editForm.title ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Tipo de modificación <span className="font-normal text-slate-400">(puede elegir varios)</span></label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(PROJECT_TYPE_LABELS).map(([k, v]) => {
                    const active = (editForm.projectTypes ?? []).includes(k as FleetProject['projectTypes'][number])
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setEditForm((f) => {
                          const current = (f.projectTypes ?? []) as string[]
                          return {
                            ...f,
                            projectTypes: current.includes(k)
                              ? current.filter((t) => t !== k) as FleetProject['projectTypes']
                              : [...current, k] as FleetProject['projectTypes'],
                          }
                        })}
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors ${active ? 'border-violet-500 bg-violet-500 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-violet-300 hover:bg-violet-50'}`}
                      >
                        {v}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Estado</label>
                <select
                  value={editForm.status ?? 'PENDING'}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value as FleetProjectStatus }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                >
                  {fleetProjectStatuses.map((s) => (
                    <option key={s} value={s}>{PROJECT_STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Fecha objetivo</label>
                <input
                  type="date"
                  value={editForm.targetDate ? editForm.targetDate.slice(0, 10) : ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, targetDate: e.target.value }))}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Costo estimado</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.estimatedCost ?? 0}
                    onChange={(e) => setEditForm((f) => ({ ...f, estimatedCost: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Costo real</label>
                  <input
                    type="number"
                    min="0"
                    value={editForm.actualCost ?? 0}
                    onChange={(e) => setEditForm((f) => ({ ...f, actualCost: Number(e.target.value) }))}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Descripción</label>
                <textarea
                  rows={3}
                  value={editForm.description ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Notas de modificación</label>
                <textarea
                  rows={3}
                  value={editForm.modificationNotes ?? ''}
                  onChange={(e) => setEditForm((f) => ({ ...f, modificationNotes: e.target.value }))}
                  placeholder="Qué cambios se realizaron efectivamente..."
                  className="w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
                >
                  {saving ? 'Guardando...' : 'Guardar'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode(false)}
                  className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
              </div>
            </form>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="mb-4 font-bold text-slate-900">Detalles</h3>
              {/* Origin NDP */}
              {project.externalRequestId && (() => {
                const originNdp = unitExternalRequests.find((er) => er.id === project.externalRequestId)
                return originNdp ? (
                  <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
                    <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">Nota de Pedido de Origen</p>
                    <p className="font-bold text-emerald-900">{originNdp.code}</p>
                    {originNdp.companyName && <p className="text-sm text-emerald-700">{originNdp.companyName}</p>}
                    {originNdp.description && <p className="mt-1 text-xs text-emerald-600 line-clamp-2">{originNdp.description}</p>}
                  </div>
                ) : null
              })()}
              <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Unidad</dt>
                  <dd className="font-semibold text-slate-900">{project.unitLabel}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Fecha objetivo</dt>
                  <dd className="text-slate-700">{formatDate(project.targetDate)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Inicio</dt>
                  <dd className="text-slate-700">{formatDate(project.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Completado</dt>
                  <dd className="text-slate-700">{formatDate(project.completedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold text-slate-500">Creado por</dt>
                  <dd className="text-slate-700">{project.createdByUserName}</dd>
                </div>
                {project.estimatedCost > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">Costo estimado</dt>
                    <dd className="text-slate-700">{project.currency} {project.estimatedCost.toLocaleString('es-AR')}</dd>
                  </div>
                )}
                {project.actualCost > 0 && (
                  <div>
                    <dt className="text-xs font-semibold text-slate-500">Costo real</dt>
                    <dd className="text-slate-700">{project.currency} {project.actualCost.toLocaleString('es-AR')}</dd>
                  </div>
                )}
              </dl>
              {project.description && (
                <div className="mt-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-500">Descripción</p>
                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{project.description}</p>
                </div>
              )}
              {project.modificationNotes && (
                <div className="mt-3 border-t border-slate-100 pt-3">
                  <p className="text-xs font-semibold text-slate-500">Notas de modificación</p>
                  <p className="mt-1 text-sm text-slate-700 whitespace-pre-line">{project.modificationNotes}</p>
                </div>
              )}
            </div>
          )}

          {/* Quick status change */}
          {canEdit && !editMode && (
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="mb-2 text-xs font-semibold text-slate-500">Cambiar estado</p>
              <div className="flex flex-wrap gap-2">
                {fleetProjectStatuses.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={saving || project.status === s}
                    onClick={() => void handleStatusChange(s)}
                    className={`rounded-full border px-3 py-1 text-xs font-semibold transition-opacity ${PROJECT_STATUS_COLORS[s]} ${project.status === s ? 'opacity-100 ring-2 ring-offset-1 ring-slate-400' : 'opacity-70 hover:opacity-100'} disabled:cursor-not-allowed`}
                  >
                    {PROJECT_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right: items */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-slate-900">
              Tareas
              {totalCount > 0 && (
                <span className="ml-2 text-sm font-normal text-slate-500">{doneCount}/{totalCount} completadas</span>
              )}
            </h3>
            {canEdit && (
              <button
                type="button"
                onClick={() => setAddingItem((v) => !v)}
                className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {addingItem ? 'Cancelar' : '+ Agregar'}
              </button>
            )}
          </div>

          {addingItem && canEdit && (
            <form onSubmit={(e) => void handleAddItem(e)} className="mb-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <input
                value={itemForm.title}
                onChange={(e) => setItemForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Título de la tarea *"
                autoFocus
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400"
              />
              <input
                value={itemForm.description}
                onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Descripción (opcional)"
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400"
              />
              <select
                value={itemForm.assignedToUserId}
                onChange={(e) => setItemForm((f) => ({ ...f, assignedToUserId: e.target.value }))}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400"
              >
                <option value="">Sin asignar</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
              <button
                type="submit"
                disabled={savingItem || !itemForm.title.trim()}
                className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-50"
              >
                {savingItem ? 'Guardando...' : 'Agregar tarea'}
              </button>
            </form>
          )}

          {project.items.length === 0 && !addingItem && (
            <p className="text-sm text-slate-400">No hay tareas. Agregá una para llevar seguimiento del avance.</p>
          )}

          <ul className="space-y-2">
            {project.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="shrink-0 pt-0.5">
                  <select
                    value={item.status}
                    onChange={(e) => void handleItemStatusChange(item, e.target.value)}
                    disabled={!canEdit}
                    className={`border-0 bg-transparent text-base font-bold outline-none ${ITEM_STATUS_COLORS[item.status]} cursor-pointer`}
                    title="Cambiar estado"
                  >
                    {fleetProjectItemStatuses.map((s) => (
                      <option key={s} value={s}>{ITEM_STATUS_ICONS[s]} {ITEM_STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-0 flex-1">
                  {editingItemId === item.id ? (
                    <div className="flex gap-2">
                      <input
                        value={editingItemTitle}
                        onChange={(e) => setEditingItemTitle(e.target.value)}
                        autoFocus
                        className="flex-1 rounded border border-slate-300 bg-white px-2 py-0.5 text-sm outline-none focus:border-amber-400"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleSaveItemTitle(item)
                          if (e.key === 'Escape') setEditingItemId(null)
                        }}
                      />
                      <button type="button" onClick={() => void handleSaveItemTitle(item)} className="text-xs font-semibold text-emerald-600">OK</button>
                      <button type="button" onClick={() => setEditingItemId(null)} className="text-xs text-slate-400">✕</button>
                    </div>
                  ) : (
                    <span
                      className={`text-sm font-medium ${item.status === 'DONE' ? 'text-slate-400 line-through' : item.status === 'SKIPPED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}
                      onDoubleClick={() => {
                        if (canEdit) {
                          setEditingItemId(item.id)
                          setEditingItemTitle(item.title)
                        }
                      }}
                    >
                      {item.title}
                    </span>
                  )}
                  {item.assignedToUserName && (
                    <p className="text-xs text-slate-400">{item.assignedToUserName}</p>
                  )}
                </div>
                {canEdit && editingItemId !== item.id && (
                  <button
                    type="button"
                    onClick={() => void handleDeleteItem(item)}
                    className="shrink-0 text-xs text-slate-300 hover:text-rose-500"
                    title="Eliminar tarea"
                  >
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Linked work orders */}
      <LinkedSection
        title="Órdenes de Trabajo vinculadas"
        linkedIds={project.linkedWorkOrderIds}
        allItems={unitWorkOrders.filter((wo) => wo.unitId === project.unitId)}
        getId={(wo) => wo.id}
        renderItem={(wo) => (
          <span className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{wo.code || wo.id.slice(0, 8)}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${wo.status === 'CLOSED' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : wo.status === 'IN_PROGRESS' ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-300 bg-slate-50 text-slate-600'}`}>
              {wo.status === 'OPEN' ? 'Abierta' : wo.status === 'IN_PROGRESS' ? 'En progreso' : 'Cerrada'}
            </span>
          </span>
        )}
        renderCandidate={(wo) => `${wo.code || wo.id.slice(0, 8)} — ${wo.status}`}
        searchOpen={woSearchOpen}
        setSearchOpen={setWoSearchOpen}
        onLink={(id) => void handleLinkWorkOrder(id)}
        onUnlink={(id) => void handleUnlinkWorkOrder(id)}
        canEdit={canEdit}
      />

      {/* Linked external requests */}
      <LinkedSection
        title="Notas de Pedido Externo vinculadas"
        linkedIds={project.linkedExternalRequestIds}
        allItems={unitExternalRequests.filter((er) => er.unitId === project.unitId)}
        getId={(er) => er.id}
        renderItem={(er) => (
          <span className="flex items-center gap-2">
            <span className="font-semibold text-slate-800">{er.code}</span>
            {er.companyName && <span className="text-slate-500">{er.companyName}</span>}
            {er.eligibilityStatus && (
              <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${er.eligibilityStatus === 'READY_FOR_REPAIR' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-amber-300 bg-amber-50 text-amber-700'}`}>
                {er.eligibilityStatus === 'READY_FOR_REPAIR' ? 'Con adjunto' : 'Sin adjunto'}
              </span>
            )}
            {er.ocCode && <span className="rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-700">OC {er.ocCode}</span>}
          </span>
        )}
        renderCandidate={(er) => `${er.code}${er.companyName ? ` — ${er.companyName}` : ''}`}
        searchOpen={ndpSearchOpen}
        setSearchOpen={setNdpSearchOpen}
        onLink={(id) => void handleLinkExternalRequest(id)}
        onUnlink={(id) => void handleUnlinkExternalRequest(id)}
        canEdit={canEdit}
      />
    </section>
  )
}

function LinkedSection<T>({
  title,
  linkedIds,
  allItems,
  getId,
  renderItem,
  renderCandidate,
  searchOpen,
  setSearchOpen,
  onLink,
  onUnlink,
  canEdit,
}: {
  title: string
  linkedIds: string[]
  allItems: T[]
  getId: (item: T) => string
  renderItem: (item: T) => React.ReactNode
  renderCandidate: (item: T) => string
  searchOpen: boolean
  setSearchOpen: (v: boolean) => void
  onLink: (id: string) => void
  onUnlink: (id: string) => void
  canEdit: boolean
}) {
  const [search, setSearch] = useState('')
  const linked = allItems.filter((item) => linkedIds.includes(getId(item)))
  const candidates = allItems.filter(
    (item) => !linkedIds.includes(getId(item)) &&
      (!search.trim() || renderCandidate(item).toLowerCase().includes(search.trim().toLowerCase()))
  ).slice(0, 20)

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-slate-900">{title}</h3>
        {canEdit && (
          <button
            type="button"
            onClick={() => { setSearchOpen(!searchOpen); setSearch('') }}
            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {searchOpen ? 'Cancelar' : '+ Vincular'}
          </button>
        )}
      </div>

      {searchOpen && canEdit && (
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            autoFocus
            className="mb-2 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-amber-400"
          />
          {candidates.length === 0 && (
            <p className="text-xs text-slate-400">{allItems.length === 0 ? 'No hay items para esta unidad.' : 'No hay coincidencias.'}</p>
          )}
          <ul className="max-h-40 overflow-y-auto space-y-1">
            {candidates.map((item) => (
              <li key={getId(item)}>
                <button
                  type="button"
                  onClick={() => onLink(getId(item))}
                  className="w-full rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-white hover:shadow-sm"
                >
                  {renderCandidate(item)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {linked.length === 0 && !searchOpen && (
        <p className="text-sm text-slate-400">Sin vínculos. {canEdit ? 'Usá "+ Vincular" para agregar.' : ''}</p>
      )}

      <ul className="space-y-2">
        {linked.map((item) => (
          <li key={getId(item)} className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="min-w-0 flex-1 text-sm">{renderItem(item)}</div>
            {canEdit && (
              <button
                type="button"
                onClick={() => onUnlink(getId(item))}
                className="shrink-0 text-xs text-slate-300 hover:text-rose-500"
                title="Desvincular"
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
