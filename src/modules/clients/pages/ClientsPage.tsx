import { useEffect, useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { ClientAccount, FleetUnit } from '../../../types/domain'

type ClientFormState = {
  name: string
  legalName: string
  taxId: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  isActive: boolean
}

const createEmptyForm = (): ClientFormState => ({
  name: '',
  legalName: '',
  taxId: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  isActive: true,
})

const normalize = (value: string) => value.trim().toLowerCase()

export const ClientsPage = () => {
  const { can } = usePermissions()
  const {
    state: { clients, fleetUnits, featureFlags },
    actions: { setClients, setFleetUnits, setAppError },
  } = useAppContext()

  const canCreate = can('FLEET', 'create')
  const canEdit = can('FLEET', 'edit')
  const canDelete = can('FLEET', 'delete')

  const [form, setForm] = useState<ClientFormState>(createEmptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedClientId, setSelectedClientId] = useState<string>('')
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([])
  const [unitSearch, setUnitSearch] = useState('')
  const [isEditingAssignments, setIsEditingAssignments] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isAssigning, setIsAssigning] = useState(false)

  const getAssignedUnitIds = (clientId: string) => {
    const selectedClient = clients.find((item) => item.id === clientId)
    if (!selectedClient) {
      return []
    }
    return fleetUnits
      .filter(
        (unit) =>
          unit.clientId === clientId ||
          (normalize(unit.clientName || '') && normalize(unit.clientName || '') === normalize(selectedClient.name)),
      )
      .map((unit) => unit.id)
  }

  useEffect(() => {
    if (!selectedClientId) {
      setSelectedUnitIds([])
      setIsEditingAssignments(false)
      return
    }
    setSelectedUnitIds(getAssignedUnitIds(selectedClientId))
    setIsEditingAssignments(false)
    setUnitSearch('')
  }, [selectedClientId, clients, fleetUnits])

  const filteredClients = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return clients
    }
    return clients.filter((item) => {
      const fullText = [
        item.name,
        item.legalName,
        item.taxId,
        item.contactName,
        item.contactEmail,
        item.contactPhone,
      ]
        .join(' ')
        .toLowerCase()
      return fullText.includes(query)
    })
  }, [clients, search])

  const selectableUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    const base = fleetUnits
      .slice()
      .sort((a, b) => a.internalCode.localeCompare(b.internalCode))
      .filter((unit) => {
        if (!query) {
          return true
        }
        const text = `${unit.internalCode} ${unit.ownerCompany} ${unit.clientName} ${unit.brand} ${unit.model}`.toLowerCase()
        return text.includes(query)
      })

    if (isEditingAssignments) {
      return base
    }

    const selectedIds = new Set(selectedUnitIds)
    return base.filter((unit) => selectedIds.has(unit.id))
  }, [fleetUnits, isEditingAssignments, selectedUnitIds, unitSearch])

  if (!featureFlags.showClientsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Clientes</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const resetForm = () => {
    setForm(createEmptyForm())
    setEditingId(null)
  }

  const handleSubmit = async () => {
    if (editingId ? !canEdit : !canCreate) {
      return
    }
    if (!form.name.trim()) {
      setAppError('El nombre del cliente es obligatorio.')
      return
    }

    setIsSaving(true)
    try {
      if (editingId) {
        const updated = await apiRequest<ClientAccount>(`/clients/${editingId}`, {
          method: 'PATCH',
          body: form,
        })
        setClients(clients.map((item) => (item.id === editingId ? updated : item)))
      } else {
        const created = await apiRequest<ClientAccount>('/clients', {
          method: 'POST',
          body: form,
        })
        setClients([created, ...clients])
      }
      resetForm()
    } catch {
      setAppError('No se pudo guardar el cliente.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (clientId: string) => {
    if (!canEdit) {
      return
    }
    const selected = clients.find((item) => item.id === clientId)
    if (!selected) {
      return
    }
    setEditingId(selected.id)
    setForm({
      name: selected.name,
      legalName: selected.legalName ?? '',
      taxId: selected.taxId ?? '',
      contactName: selected.contactName ?? '',
      contactPhone: selected.contactPhone ?? '',
      contactEmail: selected.contactEmail ?? '',
      notes: selected.notes ?? '',
      isActive: selected.isActive,
    })
  }

  const handleDelete = async (clientId: string) => {
    if (!canDelete) {
      return
    }
    const selected = clients.find((item) => item.id === clientId)
    if (!selected) {
      return
    }
    const confirmed = window.confirm(`¿Estas seguro que deseas eliminar al cliente "${selected.name}"?`)
    if (!confirmed) {
      return
    }

    try {
      await apiRequest(`/clients/${clientId}`, { method: 'DELETE' })
      setClients(clients.filter((item) => item.id !== clientId))
      if (selectedClientId === clientId) {
        setSelectedClientId('')
      }
    } catch {
      setAppError('No se pudo eliminar el cliente. Verifica que no tenga unidades o historial asociado.')
    }
  }

  const handleSaveAssignments = async () => {
    if (!canEdit || !selectedClientId) {
      return
    }
    setIsAssigning(true)
    try {
      await apiRequest(`/clients/${selectedClientId}/assign-units`, {
        method: 'PATCH',
        body: { unitIds: selectedUnitIds },
      })

      const [updatedClients, updatedFleet] = await Promise.all([
        apiRequest<ClientAccount[]>('/clients'),
        apiRequest<FleetUnit[]>('/fleet'),
      ])
      setClients(updatedClients)
      setFleetUnits(updatedFleet)
      setIsEditingAssignments(false)
      setUnitSearch('')
      setAppError('Asignacion de unidades actualizada.')
    } catch {
      setAppError('No se pudo guardar la asignacion de unidades.')
    } finally {
      setIsAssigning(false)
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Clientes</h2>
        <p className="text-sm text-slate-600">
          Maestro de clientes y asignacion centralizada de unidades para mejorar trazabilidad operativa.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Editar cliente' : 'Nuevo cliente'}</h3>
          <form
            className="mt-4 grid grid-cols-1 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nombre comercial"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Razón social"
              value={form.legalName}
              onChange={(event) => setForm((prev) => ({ ...prev, legalName: event.target.value }))}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="CUIT"
              value={form.taxId}
              onChange={(event) => setForm((prev) => ({ ...prev, taxId: event.target.value }))}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Contacto"
              value={form.contactName}
              onChange={(event) => setForm((prev) => ({ ...prev, contactName: event.target.value }))}
            />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Teléfono"
                value={form.contactPhone}
                onChange={(event) => setForm((prev) => ({ ...prev, contactPhone: event.target.value }))}
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Email"
                value={form.contactEmail}
                onChange={(event) => setForm((prev) => ({ ...prev, contactEmail: event.target.value }))}
              />
            </div>
            <textarea
              className="min-h-[90px] rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Observaciones"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
            />
            <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(event) => setForm((prev) => ({ ...prev, isActive: event.target.checked }))}
              />
              Cliente activo
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              {editingId ? (
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                  onClick={resetForm}
                >
                  Cancelar
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
              >
                {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear cliente'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Asignacion de unidades por cliente</h3>
              <p className="text-sm text-slate-600">Selecciona cliente y define su cartera de unidades.</p>
            </div>
            <select
              value={selectedClientId}
              onChange={(event) => setSelectedClientId(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="">Seleccionar cliente</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </div>

          {selectedClientId ? (
            <div className="mt-4 space-y-3">
              <input
                value={unitSearch}
                onChange={(event) => setUnitSearch(event.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder={
                  isEditingAssignments
                    ? 'Buscar unidad por dominio, cliente o empresa...'
                    : 'Buscar entre las unidades asociadas...'
                }
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-slate-600">
                  {isEditingAssignments
                    ? 'Modo edicion activo: puedes modificar la cartera.'
                    : `Unidades asociadas: ${selectableUnits.length}`}
                </p>
                {canEdit ? (
                  <div className="flex flex-wrap gap-2">
                    {isEditingAssignments ? (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                        onClick={() => {
                          setSelectedUnitIds(getAssignedUnitIds(selectedClientId))
                          setIsEditingAssignments(false)
                          setUnitSearch('')
                        }}
                      >
                        Cancelar edicion
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                        onClick={() => setIsEditingAssignments(true)}
                      >
                        Editar asignacion
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {selectableUnits.length === 0 ? (
                    <p className="col-span-full rounded-lg border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs text-slate-500">
                      {isEditingAssignments
                        ? 'No hay unidades para este filtro.'
                        : 'Este cliente no tiene unidades asociadas en el filtro actual.'}
                    </p>
                  ) : null}
                  {selectableUnits.map((unit) => {
                    const checked = selectedUnitIds.includes(unit.id)
                    return (
                      <label
                        key={unit.id}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs"
                      >
                        {isEditingAssignments ? (
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) =>
                              setSelectedUnitIds((prev) => {
                                if (event.target.checked) {
                                  return prev.includes(unit.id) ? prev : [...prev, unit.id]
                                }
                                return prev.filter((id) => id !== unit.id)
                              })
                            }
                          />
                        ) : (
                          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                        )}
                        <span className="font-semibold text-slate-800">{unit.internalCode}</span>
                        <span className="text-slate-600">{unit.ownerCompany}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
              {isEditingAssignments ? (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleSaveAssignments()}
                    disabled={isAssigning || !canEdit}
                    className="rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-60"
                  >
                    {isAssigning ? 'Guardando...' : 'Guardar asignacion'}
                  </button>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-600">Elige un cliente para asignarle unidades.</p>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">Listado de clientes</h3>
            <p className="text-sm text-slate-600">Control de cartera y actividad.</p>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            placeholder="Buscar cliente..."
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filteredClients.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2 xl:col-span-3">
              No hay clientes para el filtro seleccionado.
            </div>
          ) : (
            filteredClients.map((client) => (
              <article key={client.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-slate-900">{client.name}</p>
                    <p className="text-xs text-slate-600">{client.legalName || 'Sin razon social'}</p>
                  </div>
                  <span
                    className={[
                      'rounded-full border px-2 py-1 text-[10px] font-semibold',
                      client.isActive
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                        : 'border-slate-300 bg-slate-100 text-slate-600',
                    ].join(' ')}
                  >
                    {client.isActive ? 'ACTIVO' : 'INACTIVO'}
                  </span>
                </div>
                <div className="mt-2 space-y-1 text-xs text-slate-600">
                  <p>CUIT: {client.taxId || 'Sin dato'}</p>
                  <p>Contacto: {client.contactName || '-'}</p>
                  <p>Unidades: {client._count?.units ?? 0}</p>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(client.id)}
                    disabled={!canEdit}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(client.id)}
                    disabled={!canDelete}
                    className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                  >
                    Eliminar
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </section>
  )
}
