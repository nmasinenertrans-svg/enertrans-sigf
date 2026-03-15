import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { RepairCostCard } from '../components/RepairCostCard'
import { RepairsForm } from '../components/RepairsForm'
import { RepairsHistoryCard } from '../components/RepairsHistoryCard'
import {
  buildRepairView,
  createEmptyRepairFormData,
  mergeRepairFromForm,
  toRepairFormData,
  toRepairRecord,
  validateRepairFormData,
} from '../services/repairsService'
import type { RepairFormData, RepairFormErrors, RepairFormField } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { apiRequest } from '../../../services/api/apiClient'
import { BackLink } from '../../../components/shared/BackLink'

const allUnitsFilter = 'ALL'

export const RepairsPage = () => {
  const { can } = usePermissions()
  const {
    state: { fleetUnits, workOrders, externalRequests, repairs, suppliers },
    actions: { setRepairs },
  } = useAppContext()

  const canCreate = can('REPAIRS', 'create')
  const canEdit = can('REPAIRS', 'edit')
  const canDelete = can('REPAIRS', 'delete')

  const [formData, setFormData] = useState<RepairFormData>(() => createEmptyRepairFormData(workOrders[0]?.id ?? ''))
  const [errors, setErrors] = useState<RepairFormErrors>({})
  const [editingRepairId, setEditingRepairId] = useState<string | null>(null)
  const [unitFilter, setUnitFilter] = useState<string>(allUnitsFilter)
  const [repairIdPendingDelete, setRepairIdPendingDelete] = useState<string | null>(null)

  const repairViewList = useMemo(
    () => buildRepairView(repairs, workOrders, externalRequests, fleetUnits),
    [repairs, workOrders, externalRequests, fleetUnits],
  )

  const filteredRepairs = useMemo(
    () => (unitFilter === allUnitsFilter ? repairViewList : repairViewList.filter((item) => item.unitId === unitFilter)),
    [repairViewList, unitFilter],
  )

  const summary = useMemo(
    () =>
      repairViewList.reduce(
        (accumulator, item) => {
          accumulator.totalRepairs += 1
          const bucket = item.currency === 'USD' ? accumulator.totalsByCurrency.USD : accumulator.totalsByCurrency.ARS
          bucket.repairs += 1
          bucket.realCost += item.realCost
          bucket.invoiced += item.invoicedToClient
          bucket.margin += item.margin
          return accumulator
        },
        {
          totalRepairs: 0,
          totalsByCurrency: {
            ARS: { repairs: 0, realCost: 0, invoiced: 0, margin: 0 },
            USD: { repairs: 0, realCost: 0, invoiced: 0, margin: 0 },
          },
        },
      ),
    [repairViewList],
  )

  const resetForm = () => {
    setEditingRepairId(null)
    setErrors({})
    setFormData(createEmptyRepairFormData(workOrders[0]?.id ?? ''))
  }

  const handleFieldChange = <TField extends RepairFormField>(field: TField, value: RepairFormData[TField]) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      [field]: value,
    }))

    setErrors((previousErrors) => ({
      ...previousErrors,
      [field]: undefined,
    }))
  }

  const handleSubmit = async () => {
    if (editingRepairId ? !canEdit : !canCreate) {
      return
    }

    const validationErrors = validateRepairFormData(formData, workOrders, externalRequests)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    const ensureInvoiceUpload = async (data: RepairFormData): Promise<RepairFormData> => {
      if (!data.invoiceFileBase64 || data.invoiceFileUrl || typeof navigator === 'undefined' || !navigator.onLine) {
        return data
      }
      try {
        const response = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: data.invoiceFileName || `repair-${Date.now()}.pdf`,
            contentType: 'application/octet-stream',
            dataUrl: data.invoiceFileBase64,
            folder: 'repairs',
          },
        })
        return { ...data, invoiceFileUrl: response.url, invoiceFileBase64: '' }
      } catch {
        return data
      }
    }

    if (editingRepairId) {
      const selectedRepair = repairs.find((repair) => repair.id === editingRepairId)

      if (!selectedRepair) {
        resetForm()
        return
      }

      const preparedFormData = await ensureInvoiceUpload(formData)
      const updatedRepair = mergeRepairFromForm(selectedRepair, preparedFormData, workOrders, externalRequests)
      setRepairs(repairs.map((repair) => (repair.id === editingRepairId ? updatedRepair : repair)))
      if (typeof navigator !== 'undefined' && navigator.onLine) {
        apiRequest(`/repairs/${editingRepairId}`, { method: 'PATCH', body: updatedRepair }).catch(() => null)
      }
      resetForm()
      return
    }

    const preparedFormData = await ensureInvoiceUpload(formData)
    const createdRepair = toRepairRecord(preparedFormData, workOrders, externalRequests)
    setRepairs([createdRepair, ...repairs])
    enqueueAndSync({
      id: `repair.create.${createdRepair.id}`,
      type: 'repair.create',
      payload: createdRepair,
      createdAt: new Date().toISOString(),
    })
    resetForm()
  }

  const handleEdit = (repairId: string) => {
    if (!canEdit) {
      return
    }

    const selectedRepair = repairs.find((repair) => repair.id === repairId)

    if (!selectedRepair) {
      return
    }

    setEditingRepairId(repairId)
    setFormData(toRepairFormData(selectedRepair))
  }

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!repairIdPendingDelete) {
      return
    }

    setRepairs(repairs.filter((repair) => repair.id !== repairIdPendingDelete))

    if (editingRepairId === repairIdPendingDelete) {
      resetForm()
    }

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      apiRequest(`/repairs/${repairIdPendingDelete}`, { method: 'DELETE' }).catch(() => null)
    }

    setRepairIdPendingDelete(null)
  }

  if (workOrders.length === 0 && externalRequests.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Reparaciones</h2>
        <p className="mt-2 text-sm text-slate-600">Primero necesitas registrar una OT o una nota externa.</p>
        <Link
          to={ROUTE_PATHS.workOrders}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Ir a Ordenes de Trabajo
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Reparaciones</h2>
        <p className="text-sm text-slate-600">
          Registro profesional de reparaciones con fecha, hora, kilometraje, moneda y costos por unidad.
        </p>
      </header>

      <RepairCostCard
        totalRepairs={summary.totalRepairs}
        totalsByCurrency={summary.totalsByCurrency}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="xl:col-span-1">
          {canCreate || canEdit ? (
            <RepairsForm
              workOrders={workOrders}
              externalRequests={externalRequests}
              suppliers={suppliers}
              formData={formData}
              errors={errors}
              isEditing={Boolean(editingRepairId)}
              onFieldChange={handleFieldChange}
              onSubmit={handleSubmit}
              onCancelEdit={resetForm}
            />
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenés permisos para crear o editar reparaciones.
            </section>
          )}
        </div>

        <div className="xl:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Historial por unidad</h3>
                <p className="mt-1 text-sm text-slate-600">Control de reparaciones vinculadas a OT.</p>
              </div>

              <label className="flex flex-col gap-1 text-sm font-semibold text-slate-700">
                Filtrar unidad
                <select
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={unitFilter}
                  onChange={(event) => setUnitFilter(event.target.value)}
                >
                  <option value={allUnitsFilter}>Todas</option>
                  {fleetUnits.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.internalCode} - {unit.ownerCompany}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {filteredRepairs.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500 md:col-span-2">
                  No hay reparaciones para el filtro seleccionado.
                </div>
              ) : (
                filteredRepairs.map((item) => (
                  <RepairsHistoryCard
                    key={item.id}
                    item={item}
                    onEdit={handleEdit}
                    onDelete={setRepairIdPendingDelete}
                    canEdit={canEdit}
                    canDelete={canDelete}
                  />
                ))
              )}
            </div>
          </section>
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(repairIdPendingDelete)}
          title="Eliminar reparacion"
          message="Deseas eliminar esta reparacion? Esta accion no se puede deshacer."
          onCancel={() => setRepairIdPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  )
}
