import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmModal } from '../../../components/shared/ConfirmModal'
import { usePermissions } from '../../../core/auth/usePermissions'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { MaintenancePlanCard } from '../components/MaintenancePlanCard'
import { MaintenancePlanForm } from '../components/MaintenancePlanForm'
import { MaintenanceSettingsPanel } from '../components/MaintenanceSettingsPanel'
import { MaintenanceSummaryCard } from '../components/MaintenanceSummaryCard'
import { BackLink } from '../../../components/shared/BackLink'
import {
  buildMaintenanceViewModel,
  createEmptyMaintenancePlanFormData,
  getDefaultMaintenanceSettings,
  mergeMaintenancePlanFromForm,
  normalizeMaintenancePlan,
  readMaintenanceSettings,
  toMaintenancePlan,
  toMaintenancePlanFormData,
  validateMaintenancePlanFormData,
  writeMaintenanceSettings,
} from '../services/maintenanceService'
import type { MaintenanceFormErrors, MaintenanceFormField, MaintenancePlanFormData, MaintenanceSettings } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'

const statusPriorityMap = {
  OVERDUE: 0,
  DUE_SOON: 1,
  OK: 2,
} as const

export const MaintenancePage = () => {
  const { can } = usePermissions()
  const {
    state: { fleetUnits, maintenancePlans },
    actions: { setMaintenancePlans },
  } = useAppContext()

  const canCreate = can('MAINTENANCE', 'create')
  const canEdit = can('MAINTENANCE', 'edit')
  const canDelete = can('MAINTENANCE', 'delete')

  const [settings, setSettings] = useState<MaintenanceSettings>(readMaintenanceSettings)
  const initialUnitId = fleetUnits[0]?.id ?? ''
  const [formData, setFormData] = useState<MaintenancePlanFormData>(() =>
    createEmptyMaintenancePlanFormData(initialUnitId, settings),
  )
  const [errors, setErrors] = useState<MaintenanceFormErrors>({})
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planIdPendingDelete, setPlanIdPendingDelete] = useState<string | null>(null)

  const planViewList = useMemo(() => {
    const items = buildMaintenanceViewModel(maintenancePlans, fleetUnits, settings)

    return [...items].sort((left, right) => {
      const statusDifference = statusPriorityMap[left.calculatedStatus] - statusPriorityMap[right.calculatedStatus]

      if (statusDifference !== 0) {
        return statusDifference
      }

      return left.plan.nextServiceByKilometers - right.plan.nextServiceByKilometers
    })
  }, [fleetUnits, maintenancePlans, settings])

  const summary = useMemo(
    () => ({
      totalPlans: planViewList.length,
      overduePlans: planViewList.filter((item) => item.calculatedStatus === 'OVERDUE').length,
      dueSoonPlans: planViewList.filter((item) => item.calculatedStatus === 'DUE_SOON').length,
      okPlans: planViewList.filter((item) => item.calculatedStatus === 'OK').length,
    }),
    [planViewList],
  )

  const handleFieldChange = <TField extends MaintenanceFormField>(
    field: TField,
    value: MaintenancePlanFormData[TField],
  ) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      [field]: value,
    }))

    setErrors((previousErrors) => ({
      ...previousErrors,
      [field]: undefined,
    }))
  }

  const resetForm = () => {
    setEditingPlanId(null)
    setErrors({})
    setFormData(createEmptyMaintenancePlanFormData(fleetUnits[0]?.id ?? '', settings))
  }

  const handleSubmitPlan = () => {
    if (editingPlanId ? !canEdit : !canCreate) {
      return
    }

    const validationErrors = validateMaintenancePlanFormData(formData, fleetUnits)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    if (editingPlanId) {
      const nextPlanList = maintenancePlans.map((plan) =>
        plan.id === editingPlanId ? mergeMaintenancePlanFromForm(plan, formData, settings) : plan,
      )
      setMaintenancePlans(nextPlanList)
      resetForm()
      return
    }

    const createdPlan = toMaintenancePlan(formData, settings)
    setMaintenancePlans([...maintenancePlans, createdPlan])
    enqueueAndSync({
      id: `maintenance.create.${createdPlan.id}`,
      type: 'maintenance.create',
      payload: createdPlan,
      createdAt: new Date().toISOString(),
    })
    resetForm()
  }

  const handleEditPlan = (planId: string) => {
    if (!canEdit) {
      return
    }

    const selectedPlan = maintenancePlans.find((plan) => plan.id === planId)

    if (!selectedPlan) {
      return
    }

    setEditingPlanId(planId)
    setFormData(toMaintenancePlanFormData(normalizeMaintenancePlan(selectedPlan, settings)))
  }

  const handleConfirmDelete = () => {
    if (!canDelete) {
      return
    }

    if (!planIdPendingDelete) {
      return
    }

    const nextPlanList = maintenancePlans.filter((plan) => plan.id !== planIdPendingDelete)
    setMaintenancePlans(nextPlanList)
    setPlanIdPendingDelete(null)

    if (editingPlanId === planIdPendingDelete) {
      resetForm()
    }
  }

  const handleSettingsChange = (nextSettings: MaintenanceSettings) => {
    if (!canEdit) {
      return
    }

    const normalizedSettings = {
      dueSoonKilometersThreshold: Math.max(0, nextSettings.dueSoonKilometersThreshold),
      dueSoonHoursThreshold: Math.max(0, nextSettings.dueSoonHoursThreshold),
      defaultOilList:
        nextSettings.defaultOilList.length > 0
          ? nextSettings.defaultOilList
          : getDefaultMaintenanceSettings().defaultOilList,
      defaultFilterList:
        nextSettings.defaultFilterList.length > 0
          ? nextSettings.defaultFilterList
          : getDefaultMaintenanceSettings().defaultFilterList,
    }

    setSettings(normalizedSettings)
    writeMaintenanceSettings(normalizedSettings)
  }

  if (fleetUnits.length === 0) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Plan de Mantenimiento</h2>
        <p className="mt-2 text-sm text-slate-600">Primero necesitás cargar al menos una unidad en Flota para crear planes.</p>
        <Link
          to={ROUTE_PATHS.fleet.create}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Crear unidad
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Plan de Mantenimiento</h2>
        <p className="text-sm text-slate-600">Control de próximos services por KM, horas, aceites y filtros.</p>
      </header>

      <MaintenanceSummaryCard
        totalPlans={summary.totalPlans}
        overduePlans={summary.overduePlans}
        dueSoonPlans={summary.dueSoonPlans}
        okPlans={summary.okPlans}
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-1">
          {canCreate || canEdit ? (
            <>
              <MaintenancePlanForm
                fleetUnits={fleetUnits}
                formData={formData}
                errors={errors}
                isEditing={Boolean(editingPlanId)}
                onFieldChange={handleFieldChange}
                onSubmit={handleSubmitPlan}
                onCancelEdit={resetForm}
              />
              {canEdit ? <MaintenanceSettingsPanel settings={settings} onSettingsChange={handleSettingsChange} /> : null}
            </>
          ) : (
            <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
              No tenés permisos para crear o editar planes de mantenimiento.
            </section>
          )}
        </div>

        <div className="grid gap-4 xl:col-span-2 md:grid-cols-2">
          {planViewList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 md:col-span-2">
              No hay planes de mantenimiento cargados.
            </div>
          ) : (
            planViewList.map((planView) => (
              <MaintenancePlanCard
                key={planView.plan.id}
                planView={planView}
                onEdit={handleEditPlan}
                onDelete={setPlanIdPendingDelete}
                canEdit={canEdit}
                canDelete={canDelete}
              />
            ))
          )}
        </div>
      </div>

      {canDelete ? (
        <ConfirmModal
          isOpen={Boolean(planIdPendingDelete)}
          title="Eliminar plan de mantenimiento"
          message="¿Deseás eliminar este plan? Esta acción no se puede deshacer."
          onCancel={() => setPlanIdPendingDelete(null)}
          onConfirm={handleConfirmDelete}
        />
      ) : null}
    </section>
  )
}
