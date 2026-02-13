import type { ReactNode } from 'react'
import type { FleetFormData, FleetFormErrors, FleetFormField } from '../types'
import {
  fleetOperationalStatuses,
  fleetUnitTypes,
  type FleetOperationalStatus,
  type FleetUnitType,
} from '../../../types/domain'
import { fleetOperationalStatusLabelMap, fleetUnitTypeLabelMap } from '../services/fleetService'

interface FleetUnitFormProps {
  title: string
  description: string
  submitLabel: string
  formData: FleetFormData
  errors: FleetFormErrors
  onSubmit: () => void
  onCancel: () => void
  onFieldChange: <TField extends FleetFormField>(field: TField, value: FleetFormData[TField]) => void
  internalCodeLabel?: string
  internalCodePlaceholder?: string
  semiTrailerOptions?: Array<{ id: string; label: string }>
}

interface InputRowProps {
  label: string
  errorMessage?: string
  children: ReactNode
}

const InputRow = ({ label, errorMessage, children }: InputRowProps) => (
  <label className="flex flex-col gap-2">
    <span className="text-sm font-semibold text-slate-700">{label}</span>
    {children}
    {errorMessage ? <span className="text-xs font-semibold text-rose-700">{errorMessage}</span> : null}
  </label>
)

const inputClassName =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition-colors focus:border-amber-400 disabled:bg-slate-100 disabled:text-slate-500'

const isMissingOrExpired = (expiresAt?: string): boolean => {
  if (!expiresAt) {
    return true
  }
  const date = new Date(expiresAt)
  if (Number.isNaN(date.getTime())) {
    return true
  }
  return date.getTime() < new Date().setHours(0, 0, 0, 0)
}

const hasInvalidDocuments = (documents?: {
  rto?: { expiresAt?: string }
  insurance?: { expiresAt?: string }
  hoist?: { expiresAt?: string }
}): boolean => {
  if (!documents) {
    return true
  }
  return (
    isMissingOrExpired(documents.rto?.expiresAt) ||
    isMissingOrExpired(documents.insurance?.expiresAt) ||
    isMissingOrExpired(documents.hoist?.expiresAt)
  )
}

const unitTypesWithHydroCrane = new Set<FleetUnitType>(['CHASSIS_WITH_HYDROCRANE', 'TRACTOR_WITH_HYDROCRANE'])

