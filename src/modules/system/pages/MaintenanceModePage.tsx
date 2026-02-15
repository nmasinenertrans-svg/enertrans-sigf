import { useEffect, useState } from 'react'
import { apiRequest } from '../../../services/api/apiClient'
import { useAppContext } from '../../../core/hooks/useAppContext'
import { BackLink } from '../../../components/shared/BackLink'
import { ROUTE_PATHS } from '../../../core/routing/routePaths'

export const MaintenanceModePage = () => {
  const {
    state: { maintenanceStatus },
    actions: { setMaintenanceStatus, setAppError },
  } = useAppContext()

  const [enabled, setEnabled] = useState(maintenanceStatus.enabled)
  const [message, setMessage] = useState(maintenanceStatus.message)
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiRequest<{ enabled: boolean; message?: string }>('/settings/maintenance')
        setMaintenanceStatus({ enabled: response.enabled, message: response.message ?? '' })
        setEnabled(response.enabled)
        setMessage(response.message ?? '')
      } catch {
        // ignore
      }
    }
    void load()
  }, [setMaintenanceStatus])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const response = await apiRequest<{ enabled: boolean; message?: string }>('/settings/maintenance', {
        method: 'PUT',
        body: { enabled, message: message.trim() },
      })
      const next = { enabled: response.enabled, message: response.message ?? '' }
      setMaintenanceStatus(next)
      setEnabled(next.enabled)
      setMessage(next.message)
      setAppError(next.enabled ? 'Modo mantenimiento activado.' : 'Modo mantenimiento desactivado.')
    } catch {
      setAppError('No se pudo actualizar el modo mantenimiento.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="space-y-6">
      <header className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <BackLink to={ROUTE_PATHS.dashboard} label="Volver al inicio" />
        <div className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-amber-500">Mantenimiento</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-900">Estado de la aplicación</h2>
          <p className="mt-1 text-sm text-slate-600">
            Solo los usuarios DEV pueden activar o desactivar el mantenimiento global.
          </p>
        </div>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
              className="h-4 w-4"
            />
            Activar mantenimiento
          </label>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-900 hover:bg-amber-500"
            disabled={isSaving}
          >
            {isSaving ? 'Guardando...' : 'Guardar mantenimiento'}
          </button>
        </div>
        <label className="mt-4 flex flex-col gap-2 text-sm font-semibold text-amber-900">
          Mensaje para usuarios
          <textarea
            className="min-h-[110px] rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-400"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Ej: La aplicación se encuentra en mantenimiento, contacte con el área de soporte."
          />
        </label>
      </div>
    </section>
  )
}
