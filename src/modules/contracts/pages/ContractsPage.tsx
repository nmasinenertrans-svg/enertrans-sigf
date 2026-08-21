import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { RentalContractStatus } from '../../../types/domain'
import {
  buildContractView,
  createEmptyContractFormData,
  toContractFormData,
  toContractPayload,
  validateContractFormData,
} from '../services/contractsService'
import type { ContractFormData, ContractFormErrors, ContractFormField } from '../types'

const statusLabels: Record<RentalContractStatus, string> = {
  ACTIVE: 'Activo',
  FINISHED: 'Finalizado',
  CANCELLED: 'Cancelado',
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

const formatCurrency = (value: number, currency: 'ARS' | 'USD') =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value)

const formatDate = (value: string) => {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-AR')
}

const expirationBadge = (daysUntilExpiration: number, status: RentalContractStatus) => {
  if (status !== 'ACTIVE') {
    return { label: statusLabels[status], className: 'border-slate-200 bg-slate-50 text-slate-600' }
  }
  if (daysUntilExpiration < 0) {
    return { label: `Vencido hace ${Math.abs(daysUntilExpiration)} d.`, className: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (daysUntilExpiration <= 7) {
    return { label: `Vence en ${daysUntilExpiration} d.`, className: 'border-rose-200 bg-rose-50 text-rose-700' }
  }
  if (daysUntilExpiration <= 30) {
    return { label: `Vence en ${daysUntilExpiration} d.`, className: 'border-amber-200 bg-amber-50 text-amber-700' }
  }
  return { label: 'Activo', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' }
}

export const ContractsPage = () => {
  const {
    state: { fleetUnits, clients, contracts },
    actions: { setContracts, setAppError },
  } = useAppContext()

  const [formData, setFormData] = useState<ContractFormData>(createEmptyContractFormData)
  const [errors, setErrors] = useState<ContractFormErrors>({})
  const [editingContractId, setEditingContractId] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const [contractIdPendingDelete, setContractIdPendingDelete] = useState<string | null>(null)

  const contractView = useMemo(() => buildContractView(contracts, fleetUnits), [contracts, fleetUnits])

  const filteredUnits = useMemo(() => {
    const query = unitSearch.trim().toLowerCase()
    if (!query) return fleetUnits.slice(0, 8)
    return fleetUnits
      .filter((unit) => `${unit.internalCode} ${unit.brand} ${unit.model}`.toLowerCase().includes(query))
      .slice(0, 8)
  }, [fleetUnits, unitSearch])

  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)

  const handleFieldChange = <TField extends ContractFormField>(field: TField, value: ContractFormData[TField]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const resetForm = () => {
    setEditingContractId(null)
    setErrors({})
    setFormData(createEmptyContractFormData())
  }

  const handleSubmit = async () => {
    const validationErrors = validateContractFormData(formData)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      const payload = toContractPayload(formData)
      if (editingContractId) {
        const updated = await apiRequest(`/contracts/${editingContractId}`, { method: 'PATCH', body: payload })
        setContracts(contracts.map((contract) => (contract.id === editingContractId ? (updated as any) : contract)))
      } else {
        const created = await apiRequest('/contracts', { method: 'POST', body: payload })
        setContracts([created as any, ...contracts])
      }
      resetForm()
    } catch {
      setAppError('No se pudo guardar el contrato.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleEdit = (contractId: string) => {
    const contract = contracts.find((item) => item.id === contractId)
    if (!contract) return
    setEditingContractId(contractId)
    setFormData(toContractFormData(contract))
  }

  const handleConfirmDelete = async () => {
    if (!contractIdPendingDelete) return
    const idToDelete = contractIdPendingDelete
    setContractIdPendingDelete(null)
    try {
      await apiRequest(`/contracts/${idToDelete}`, { method: 'DELETE' })
      setContracts(contracts.filter((contract) => contract.id !== idToDelete))
      if (editingContractId === idToDelete) {
        resetForm()
      }
    } catch {
      setAppError('No se pudo eliminar el contrato.')
    }
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Contratos de alquiler</h2>
        <p className="text-sm text-slate-600">
          Vencimientos, valor mensual y cliente por unidad. Cuando falta una semana para el vencimiento se avisa
          automaticamente por notificacion.
        </p>
      </header>

      <div className="grid gap-4 xl:grid-cols-3">
        <article className="xl:col-span-1 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-lg font-bold text-slate-900">{editingContractId ? 'Editar contrato' : 'Nuevo contrato'}</h3>

          <form
            className="mt-4 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void handleSubmit()
            }}
          >
            <div>
              <label className="text-sm font-semibold text-slate-700">Unidad</label>
              {selectedUnit ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <span>
                    {selectedUnit.internalCode} - {selectedUnit.brand} {selectedUnit.model}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleFieldChange('unitId', '')}
                    className="font-semibold text-amber-700 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={`${inputClassName} mt-1`}
                    value={unitSearch}
                    onChange={(event) => setUnitSearch(event.target.value)}
                    placeholder="Buscar por dominio, marca o modelo..."
                  />
                  <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {filteredUnits.map((unit) => (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => handleFieldChange('unitId', unit.id)}
                        className="block w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-left text-xs text-slate-700 hover:bg-slate-100"
                      >
                        {unit.internalCode} - {unit.brand} {unit.model}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {errors.unitId ? <p className="mt-1 text-xs text-rose-600">{errors.unitId}</p> : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Cliente</label>
              <select
                className={`${inputClassName} mt-1`}
                value={formData.clientId}
                onChange={(event) => {
                  const clientId = event.target.value
                  const client = clients.find((item) => item.id === clientId)
                  handleFieldChange('clientId', clientId)
                  if (client) handleFieldChange('clientName', client.name)
                }}
              >
                <option value="">Sin cliente registrado</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
              <input
                className={`${inputClassName} mt-2`}
                value={formData.clientName}
                onChange={(event) => handleFieldChange('clientName', event.target.value)}
                placeholder="Nombre del cliente (o corregilo si no esta registrado)"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Fecha inicio</label>
                <input
                  type="date"
                  className={`${inputClassName} mt-1`}
                  value={formData.startDate}
                  onChange={(event) => handleFieldChange('startDate', event.target.value)}
                />
                {errors.startDate ? <p className="mt-1 text-xs text-rose-600">{errors.startDate}</p> : null}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Fecha fin</label>
                <input
                  type="date"
                  className={`${inputClassName} mt-1`}
                  value={formData.endDate}
                  onChange={(event) => handleFieldChange('endDate', event.target.value)}
                />
                {errors.endDate ? <p className="mt-1 text-xs text-rose-600">{errors.endDate}</p> : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-semibold text-slate-700">Valor mensual</label>
                <input
                  type="text"
                  inputMode="decimal"
                  className={`${inputClassName} mt-1`}
                  value={formData.monthlyValueInput}
                  onChange={(event) => handleFieldChange('monthlyValueInput', event.target.value)}
                  placeholder="0.00"
                />
                {errors.monthlyValueInput ? <p className="mt-1 text-xs text-rose-600">{errors.monthlyValueInput}</p> : null}
              </div>
              <div>
                <label className="text-sm font-semibold text-slate-700">Moneda</label>
                <select
                  className={`${inputClassName} mt-1`}
                  value={formData.currency}
                  onChange={(event) => handleFieldChange('currency', event.target.value as ContractFormData['currency'])}
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Estado</label>
              <select
                className={`${inputClassName} mt-1`}
                value={formData.status}
                onChange={(event) => handleFieldChange('status', event.target.value as ContractFormData['status'])}
              >
                <option value="ACTIVE">Activo</option>
                <option value="FINISHED">Finalizado</option>
                <option value="CANCELLED">Cancelado</option>
              </select>
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-700">Notas (opcional)</label>
              <textarea
                className={`${inputClassName} mt-1`}
                rows={2}
                value={formData.notes}
                onChange={(event) => handleFieldChange('notes', event.target.value)}
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              {editingContractId ? (
                <button
                  type="button"
                  onClick={resetForm}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </button>
              ) : null}
              <button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500 disabled:opacity-70"
              >
                {isSaving ? 'Guardando...' : editingContractId ? 'Guardar cambios' : 'Crear contrato'}
              </button>
            </div>
          </form>
        </article>

        <div className="xl:col-span-2 space-y-3">
          {contractView.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500 shadow-sm">
              Todavia no hay contratos cargados.
            </div>
          ) : (
            contractView.map((contract) => {
              const badge = expirationBadge(contract.daysUntilExpiration, contract.status)
              return (
                <article key={contract.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {contract.code || contract.id.slice(0, 8)}
                      </p>
                      <h3 className="mt-0.5 text-base font-bold text-slate-900">{contract.unitLabel}</h3>
                      <p className="text-xs text-slate-500">{contract.clientName || 'Sin cliente'}</p>
                    </div>
                    <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${badge.className}`}>
                      {badge.label}
                    </span>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                    <p>Inicio: {formatDate(contract.startDate)}</p>
                    <p>Fin: {formatDate(contract.endDate)}</p>
                    <p>Valor: {formatCurrency(contract.monthlyValue, contract.currency)}/mes</p>
                    <p>Estado: {statusLabels[contract.status]}</p>
                  </div>

                  {contract.notes ? <p className="mt-2 text-xs text-slate-600">{contract.notes}</p> : null}

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => handleEdit(contract.id)}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => setContractIdPendingDelete(contract.id)}
                      className="rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                    >
                      Eliminar
                    </button>
                  </div>
                </article>
              )
            })
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={Boolean(contractIdPendingDelete)}
        title="Eliminar contrato"
        message="¿Eliminar este contrato? Esta accion no se puede deshacer."
        onConfirm={handleConfirmDelete}
        onCancel={() => setContractIdPendingDelete(null)}
      />
    </section>
  )
}
