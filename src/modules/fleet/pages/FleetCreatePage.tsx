import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { buildFleetDetailPath, ROUTE_PATHS } from '../../../core/routing/routePaths'
import { FleetUnitForm } from '../components/FleetUnitForm'
import {
  addTractorHistoryToSemiTrailer,
  createEmptyFleetFormData,
  createSemiTrailerUnitFromForm,
  resolveSemiTrailerFormData,
  toFleetUnit,
  validateFleetFormData,
} from '../services/fleetService'
import type { FleetFormData, FleetFormErrors, FleetFormField } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { BackLink } from '../../../components/shared/BackLink'

export const FleetCreatePage = () => {
  const navigate = useNavigate()

  const {
    state: { fleetUnits },
    actions: { setFleetUnits },
  } = useAppContext()

  const [formData, setFormData] = useState<FleetFormData>(createEmptyFleetFormData)
  const [errors, setErrors] = useState<FleetFormErrors>({})

  const semiTrailerOptions = useMemo(
    () =>
      fleetUnits
        .filter((unit) => unit.unitType === 'SEMI_TRAILER')
        .map((unit) => {
          const extraInfo = [unit.semiTrailerBrand, unit.semiTrailerModel].filter(Boolean).join(' ')
          return {
            id: unit.id,
            label: extraInfo ? `${unit.internalCode} - ${extraInfo}` : unit.internalCode,
          }
        }),
    [fleetUnits],
  )

  const handleFieldChange = <TField extends FleetFormField>(field: TField, value: FleetFormData[TField]) => {
    setFormData((previousFormData) => ({
      ...previousFormData,
      [field]: value,
    }))

    setErrors((previousErrors) => ({
      ...previousErrors,
      [field]: undefined,
    }))
  }

  const handleSubmit = () => {
    const resolvedFormData = resolveSemiTrailerFormData(formData, fleetUnits)
    const validationErrors = validateFleetFormData(resolvedFormData, fleetUnits)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    let createdUnit = toFleetUnit(resolvedFormData)
    let nextUnitList = [...fleetUnits]

    if (resolvedFormData.hasSemiTrailer) {
      if (resolvedFormData.semiTrailerUnitId) {
        const matchedSemiTrailer = fleetUnits.find((unit) => unit.id === resolvedFormData.semiTrailerUnitId)

        if (matchedSemiTrailer) {
          const updatedSemiTrailer = addTractorHistoryToSemiTrailer(matchedSemiTrailer, createdUnit.id)
          nextUnitList = nextUnitList.map((unit) =>
            unit.id === updatedSemiTrailer.id ? updatedSemiTrailer : unit,
          )
          createdUnit = {
            ...createdUnit,
            semiTrailerUnitId: updatedSemiTrailer.id,
          }
        } else {
          createdUnit = {
            ...createdUnit,
            semiTrailerUnitId: null,
          }
        }
      } else {
        const newSemiTrailer = createSemiTrailerUnitFromForm(resolvedFormData, createdUnit.id)
        nextUnitList = [...nextUnitList, newSemiTrailer]
        createdUnit = {
          ...createdUnit,
          semiTrailerUnitId: newSemiTrailer.id,
        }
        enqueueAndSync({
          id: `fleet.create.${newSemiTrailer.id}`,
          type: 'fleet.create',
          payload: newSemiTrailer,
          createdAt: new Date().toISOString(),
        })
      }
    } else {
      createdUnit = {
        ...createdUnit,
        semiTrailerUnitId: null,
      }
    }

    nextUnitList = [...nextUnitList, createdUnit]
    setFleetUnits(nextUnitList)
    enqueueAndSync({
      id: `fleet.create.${createdUnit.id}`,
      type: 'fleet.create',
      payload: createdUnit,
      createdAt: new Date().toISOString(),
    })
    navigate(buildFleetDetailPath(createdUnit.id))
  }

  return (
    <section className="space-y-4">
      <BackLink to={ROUTE_PATHS.fleet.list} label="Volver a flota" />
      <FleetUnitForm
        title="Crear Unidad"
        description="Alta de nueva unidad con datos operativos y tecnicos obligatorios."
        submitLabel="Guardar unidad"
        formData={formData}
        errors={errors}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
        onCancel={() => navigate(ROUTE_PATHS.fleet.list)}
        internalCodeLabel="Dominio"
        internalCodePlaceholder="Ej: ABC123"
        semiTrailerOptions={semiTrailerOptions}
      />
    </section>
  )
}
