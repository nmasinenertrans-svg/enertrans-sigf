import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { buildFleetDetailPath, ROUTE_PATHS } from '../../../core/routing/routePaths'
import { FleetUnitForm } from '../components/FleetUnitForm'
import {
  addTractorHistoryToSemiTrailer,
  createEmptyFleetFormData,
  createSemiTrailerUnitFromForm,
  findFleetUnitById,
  mapFleetUnitToFormData,
  mergeFleetUnitFromForm,
  resolveSemiTrailerFormData,
  validateFleetFormData,
} from '../services/fleetService'
import type { FleetFormData, FleetFormErrors, FleetFormField } from '../types'
import { enqueueAndSync } from '../../../services/offline/sync'
import { apiRequest } from '../../../services/api/apiClient'
import { BackLink } from '../../../components/shared/BackLink'

const buildFleetPatchBody = (unitPayload: Record<string, unknown>) => {
  const patchBody = { ...unitPayload }
  delete patchBody.id
  delete patchBody.crmDealLink
  return patchBody
}

export const FleetEditPage = () => {
  const navigate = useNavigate()
  const { unitId } = useParams()

  const {
    state: { fleetUnits },
    actions: { setFleetUnits, setAppError },
  } = useAppContext()

  const selectedUnit = useMemo(() => {
    if (!unitId) {
      return undefined
    }

    return findFleetUnitById(fleetUnits, unitId)
  }, [fleetUnits, unitId])

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

  const [formData, setFormData] = useState<FleetFormData>(() =>
    selectedUnit ? mapFleetUnitToFormData(selectedUnit) : createEmptyFleetFormData(),
  )
  const [errors, setErrors] = useState<FleetFormErrors>({})

  if (!unitId || !selectedUnit) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900">Unidad no encontrada</h2>
        <p className="mt-2 text-sm text-slate-600">No se encontro la unidad solicitada para edicion.</p>
        <Link
          to={ROUTE_PATHS.fleet.list}
          className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Volver a Flota
        </Link>
      </section>
    )
  }

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

  const handleSubmit = async () => {
    const resolvedFormData = resolveSemiTrailerFormData(formData, fleetUnits)
    const validationErrors = validateFleetFormData(resolvedFormData, fleetUnits, selectedUnit.id)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    let nextUnit = mergeFleetUnitFromForm(selectedUnit, resolvedFormData)
    let nextUnitList = [...fleetUnits]

    const queueFleetUpdate = async (unitPayload: typeof nextUnit, label: string) => {
      await enqueueAndSync({
        id: `fleet.update.${unitPayload.id}`,
        type: 'fleet.update',
        payload: {
          id: unitPayload.id,
          data: buildFleetPatchBody(unitPayload as unknown as Record<string, unknown>),
        },
        createdAt: new Date().toISOString(),
      })
      setAppError(`No se pudo guardar ${label} en servidor. Quedo en cola para sincronizar.`)
    }

    const persistFleetUpdate = async (unitPayload: typeof nextUnit, label: string) => {
      if (typeof navigator === 'undefined' || !navigator.onLine) {
        await queueFleetUpdate(unitPayload, label)
        return
      }
      try {
        await apiRequest(`/fleet/${unitPayload.id}`, {
          method: 'PATCH',
          body: buildFleetPatchBody(unitPayload as unknown as Record<string, unknown>),
        })
      } catch {
        await queueFleetUpdate(unitPayload, label)
      }
    }

    if (resolvedFormData.hasSemiTrailer) {
      if (resolvedFormData.semiTrailerUnitId) {
        const matchedSemiTrailer = fleetUnits.find((unit) => unit.id === resolvedFormData.semiTrailerUnitId)

        if (matchedSemiTrailer) {
          const updatedSemiTrailer = addTractorHistoryToSemiTrailer(matchedSemiTrailer, selectedUnit.id)
          nextUnitList = nextUnitList.map((unit) =>
            unit.id === updatedSemiTrailer.id ? updatedSemiTrailer : unit,
          )
          nextUnit = {
            ...nextUnit,
            semiTrailerUnitId: updatedSemiTrailer.id,
          }
          await persistFleetUpdate(updatedSemiTrailer, `el semirremolque ${updatedSemiTrailer.internalCode}`)
        } else {
          nextUnit = {
            ...nextUnit,
            semiTrailerUnitId: null,
          }
        }
      } else {
        const newSemiTrailer = createSemiTrailerUnitFromForm(resolvedFormData, selectedUnit.id)
        nextUnitList = [...nextUnitList, newSemiTrailer]
        nextUnit = {
          ...nextUnit,
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
      nextUnit = {
        ...nextUnit,
        semiTrailerUnitId: null,
      }
    }

    nextUnitList = nextUnitList.map((unit) => (unit.id === selectedUnit.id ? nextUnit : unit))
    setFleetUnits(nextUnitList)
    await persistFleetUpdate(nextUnit, `la unidad ${nextUnit.internalCode}`)

    navigate(buildFleetDetailPath(selectedUnit.id))
  }

  return (
    <section className="space-y-4">
      <BackLink to={ROUTE_PATHS.fleet.list} label="Volver a flota" />
      <FleetUnitForm
        title="Editar Unidad"
        description={`Actualizacion de la unidad ${selectedUnit.internalCode}.`}
        submitLabel="Guardar cambios"
        formData={formData}
        errors={errors}
        onFieldChange={handleFieldChange}
        onSubmit={handleSubmit}
        onCancel={() => navigate(buildFleetDetailPath(selectedUnit.id))}
        semiTrailerOptions={semiTrailerOptions}
      />
    </section>
  )
}