export const FleetUnitForm = ({
  title,
  description,
  submitLabel,
  formData,
  errors,
  onSubmit,
  onCancel,
  onFieldChange,
  internalCodeLabel = 'Codigo interno',
  internalCodePlaceholder = 'Ej: ENR-001',
  semiTrailerOptions = [],
}: FleetUnitFormProps) => {
  const requiresHydroCrane = unitTypesWithHydroCrane.has(formData.unitType)
  const showHydroCraneFields = requiresHydroCrane || formData.hasHydroCrane
  const showSemiTrailerFields = formData.hasSemiTrailer && !formData.semiTrailerUnitId
  const invalidDocs = hasInvalidDocuments(formData.documents)
  const parseNumberInput = (value: string) => (value.trim() === '' ? 0 : Number(value))

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
      <header>
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-600">{description}</p>
      </header>

      <form
        className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <InputRow label={internalCodeLabel} errorMessage={errors.internalCode}>
          <input
            value={formData.internalCode}
            onChange={(event) => onFieldChange('internalCode', event.target.value)}
            className={inputClassName}
            placeholder={internalCodePlaceholder}
          />
        </InputRow>

        <InputRow label="Marca" errorMessage={errors.brand}>
          <input
            value={formData.brand}
            onChange={(event) => onFieldChange('brand', event.target.value)}
            className={inputClassName}
            placeholder="Ej: Mercedes-Benz"
          />
        </InputRow>

        <InputRow label="Modelo" errorMessage={errors.model}>
          <input
            value={formData.model}
            onChange={(event) => onFieldChange('model', event.target.value)}
            className={inputClassName}
            placeholder="Ej: Atego 1729"
          />
        </InputRow>

        <InputRow label="Año" errorMessage={errors.year}>
          <input
            type="number"
            min={1900}
            value={formData.year === 0 ? '' : formData.year}
            onChange={(event) => onFieldChange('year', parseNumberInput(event.target.value))}
            className={inputClassName}
            placeholder="Ej: 2022"
          />
        </InputRow>

        <InputRow label="Cliente" errorMessage={errors.clientName}>
          <input
            value={formData.clientName}
            onChange={(event) => onFieldChange('clientName', event.target.value)}
            className={inputClassName}
            placeholder="Ej: YPF"
          />
        </InputRow>

        <InputRow label="Ubicacion" errorMessage={errors.location}>
          <input
            value={formData.location}
            onChange={(event) => onFieldChange('location', event.target.value)}
            className={inputClassName}
            placeholder="Ej: Neuquen"
          />
        </InputRow>

        <InputRow label="Empresa propietaria" errorMessage={errors.ownerCompany}>
          <input
            value={formData.ownerCompany}
            onChange={(event) => onFieldChange('ownerCompany', event.target.value)}
            className={inputClassName}
            placeholder="Ej: Enertrans Logistics"
          />
        </InputRow>

        <InputRow label="Tipo de unidad" errorMessage={errors.unitType}>
          <select
            value={formData.unitType}
            onChange={(event) => {
              const nextUnitType = event.target.value as FleetUnitType
              onFieldChange('unitType', nextUnitType)

              if (unitTypesWithHydroCrane.has(nextUnitType) && !formData.hasHydroCrane) {
                onFieldChange('hasHydroCrane', true)
              }
            }}
            className={inputClassName}
          >
            {fleetUnitTypes.map((unitType) => (
              <option key={unitType} value={unitType}>
                {fleetUnitTypeLabelMap[unitType]}
              </option>
            ))}
          </select>
        </InputRow>

        <InputRow label="Estado operativo">
          <select
            value={formData.operationalStatus}
            onChange={(event) => onFieldChange('operationalStatus', event.target.value as FleetOperationalStatus)}
            className={inputClassName}
            disabled={invalidDocs}
          >
            {fleetOperationalStatuses.map((status) => (
              <option key={status} value={status}>
                {fleetOperationalStatusLabelMap[status]}
              </option>
            ))}
          </select>
          {invalidDocs ? (
            <span className="text-xs font-semibold text-rose-700">
              La unidad queda fuera de servicio si faltan o vencen RTO, seguro o izaje.
            </span>
          ) : null}
        </InputRow>

        <InputRow label="Configuracion" errorMessage={errors.configurationNotes}>
          <input
            value={formData.configurationNotes}
            onChange={(event) => onFieldChange('configurationNotes', event.target.value)}
            className={inputClassName}
            placeholder="Configuracion tecnica"
          />
        </InputRow>

        <InputRow label="N° chasis" errorMessage={errors.chassisNumber}>
          <input
            value={formData.chassisNumber}
            onChange={(event) => onFieldChange('chassisNumber', event.target.value)}
            className={inputClassName}
            placeholder="Ej: CHS-98321"
          />
        </InputRow>

        <InputRow label="N° motor" errorMessage={errors.engineNumber}>
          <input
            value={formData.engineNumber}
            onChange={(event) => onFieldChange('engineNumber', event.target.value)}
            className={inputClassName}
            placeholder="Ej: MTR-42210"
          />
        </InputRow>

        <InputRow label="Tara (kg)" errorMessage={errors.tareWeightKg}>
          <input
            type="number"
            min={0}
            value={formData.tareWeightKg === 0 ? '' : formData.tareWeightKg}
            onChange={(event) => onFieldChange('tareWeightKg', parseNumberInput(event.target.value))}
            className={inputClassName}
            placeholder="Ej: 5000"
          />
        </InputRow>

        <InputRow label="Carga maxima (kg)" errorMessage={errors.maxLoadKg}>
          <input
            type="number"
            min={0}
            value={formData.maxLoadKg === 0 ? '' : formData.maxLoadKg}
            onChange={(event) => onFieldChange('maxLoadKg', parseNumberInput(event.target.value))}
            className={inputClassName}
            placeholder="Ej: 12000"
          />
        </InputRow>

        <div
          className="col-span-1 mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2"
          onClick={() => {
            if (!requiresHydroCrane) {
              onFieldChange('hasHydroCrane', !formData.hasHydroCrane)
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              if (!requiresHydroCrane) {
                onFieldChange('hasHydroCrane', !formData.hasHydroCrane)
              }
            }
          }}
        >
          <input
            id="fleet-hydrocrane"
            type="checkbox"
            checked={requiresHydroCrane ? true : formData.hasHydroCrane}
            onChange={(event) => onFieldChange('hasHydroCrane', event.target.checked)}
            className="h-4 w-4"
            disabled={requiresHydroCrane}
          />
          <span className="text-sm font-semibold text-slate-700">
            Tiene hidrogrua{requiresHydroCrane ? ' (obligatorio por tipo de unidad)' : ''}
          </span>
        </div>

        {showHydroCraneFields ? (
          <>
            <InputRow label="Marca hidrogrua" errorMessage={errors.hydroCraneBrand}>
              <input
                value={formData.hydroCraneBrand}
                onChange={(event) => onFieldChange('hydroCraneBrand', event.target.value)}
                className={inputClassName}
                placeholder="Marca"
              />
            </InputRow>

            <InputRow label="Modelo hidrogrua" errorMessage={errors.hydroCraneModel}>
              <input
                value={formData.hydroCraneModel}
                onChange={(event) => onFieldChange('hydroCraneModel', event.target.value)}
                className={inputClassName}
                placeholder="Modelo"
              />
            </InputRow>

            <InputRow label="N° serie hidrogrua" errorMessage={errors.hydroCraneSerialNumber}>
              <input
                value={formData.hydroCraneSerialNumber}
                onChange={(event) => onFieldChange('hydroCraneSerialNumber', event.target.value)}
                className={inputClassName}
                placeholder="Numero de serie"
              />
            </InputRow>
          </>
        ) : null}

        <div
          className="col-span-1 mt-2 flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3 md:col-span-2"
          onClick={() => {
            const nextValue = !formData.hasSemiTrailer
            onFieldChange('hasSemiTrailer', nextValue)

            if (!nextValue && formData.semiTrailerUnitId) {
              onFieldChange('semiTrailerUnitId', '')
            }
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              const nextValue = !formData.hasSemiTrailer
              onFieldChange('hasSemiTrailer', nextValue)

              if (!nextValue && formData.semiTrailerUnitId) {
                onFieldChange('semiTrailerUnitId', '')
              }
            }
          }}
        >
          <input
            id="fleet-semitrailer"
            type="checkbox"
            checked={formData.hasSemiTrailer}
            onChange={(event) => {
              const nextValue = event.target.checked
              onFieldChange('hasSemiTrailer', nextValue)

              if (!nextValue && formData.semiTrailerUnitId) {
                onFieldChange('semiTrailerUnitId', '')
              }
            }}
            className="h-4 w-4"
          />
          <span className="text-sm font-semibold text-slate-700">Tiene semirremolque asociado</span>
        </div>

      {formData.hasSemiTrailer ? (
        <>
            <InputRow label="Semirremolque existente" errorMessage={errors.semiTrailerUnitId}>
              <select
                value={formData.semiTrailerUnitId}
                onChange={(event) => onFieldChange('semiTrailerUnitId', event.target.value)}
                className={inputClassName}
              >
                <option value="">Crear nuevo semirremolque</option>
                {semiTrailerOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </InputRow>

            {showSemiTrailerFields ? (
              <>
                <InputRow label="Dominio semirremolque" errorMessage={errors.semiTrailerLicensePlate}>
                  <input
                    value={formData.semiTrailerLicensePlate}
                    onChange={(event) => onFieldChange('semiTrailerLicensePlate', event.target.value)}
                    className={inputClassName}
                    placeholder="Dominio"
                  />
                </InputRow>

                <InputRow label="Marca semirremolque" errorMessage={errors.semiTrailerBrand}>
                  <input
                    value={formData.semiTrailerBrand}
                    onChange={(event) => onFieldChange('semiTrailerBrand', event.target.value)}
                    className={inputClassName}
                    placeholder="Marca"
                  />
                </InputRow>

                <InputRow label="Modelo semirremolque" errorMessage={errors.semiTrailerModel}>
                  <input
                    value={formData.semiTrailerModel}
                    onChange={(event) => onFieldChange('semiTrailerModel', event.target.value)}
                    className={inputClassName}
                    placeholder="Modelo"
                  />
                </InputRow>

                <InputRow label="Anio semirremolque" errorMessage={errors.semiTrailerYear}>
                  <input
                    type="number"
                    min={1900}
                    value={formData.semiTrailerYear === 0 ? '' : formData.semiTrailerYear}
                    onChange={(event) => onFieldChange('semiTrailerYear', parseNumberInput(event.target.value))}
                    className={inputClassName}
                    placeholder="Ej: 2022"
                  />
                </InputRow>

                <InputRow label="N° chasis semirremolque" errorMessage={errors.semiTrailerChassisNumber}>
                  <input
                    value={formData.semiTrailerChassisNumber}
                    onChange={(event) => onFieldChange('semiTrailerChassisNumber', event.target.value)}
                    className={inputClassName}
                    placeholder="Numero de chasis"
                  />
                </InputRow>
              </>
            ) : null}
        </>
      ) : null}

      <div className="col-span-1 mt-4 rounded-lg border border-slate-200 bg-white md:col-span-2">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">
          Lubricantes
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)] gap-2 border-b border-slate-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <span>Concepto</span>
              <span>Valor</span>
            </div>
            {[
              { label: 'Aceite Motor', key: 'engineOil' },
              { label: 'Litros Aceite Motor', key: 'engineOilLiters' },
              { label: 'Aceite Caja', key: 'gearboxOil' },
              { label: 'Litros Aceite Caja', key: 'gearboxOilLiters' },
              { label: 'Aceite Diferencial', key: 'differentialOil' },
              { label: 'Litros Aceite Diferencial', key: 'differentialOilLiters' },
              { label: 'Liquido Embrague', key: 'clutchFluid' },
              { label: 'Litros Liquido Embrague', key: 'clutchFluidLiters' },
              { label: 'Liquido Direccion', key: 'steeringFluid' },
              { label: 'Litros Liquido Direccion', key: 'steeringFluidLiters' },
              { label: 'Liquido Frenos', key: 'brakeFluid' },
              { label: 'Litros Liquido Frenos', key: 'brakeFluidLiters' },
              { label: 'Refrigerante', key: 'coolant' },
              { label: 'Litros Refrigerante', key: 'coolantLiters' },
              { label: 'Aceite Hidraulico', key: 'hydraulicOil' },
              { label: 'Litros Aceite Hidraulico', key: 'hydraulicOilLiters' },
            ].map((row, index) => (
              <div
                key={row.key}
                className={[
                  'grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)] gap-2 border-b border-slate-200 px-4 py-2 text-sm',
                  index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60',
                ].join(' ')}
              >
                <span className="text-slate-600">{row.label}</span>
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={formData.lubricants[row.key as keyof typeof formData.lubricants] ?? ''}
                  onChange={(event) =>
                    onFieldChange('lubricants', {
                      ...formData.lubricants,
                      [row.key]: event.target.value,
                    })
                  }
                  placeholder="-"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col-span-1 rounded-lg border border-slate-200 bg-white md:col-span-2">
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm font-bold text-slate-700">Filtros</div>
        <div className="overflow-x-auto">
          <div className="min-w-[520px]">
            <div className="grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)] gap-2 border-b border-slate-200 bg-amber-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              <span>Concepto</span>
              <span>Valor</span>
            </div>
            {[
              { label: 'Filtro Aceite', key: 'oilFilter' },
              { label: 'Filtro Combustible', key: 'fuelFilter' },
              { label: 'Filtro TA', key: 'taFilter' },
              { label: 'Filtro Aire Primario', key: 'primaryAirFilter' },
              { label: 'Filtro Aire Secundario', key: 'secondaryAirFilter' },
              { label: 'Filtro Habitaculo', key: 'cabinFilter' },
            ].map((row, index) => (
              <div
                key={row.key}
                className={[
                  'grid grid-cols-[minmax(180px,1fr)_minmax(180px,1fr)] gap-2 border-b border-slate-200 px-4 py-2 text-sm',
                  index % 2 === 0 ? 'bg-white' : 'bg-slate-50/60',
                ].join(' ')}
              >
                <span className="text-slate-600">{row.label}</span>
                <input
                  className="w-full rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-amber-400"
                  value={formData.filters[row.key as keyof typeof formData.filters] ?? ''}
                  onChange={(event) =>
                    onFieldChange('filters', {
                      ...formData.filters,
                      [row.key]: event.target.value,
                    })
                  }
                  placeholder="-"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="col-span-1 mt-3 flex flex-wrap justify-end gap-3 md:col-span-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-500"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </section>
  )
}
