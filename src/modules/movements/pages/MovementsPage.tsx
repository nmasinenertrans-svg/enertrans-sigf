import { useMemo, useState } from 'react'
import { BackLink } from '../../../components/shared/BackLink'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'
import { apiRequest } from '../../../services/api/apiClient'
import type { FleetMovement } from '../../../types/domain'
import {
  applyParsedPayload,
  createEmptyMovementFormData,
  validateMovementFormData,
  type MovementFormData,
} from '../services/movementsService'

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'))
    reader.readAsDataURL(file)
  })

export const MovementsPage = () => {
  const {
    state: { fleetUnits, movements, featureFlags },
    actions: { setMovements, setAppError },
  } = useAppContext()
  const [formData, setFormData] = useState<MovementFormData>(createEmptyMovementFormData())
  const [errors, setErrors] = useState<Partial<Record<keyof MovementFormData, string>>>({})
  const [isParsing, setIsParsing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)

  const unitsOptions = useMemo(
    () =>
      fleetUnits.map((unit) => ({
        id: unit.id,
        label: `${unit.internalCode} - ${unit.ownerCompany}`,
      })),
    [fleetUnits],
  )

  if (!featureFlags.showReportsModule) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Entradas y devoluciones</h2>
        <p className="mt-2 text-sm text-slate-600">Este módulo está deshabilitado por configuración.</p>
      </section>
    )
  }

  const handleFieldChange = <K extends keyof MovementFormData>(field: K, value: MovementFormData[K]) => {
    setFormData((previous) => ({ ...previous, [field]: value }))
    setErrors((previous) => ({ ...previous, [field]: undefined }))
  }

  const handleFileSelection = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    try {
      const dataUrl = await readFileAsDataUrl(file)
      setFormData((previous) => ({
        ...previous,
        pdfFileName: file.name,
        pdfFileBase64: dataUrl,
      }))

      setIsParsing(true)
      const parsed = await apiRequest<Record<string, unknown>>('/movements/parse', {
        method: 'POST',
        body: {
          fileName: file.name,
          contentType: file.type || 'application/pdf',
          dataUrl,
        },
      })

      setFormData((previous) => applyParsedPayload(previous, parsed ?? {}))
    } catch (error) {
      setAppError('No se pudo leer el PDF automáticamente. Completa los datos manualmente.')
    } finally {
      setIsParsing(false)
    }
  }

  const handleSubmit = async () => {
    const validationErrors = validateMovementFormData(formData, fleetUnits)
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      return
    }

    setIsSaving(true)
    try {
      let pdfUrl = formData.pdfFileUrl
      if (formData.pdfFileBase64 && !pdfUrl) {
        const uploadResponse = await apiRequest<{ url: string }>('/files/upload', {
          method: 'POST',
          body: {
            fileName: formData.pdfFileName || `remito-${Date.now()}.pdf`,
            contentType: 'application/pdf',
            dataUrl: formData.pdfFileBase64,
            folder: 'remitos',
          },
        })
        pdfUrl = uploadResponse.url
      }

      const payload = {
        ...formData,
        pdfFileUrl: pdfUrl,
      }

      const created = await apiRequest<FleetMovement>('/movements', {
        method: 'POST',
        body: payload,
      })

      setMovements([created, ...movements])
      setFormData(createEmptyMovementFormData())
    } catch (error) {
      setAppError('No se pudo guardar el movimiento. Intenta nuevamente.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-6">
      <header>
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <h2 className="text-2xl font-bold text-slate-900">Entradas y devoluciones</h2>
        <p className="text-sm text-slate-600">
          Cargá los remitos de entrada o devolución. Se intenta auto-lectura del PDF y luego podés corregir manualmente.
        </p>
      </header>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Nuevo remito</h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Unidades
            <select
              multiple
              value={formData.unitIds}
              onChange={(event) =>
                handleFieldChange(
                  'unitIds',
                  Array.from(event.target.selectedOptions).map((option) => option.value),
                )
              }
              className="min-h-[120px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              {unitsOptions.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">Seleccioná una o más unidades.</span>
            {errors.unitIds ? <span className="text-xs text-rose-700">{errors.unitIds}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Tipo
            <select
              value={formData.movementType}
              onChange={(event) => handleFieldChange('movementType', event.target.value as MovementFormData['movementType'])}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            >
              <option value="ENTRY">Entrada</option>
              <option value="RETURN">Devolución</option>
            </select>
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Número de remito
            <input
              value={formData.remitoNumber}
              onChange={(event) => handleFieldChange('remitoNumber', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.remitoNumber ? <span className="text-xs text-rose-700">{errors.remitoNumber}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Fecha del remito
            <input
              type="date"
              value={formData.remitoDate}
              onChange={(event) => handleFieldChange('remitoDate', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.remitoDate ? <span className="text-xs text-rose-700">{errors.remitoDate}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Cliente
            <input
              value={formData.clientName}
              onChange={(event) => handleFieldChange('clientName', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.clientName ? <span className="text-xs text-rose-700">{errors.clientName}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
            Lugar de trabajo
            <input
              value={formData.workLocation}
              onChange={(event) => handleFieldChange('workLocation', event.target.value)}
              className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
            {errors.workLocation ? <span className="text-xs text-rose-700">{errors.workLocation}</span> : null}
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Equipo / Descripción
            <textarea
              value={formData.equipmentDescription}
              onChange={(event) => handleFieldChange('equipmentDescription', event.target.value)}
              className="min-h-[90px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Observaciones
            <textarea
              value={formData.observations}
              onChange={(event) => handleFieldChange('observations', event.target.value)}
              className="min-h-[80px] rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </label>

          <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700 lg:col-span-2">
            Remito (PDF)
            <input type="file" accept="application/pdf" onChange={handleFileSelection} />
            <span className="text-xs text-slate-500">
              {formData.pdfFileName ? `Archivo: ${formData.pdfFileName}` : 'Adjuntá el PDF para autoleer datos.'}
            </span>
            {isParsing ? <span className="text-xs text-amber-600">Leyendo PDF...</span> : null}
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-amber-400 disabled:opacity-70"
          >
            {isSaving ? 'Guardando...' : 'Guardar remito'}
          </button>
          <button
            type="button"
            onClick={() => setFormData(createEmptyMovementFormData())}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            Limpiar
          </button>
        </div>
      </article>

      <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <h3 className="text-lg font-semibold text-slate-900">Historial de remitos</h3>
        {movements.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">Aún no hay movimientos cargados.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Remito</th>
                  <th className="px-3 py-2">Unidad</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">PDF</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((movement) => {
                  const unit = fleetUnits.find((item) => movement.unitIds.includes(item.id))
                  return (
                    <tr key={movement.id} className="border-t border-slate-200">
                      <td className="px-3 py-2">{movement.remitoDate || movement.createdAt?.slice(0, 10) || ''}</td>
                      <td className="px-3 py-2">{movement.remitoNumber || 'Sin número'}</td>
                      <td className="px-3 py-2">{unit?.internalCode ?? 'Unidad'}</td>
                      <td className="px-3 py-2">{movement.clientName || unit?.clientName || 'Sin cliente'}</td>
                      <td className="px-3 py-2">{movement.movementType === 'ENTRY' ? 'Entrada' : 'Devolución'}</td>
                      <td className="px-3 py-2">
                        {movement.pdfFileUrl ? (
                          <a
                            href={movement.pdfFileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-amber-600 hover:underline"
                          >
                            Ver PDF
                          </a>
                        ) : (
                          'Sin adjunto'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </article>
    </section>
  )
}
