import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { Supplier } from '../../../types/domain'

type SupplierFormState = {
  name: string
  serviceType: string
  contactName: string
  contactPhone: string
  contactEmail: string
  notes: string
  isActive: boolean
}

const createEmptyForm = (): SupplierFormState => ({
  name: '',
  serviceType: '',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  isActive: true,
})

const formatMoney = (value: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(value)

export const SuppliersPage = () => {
  const { can } = usePermissions()
  const {
    state: { suppliers, repairs, featureFlags },
    actions: { setSuppliers, setAppError },
  } = useAppContext()

  const canCreate = can('REPAIRS', 'create')
  const canEdit = can('REPAIRS', 'edit')
  const canDelete = can('REPAIRS', 'delete')

  const [form, setForm] = useState<SupplierFormState>(createEmptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const filteredSuppliers = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) {
      return suppliers
    }
    return suppliers.filter((item) =>
      [item.name, item.serviceType, item.contactName, item.contactEmail, item.contactPhone].join(' ').toLowerCase().includes(query),
    )
  }, [suppliers, search])

  const supplierMetrics = useMemo(() => {
    const map = new Map<string, { repairs: number; totalCost: number }>()
    repairs.forEach((repair) => {
      const key = repair.supplierName?.trim() || 'Sin proveedor'
      const current = map.get(key) ?? { repairs: 0, totalCost: 0 }
      current.repairs += 1
      current.totalCost += repair.realCost ?? 0
      map.set(key, current)
    })
    return map
  }, [repairs])

  if (!featureFlags.showSuppliersModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Proveedores</h2>
        <p className="mt-2 text-sm text-slate-600">Este modulo esta deshabilitado por configuracion.</p>
      </section>
    )
  }

  const resetForm = () => {
    setEditingId(null)
    setForm(createEmptyForm())
  }

  const handleSubmit = async () => {
    if (editingId ? !canEdit : !canCreate) {
      return
    }
    if (!form.name.trim()) {
      setAppError('El nombre del proveedor es obligatorio.')
      return
    }

    setIsSaving(true)
    try {
      if (editingId) {
        const updated = await apiRequest<Supplier>(`/suppliers/${editingId}`, {
          method: 'PATCH',
          body: form,
        })
        setSuppliers(suppliers.map((item) => (item.id === editingId ? updated : item)))
      } else {
        const created = await apiRequest<Supplier>('/suppliers', {
          method: 'POST',
          body: form,
        })
        setSuppliers([created, ...suppliers])
      }
      resetForm()
    } catch {
      setAppError('No se pudo guardar el proveedor.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (supplierId: string) => {
    if (!canEdit) {
      return
    }
    const selected = suppliers.find((item) => item.id === supplierId)
    if (!selected) {
      return
    }
    setEditingId(selected.id)
    setForm({
      name: selected.name,
      serviceType: selected.serviceType ?? '',
      contactName: selected.contactName ?? '',
      contactPhone: selected.contactPhone ?? '',
      contactEmail: selected.contactEmail ?? '',
      notes: selected.notes ?? '',
      isActive: selected.isActive,
    })
  }

  const handleDelete = async (supplierId: string) => {
    if (!canDelete) {
      return
    }
    const selected = suppliers.find((item) => item.id === supplierId)
    if (!selected) {
      return
    }
    const confirmed = window.confirm(`¿Estas seguro que deseas eliminar al proveedor "${selected.name}"?`)
    if (!confirmed) {
      return
    }
    try {
      await apiRequest(`/suppliers/${supplierId}`, { method: 'DELETE' })
      setSuppliers(suppliers.filter((item) => item.id !== supplierId))
    } catch {
      setAppError('No se pudo eliminar el proveedor. Verifica si tiene reparaciones vinculadas.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Proveedores</h2>
        <p className="text-sm text-slate-600">
          Maestro de proveedores para estandarizar reparaciones y mejorar reportes por costo y volumen.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-1">
          <h3 className="text-lg font-bold text-slate-900">{editingId ? 'Editar proveedor' : 'Nuevo proveedor'}</h3>
          <form
            className="mt-4 grid grid-cols-1 gap-3"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Nombre del proveedor"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
            <input
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
              placeholder="Rubro / servicio"
              value={form.serviceType}
              onChange={(event) => setForm((prev) => ({ ...prev, serviceType: event.target.value }))}
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
              Proveedor activo
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
                {isSaving ? 'Guardando...' : editingId ? 'Guardar cambios' : 'Crear proveedor'}
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">Listado de proveedores</h3>
              <p className="text-sm text-slate-600">Comparativa operativa de reparaciones y costo acumulado.</p>
            </div>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              placeholder="Buscar proveedor..."
            />
          </div>
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {filteredSuppliers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                No hay proveedores para el filtro seleccionado.
              </div>
            ) : (
              filteredSuppliers.map((supplier) => {
                const metrics = supplierMetrics.get(supplier.name) ?? { repairs: 0, totalCost: 0 }
                return (
                  <article key={supplier.id} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-base font-bold text-slate-900">{supplier.name}</p>
                        <p className="text-xs text-slate-600">{supplier.serviceType || 'Sin rubro especificado'}</p>
                      </div>
                      <span
                        className={[
                          'rounded-full border px-2 py-1 text-[10px] font-semibold',
                          supplier.isActive
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                            : 'border-slate-300 bg-slate-100 text-slate-600',
                        ].join(' ')}
                      >
                        {supplier.isActive ? 'ACTIVO' : 'INACTIVO'}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-600">
                      <p>Contacto: {supplier.contactName || '-'}</p>
                      <p>Tel: {supplier.contactPhone || '-'}</p>
                      <p>Reparaciones: {metrics.repairs}</p>
                      <p>Costo acumulado: {formatMoney(metrics.totalCost)}</p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => handleEdit(supplier.id)}
                        disabled={!canEdit}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-700 disabled:opacity-50"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(supplier.id)}
                        disabled={!canDelete}
                        className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 disabled:opacity-50"
                      >
                        Eliminar
                      </button>
                    </div>
                  </article>
                )
              })
            )}
          </div>
        </section>
      </div>
    </section>
  )
}
