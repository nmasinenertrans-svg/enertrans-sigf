import { FormRow } from '../../../components/shared/FormRow'
import type { FleetUnit } from '../../../types/domain'
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
}: MaintenancePlanFormProps) => (
  <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
    <header>
      <h3 className="text-lg font-bold text-slate-900">{isEditing ? 'Editar plan' : 'Nuevo plan'}</h3>
      <p className="mt-1 text-sm text-slate-600">Configura próximos services por KM y horas para una unidad.</p>
    </header>

    <form
      className="mt-5 grid grid-cols-1 gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <FormRow label="Unidad" errorMessage={errors.unitId}>
        <select
          className={inputClassName}
          value={formData.unitId}
          onChange={(event) => onFieldChange('unitId', event.target.value)}
        >
          <option value="">Seleccionar unidad</option>
          {fleetUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.internalCode} - {unit.ownerCompany}
            </option>
          ))}
        </select>
      </FormRow>

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
        <FormRow label="Próximo service por KM" errorMessage={errors.nextServiceByKilometers}>
          <input
            type="number"
            min={1}
            className={inputClassName}
            value={formData.nextServiceByKilometers}
            onChange={(event) => onFieldChange('nextServiceByKilometers', Number(event.target.value))}
          />
        </FormRow>
      </div>

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
        <FormRow label="Próximo service por horas" errorMessage={errors.nextServiceByHours}>
          <input
            type="number"
            min={1}
            className={inputClassName}
            value={formData.nextServiceByHours}
            onChange={(event) => onFieldChange('nextServiceByHours', Number(event.target.value))}
          />
        </FormRow>
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

      <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h4 className="text-sm font-bold text-slate-900">Histórico de próximos services</h4>
        <p className="mt-1 text-xs text-slate-600">Completá según HS y/o KM motor según corresponda.</p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service motor</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceMotorHours}
                onChange={(event) => onFieldChange('serviceMotorHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceMotorKilometers}
                onChange={(event) => onFieldChange('serviceMotorKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service distribución</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceDistributionHours}
                onChange={(event) => onFieldChange('serviceDistributionHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceDistributionKilometers}
                onChange={(event) => onFieldChange('serviceDistributionKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service caja</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceGearboxHours}
                onChange={(event) => onFieldChange('serviceGearboxHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceGearboxKilometers}
                onChange={(event) => onFieldChange('serviceGearboxKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service refrigeración</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceCoolingHours}
                onChange={(event) => onFieldChange('serviceCoolingHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceCoolingKilometers}
                onChange={(event) => onFieldChange('serviceCoolingKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service diferencial</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceDifferentialHours}
                onChange={(event) => onFieldChange('serviceDifferentialHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceDifferentialKilometers}
                onChange={(event) => onFieldChange('serviceDifferentialKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service dirección</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceSteeringHours}
                onChange={(event) => onFieldChange('serviceSteeringHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceSteeringKilometers}
                onChange={(event) => onFieldChange('serviceSteeringKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service embrague</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceClutchHours}
                onChange={(event) => onFieldChange('serviceClutchHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceClutchKilometers}
                onChange={(event) => onFieldChange('serviceClutchKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service frenos</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceBrakesHours}
                onChange={(event) => onFieldChange('serviceBrakesHours', event.target.value)}
                placeholder="Según HS Motor"
              />
              <input
                className={inputClassName}
                value={formData.serviceBrakesKilometers}
                onChange={(event) => onFieldChange('serviceBrakesKilometers', event.target.value)}
                placeholder="Según KM Motor"
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-slate-700">Próximos Service hidrogrúa</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className={inputClassName}
                value={formData.serviceHydroCraneHours}
                onChange={(event) => onFieldChange('serviceHydroCraneHours', event.target.value)}
                placeholder="Según HS Hidrogrúa"
              />
              <div className="rounded-lg border border-dashed border-slate-200 bg-white/70 px-3 py-2 text-xs text-slate-500">
                Sin registro KM
              </div>
            </div>
          </div>
        </div>
      </section>

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
