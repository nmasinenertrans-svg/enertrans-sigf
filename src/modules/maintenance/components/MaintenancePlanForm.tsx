import { FormRow } from '../../../components/shared/FormRow'
import type { FleetUnit } from '../../../types/domain'
import { getAvailableMaintenanceTypes, getMeasurementUnit, maintenanceTypeLabels } from '../services/maintenanceService'
import type { MaintenanceFormErrors, MaintenanceFormField, MaintenancePlanFormData } from '../types'

interface MaintenancePlanFormProps {
  fleetUnits: FleetUnit[]
  formData: MaintenancePlanFormData
  errors: MaintenanceFormErrors
  isEditing: boolean
  onFieldChange: <TField extends MaintenanceFormField>(field: TField, value: MaintenancePlanFormData[TField]) => void
  onSubmit: () => void
  onCancelEdit: () => void
}

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400'

export const MaintenancePlanForm = ({
  fleetUnits,
  formData,
  errors,
  isEditing,
  onFieldChange,
  onSubmit,
  onCancelEdit,
}: MaintenancePlanFormProps) => {
  const selectedUnit = fleetUnits.find((unit) => unit.id === formData.unitId)
  const availableTypes = getAvailableMaintenanceTypes(selectedUnit)
  const measurementUnit = getMeasurementUnit(selectedUnit?.unitType, formData.maintenanceType)
  const isKilometers = measurementUnit === 'KILOMETERS'

  const previewNextService = isKilometers
    ? formData.currentKilometers + formData.serviceIntervalKilometers
    : formData.currentHours + formData.serviceIntervalHours
  const storedNextService = isKilometers ? formData.nextServiceByKilometers : formData.nextServiceByHours

  const handleUnitChange = (unitId: string) => {
    onFieldChange('unitId', unitId)
    const nextUnit = fleetUnits.find((unit) => unit.id === unitId)
    if (formData.maintenanceType === 'HYDRO_CRANE' && !nextUnit?.hasHydroCrane) {
      onFieldChange('maintenanceType', 'MOTOR')
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <header>
        <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar plan' : 'Nuevo plan'}</h3>
        <p className="mt-1 text-sm text-slate-600">
          Un plan es un sistema puntual de una unidad (ej. "Service de motor"). Camiones/tractores se miden por horas,
          autos/camionetas por KM.
        </p>
      </header>

      <form
        className="mt-5 grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <FormRow label="Unidad" errorMessage={errors.unitId}>
          <select className={inputClassName} value={formData.unitId} onChange={(event) => handleUnitChange(event.target.value)}>
            <option value="">Seleccionar unidad</option>
            {fleetUnits.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.internalCode} - {unit.ownerCompany}
              </option>
            ))}
          </select>
        </FormRow>

        <FormRow label="Tipo de mantenimiento">
          <select
            className={inputClassName}
            value={formData.maintenanceType}
            onChange={(event) => onFieldChange('maintenanceType', event.target.value as MaintenancePlanFormData['maintenanceType'])}
          >
            {availableTypes.map((type) => (
              <option key={type} value={type}>
                {maintenanceTypeLabels[type]}
              </option>
            ))}
          </select>
          {selectedUnit ? (
            <p className="mt-1 text-xs text-slate-500">
              Se mide por {isKilometers ? 'kilómetros' : 'horas'} ({selectedUnit.internalCode}).
            </p>
          ) : null}
        </FormRow>

        {isKilometers ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormRow label="KM actuales" errorMessage={errors.currentKilometers}>
              <input
                type="number"
                min={0}
                className={inputClassName}
                value={formData.currentKilometers}
                onChange={(event) => onFieldChange('currentKilometers', Number(event.target.value))}
              />
            </FormRow>
            <FormRow label="Cada cuántos KM corresponde el service" errorMessage={errors.serviceIntervalKilometers}>
              <input
                type="number"
                min={1}
                className={inputClassName}
                value={formData.serviceIntervalKilometers}
                onChange={(event) => onFieldChange('serviceIntervalKilometers', Number(event.target.value))}
              />
            </FormRow>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormRow label="Horas actuales" errorMessage={errors.currentHours}>
              <input
                type="number"
                min={0}
                className={inputClassName}
                value={formData.currentHours}
                onChange={(event) => onFieldChange('currentHours', Number(event.target.value))}
              />
            </FormRow>
            <FormRow label="Cada cuántas horas corresponde el service" errorMessage={errors.serviceIntervalHours}>
              <input
                type="number"
                min={1}
                className={inputClassName}
                value={formData.serviceIntervalHours}
                onChange={(event) => onFieldChange('serviceIntervalHours', Number(event.target.value))}
              />
            </FormRow>
          </div>
        )}

        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {isEditing ? (
            <>
              <span className="font-semibold">Próximo service actual: </span>
              {storedNextService} {isKilometers ? 'km' : 'hs'}
              <p className="mt-1 text-xs text-slate-500">
                No cambia al editar KM/horas o el intervalo — solo se recalcula con "Marcar service realizado" desde la
                tarjeta del plan.
              </p>
            </>
          ) : (
            <>
              <span className="font-semibold">Próximo service quedará en: </span>
              {previewNextService} {isKilometers ? 'km' : 'hs'}
            </>
          )}
        </div>

        <FormRow label="Aceites (separados por coma)" errorMessage={errors.oilsInput}>
          <input
            className={inputClassName}
            value={formData.oilsInput}
            onChange={(event) => onFieldChange('oilsInput', event.target.value)}
            placeholder="Motor 15W40, Hidráulico ISO 46"
          />
        </FormRow>

        <FormRow label="Filtros (separados por coma)" errorMessage={errors.filtersInput}>
          <input
            className={inputClassName}
            value={formData.filtersInput}
            onChange={(event) => onFieldChange('filtersInput', event.target.value)}
            placeholder="Filtro de aceite, Filtro de aire"
          />
        </FormRow>

        <FormRow label="Observaciones" errorMessage={errors.notes}>
          <textarea
            className={inputClassName}
            rows={3}
            value={formData.notes}
            onChange={(event) => onFieldChange('notes', event.target.value)}
          />
        </FormRow>

        <div className="flex flex-wrap justify-end gap-3">
          {isEditing ? (
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              Cancelar edición
            </button>
          ) : null}
          <button type="submit" className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500">
            {isEditing ? 'Guardar cambios' : 'Guardar plan'}
          </button>
        </div>
      </form>
    </section>
  )
}
